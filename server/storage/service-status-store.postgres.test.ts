import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    await recordServiceStatusSample({ componentId: 'optimization', bucketStart: '2026-08-08T01:45:00.000Z', status: 'congested', queued: 6, running: 4, workerConcurrency: 4, workerInstances: 1, sampledAt: '2026-08-08T01:45:00.000Z' })
    const history = await getServiceStatusHistory('optimization', new Date('2026-08-08T02:00:00.000Z'))
    expect(history.buckets).toHaveLength(1)
    expect(history.buckets[0]).toMatchObject({ bucket_start: '2026-08-08T01:00:00.000Z', status: 'congested', sample_count: 2, availability_percent: 50 })
    const admin = await getAdminServiceStatusHistory('optimization', new Date('2026-08-08T02:00:00.000Z'))
    expect(admin.buckets[0]).toMatchObject({ busy_samples: 0, congested_samples: 1, peak_queued: 6, average_utilization_percent: 62.5, average_worker_instances: 1 })
    await query('delete from service_status_hourly where bucket_start = $1', ['2026-08-08T01:00:00.000Z'])
  })

  it('persists ECS cost planning with optimistic concurrency', async () => {
    const initial = await getServiceStatusCostConfig()
    expect(initial).toMatchObject({ component_id: 'optimization', billing_model: 'ecs_payg', hourly_price_cny: null })
    const saved = await saveServiceStatusCostConfig({
      config: { ...initial, hourly_price_cny: 0.82, schedule_enabled: true, valley_worker_instances: 1, peak_windows: [{ start: '09:00', end: '18:00', worker_instances: 3 }] },
      expectedUpdatedAt: initial.updated_at,
      audit: { actorUsername: 'postgres-test', reason: '测试 ECS 成本计划', requestId: randomUUID() },
    })
    expect(saved.hourly_price_cny).toBe(0.82)
    await expect(saveServiceStatusCostConfig({
      config: saved,
      expectedUpdatedAt: '2026-08-08T00:00:00.000Z',
      audit: { actorUsername: 'postgres-test', reason: '测试成本并发冲突', requestId: randomUUID() },
    })).rejects.toMatchObject({ code: 'service_status_cost_config_conflict' })
    await query('delete from service_status_cost_config where component_id = $1', ['optimization'])
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
