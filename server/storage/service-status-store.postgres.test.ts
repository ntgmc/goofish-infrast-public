import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { calculateServiceStatusCostEstimate } from '../../src/lib/service-status-cost'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'
import {
  appendServiceStatusIncidentUpdate,
  createServiceStatusIncident,
  getAdminServiceStatusHistory,
  getServiceStatusCostConfig,
  getServiceStatusHistory,
  listPublicServiceStatusIncidents,
  pruneServiceStatusHistory,
  recordServiceStatusSample,
  saveServiceStatusCostConfig,
} from './service-status-store'

let container: PostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})

afterAll(async () => {
  await closePool()
  await container?.stop()
})

describe('PostgreSQL service status history', () => {
  it('merges samples into one UTC hour and exposes cost aggregates', async () => {
    await recordServiceStatusSample({ componentId: 'optimization', bucketStart: '2026-08-08T01:15:00.000Z', status: 'available', queued: 0, running: 1, workerConcurrency: 4, workerInstances: 1, sampledAt: '2026-08-08T01:15:00.000Z' })
    await recordServiceStatusSample({ componentId: 'optimization', bucketStart: '2026-08-08T01:45:00.000Z', status: 'overloaded', queued: 21, running: 4, workerConcurrency: 4, workerInstances: 1, sampledAt: '2026-08-08T01:45:00.000Z' })
    const history = await getServiceStatusHistory('optimization', new Date('2026-08-08T02:00:00.000Z'))
    expect(history.buckets).toHaveLength(1)
    expect(history.buckets[0]).toMatchObject({ bucket_start: '2026-08-08T01:00:00.000Z', status: 'overloaded', sample_count: 2, availability_percent: 50 })
    const admin = await getAdminServiceStatusHistory('optimization', new Date('2026-08-08T02:00:00.000Z'))
    expect(admin.buckets[0]).toMatchObject({ busy_samples: 0, congested_samples: 0, overloaded_samples: 1, peak_queued: 21, average_utilization_percent: 62.5, average_worker_instances: 1 })
    await query('delete from service_status_hourly where bucket_start = $1', ['2026-08-08T01:00:00.000Z'])
  })

  it('stores scaling samples as available and exposes their diagnostic count', async () => {
    await recordServiceStatusSample({ componentId: 'optimization', bucketStart: '2026-08-08T05:15:00.000Z', status: 'scaling', queued: 5, running: 3, workerConcurrency: 3, workerInstances: 1, sampledAt: '2026-08-08T05:15:00.000Z' })
    const history = await getServiceStatusHistory('optimization', new Date('2026-08-08T06:00:00.000Z'))
    expect(history.buckets[0]).toMatchObject({ bucket_start: '2026-08-08T05:00:00.000Z', status: 'scaling', sample_count: 1, availability_percent: 100 })
    const admin = await getAdminServiceStatusHistory('optimization', new Date('2026-08-08T06:00:00.000Z'))
    expect(admin.buckets[0]).toMatchObject({ scaling_samples: 1, unavailable_samples: 0 })
    await query('delete from service_status_hourly where bucket_start = $1', ['2026-08-08T05:00:00.000Z'])
  })

  it('persists ECS cost planning with optimistic concurrency', async () => {
    const initial = await getServiceStatusCostConfig()
    expect(initial).toMatchObject({ component_id: 'optimization', billing_model: 'ecs_payg', resident_hourly_price_cny: null, hourly_price_cny: null })
    const saved = await saveServiceStatusCostConfig({
      config: { ...initial, resident_hourly_price_cny: 0.28, hourly_price_cny: 0.82, schedule_enabled: true, valley_worker_instances: 1, peak_windows: [{ start: '09:00', end: '18:00', worker_instances: 3 }] },
      expectedUpdatedAt: initial.updated_at,
      audit: { actorUsername: 'postgres-test', reason: '测试 ECS 成本计划', requestId: randomUUID() },
    })
    expect(saved.resident_hourly_price_cny).toBe(0.28)
    expect(saved.hourly_price_cny).toBe(0.82)
    await expect(saveServiceStatusCostConfig({
      config: saved,
      expectedUpdatedAt: '2026-08-08T00:00:00.000Z',
      audit: { actorUsername: 'postgres-test', reason: '测试成本并发冲突', requestId: randomUUID() },
    })).rejects.toMatchObject({ code: 'service_status_cost_config_conflict' })
    await query('delete from service_status_cost_config where component_id = $1', ['optimization'])
  })

  it('estimates sparse persisted history using its time range', async () => {
    for (const [bucketStart, workerInstances] of [['2026-08-06T00:00:00.000Z', 3], ['2026-08-07T23:00:00.000Z', 1]] as const) {
      await recordServiceStatusSample({ componentId: 'optimization', bucketStart, status: 'available', queued: 0, running: 0,
        workerConcurrency: 1, workerInstances, sampledAt: bucketStart })
    }
    const history = await getAdminServiceStatusHistory('optimization', new Date('2026-08-08T00:00:00.000Z'))
    expect(history.buckets).toHaveLength(2)
    expect(calculateServiceStatusCostEstimate({ ...await getServiceStatusCostConfig(), resident_hourly_price_cny: 0.2, hourly_price_cny: 0.5 }, history.buckets, history.to))
      .toMatchObject({ observed_24h_worker_hours: 1, observed_24h_sample_hours: 1, observed_24h_cost_cny: 0.7, projected_monthly_cost_cny: 504, observed_30d_worker_hours: 4 })
    await query('delete from service_status_hourly')
  })

  it('serializes two first saves before version reads and commits only one audit', async () => {
    const initial = await getServiceStatusCostConfig()
    const blocker = new Client({ connectionString: container.getConnectionUri() })
    await blocker.connect()
    const ids = [randomUUID(), randomUUID()]
    let saves: Promise<PromiseSettledResult<Awaited<ReturnType<typeof saveServiceStatusCostConfig>>>[]> | undefined
    try {
      await blocker.query('begin')
      const pid = Number((await blocker.query('select pg_backend_pid() as pid')).rows[0].pid)
      await blocker.query('lock table service_status_cost_config in share mode')
      saves = Promise.allSettled(ids.map((requestId, index) => saveServiceStatusCostConfig({ config: { ...initial, hourly_price_cny: index ? 0.8 : 0.5 },
        expectedUpdatedAt: null, audit: { actorUsername: 'postgres-test', reason: '首次成本并发保存', requestId } })))
      await vi.waitFor(async () => {
        const blocked = await query(`select pid, query from pg_stat_activity where wait_event_type = 'Lock' and query like '%service-status-cost-config:%'`)
        expect(blocked.rowCount).toBe(1)
        expect((await query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount).toBe(1)
      }, { timeout: 5000, interval: 20 })
      await blocker.query('commit')
      const settled = await saves
      expect(settled.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
      expect(settled.find((entry) => entry.status === 'rejected')).toMatchObject({ reason: { code: 'service_status_cost_config_conflict' } })
      expect((await query('select 1 from admin_operation_audit where request_id = any($1::text[])', [ids])).rowCount).toBe(1)
      const latest = await getServiceStatusCostConfig()
      await expect(saveServiceStatusCostConfig({ config: latest, expectedUpdatedAt: null,
        audit: { actorUsername: 'postgres-test', reason: '拒绝过期空版本', requestId: randomUUID() } })).rejects.toMatchObject({ code: 'service_status_cost_config_conflict' })
      const updated = await saveServiceStatusCostConfig({ config: latest, expectedUpdatedAt: latest.updated_at,
        audit: { actorUsername: 'postgres-test', reason: '使用最新版本保存', requestId: randomUUID() } })
      expect(Date.parse(updated.updated_at!)).toBeGreaterThan(Date.parse(latest.updated_at!))
    } finally {
      await blocker.query('rollback')
      await saves
      await blocker.end()
      await query('delete from service_status_cost_config')
    }
  })

  it('rolls back a failed initial audit and releases the component lock for another first save', async () => {
    const initial = await getServiceStatusCostConfig()
    const audit = { actorUsername: 'postgres-test', reason: '', requestId: randomUUID() }
    await expect(saveServiceStatusCostConfig({ config: { ...initial, hourly_price_cny: 0.5 }, expectedUpdatedAt: null, audit })).rejects.toThrow('audit reason')
    expect((await getServiceStatusCostConfig()).updated_at).toBeNull()
    expect((await query('select 1 from admin_operation_audit where request_id = $1', [audit.requestId])).rowCount).toBe(0)
    await expect(saveServiceStatusCostConfig({ config: initial, expectedUpdatedAt: null, audit: { ...audit, reason: '回滚后首次保存' } })).resolves.toMatchObject({ updated_at: expect.any(String) })
    await query('delete from service_status_cost_config')
  })

  it('prunes only buckets older than the retention cutoff', async () => {
    await recordServiceStatusSample({ componentId: 'optimization', bucketStart: '2020-01-01T00:00:00.000Z', status: 'available', queued: 0, running: 0, workerConcurrency: 1, workerInstances: 1, sampledAt: '2020-01-01T00:01:00.000Z' })
    await recordServiceStatusSample({ componentId: 'optimization', bucketStart: '2026-08-08T03:00:00.000Z', status: 'available', queued: 0, running: 0, workerConcurrency: 1, workerInstances: 1, sampledAt: '2026-08-08T03:01:00.000Z' })
    await expect(pruneServiceStatusHistory('2026-07-09T00:00:00.000Z')).resolves.toBe(1)
    await query('delete from service_status_hourly where bucket_start = $1', ['2026-08-08T03:00:00.000Z'])
  })

  it('appends incident updates and records a resolved timestamp', async () => {
    const incident = await createServiceStatusIncident({ componentId: 'optimization', title: `状态事件 ${randomUUID().slice(0, 8)}`, impact: 'minor', status: 'investigating', body: '开始调查。', startedAt: '2026-08-08T04:00:00.000Z', audit: { actorUsername: 'postgres-test', reason: '测试状态事件审计', requestId: randomUUID() } })
    const resolved = await appendServiceStatusIncidentUpdate({ incidentId: incident.id, status: 'resolved', body: '问题已解决。', expectedUpdatedAt: incident.updated_at, audit: { actorUsername: 'postgres-test', reason: '测试解决事件审计', requestId: randomUUID() } })
    expect(resolved).toMatchObject({ id: incident.id, status: 'resolved', resolved_at: expect.any(String), updates: expect.arrayContaining([expect.objectContaining({ status: 'resolved' })]) })
    await expect(listPublicServiceStatusIncidents('2026-08-01T00:00:00.000Z')).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: incident.id, status: 'resolved' })]))
    await query('delete from service_status_incident_updates where incident_id = $1', [incident.id])
    await query('delete from service_status_incidents where id = $1', [incident.id])
  })
})
