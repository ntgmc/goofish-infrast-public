import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'
import {
  SERVICE_STATUS_COMPONENT_IDS,
  SERVICE_STATUS_HISTORY_HOURS,
  aggregateServiceStatusSample,
  floorStatusTimestampToHour,
  historyBucketFromAggregate,
  type AdminServiceStatusHistoryBucket,
  type PublicStatusIncident,
  type PublicStatusIncidentUpdate,
  type ServiceStatusComponentId,
  type ServiceStatusHistoryAggregate,
  type ServiceStatusHistoryBucket,
  type ServiceStatusSample,
  type StatusIncidentImpact,
  type StatusIncidentState,
} from '../../src/lib/service-status'
import { recordAdminOperationAuditInTransaction, type AdminOperationAuditInput } from './admin-operation-audit-store'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction } from './postgres'

export type ServiceStatusIncidentConflict = Error & { code: 'service_status_incident_conflict' }

export interface CreateServiceStatusIncidentInput {
  componentId: ServiceStatusComponentId
  title: string
  impact: StatusIncidentImpact
  status: StatusIncidentState
  body: string
  startedAt: string
  audit: AdminOperationAuditInput
}

export interface AppendServiceStatusIncidentUpdateInput {
  incidentId: string
  status: StatusIncidentState
  body: string
  expectedUpdatedAt: string
  audit: AdminOperationAuditInput
}

export async function recordServiceStatusSample(sample: ServiceStatusSample): Promise<void> {
  await ensureDatabaseSchema()
  const bucketStart = floorStatusTimestampToHour(sample.bucketStart)
  const current = await query<ServiceStatusHourlyRow>(
    `select component_id, bucket_start::text, status, sample_count, available_samples,
            busy_samples, congested_samples, unavailable_samples, running_sum::text, provisioned_sum::text, utilization_sum::text,
            peak_queued, peak_running, peak_worker_instances, last_sample_at::text
       from service_status_hourly
      where component_id = $1 and bucket_start = $2`,
    [sample.componentId, bucketStart],
  )
  const currentAggregate = current.rows[0] ? rowToAggregate(current.rows[0]) : null
  const next = aggregateServiceStatusSample(currentAggregate, { ...sample, bucketStart })
  await query(
    `insert into service_status_hourly
      (component_id, bucket_start, status, sample_count, available_samples, busy_samples, congested_samples, unavailable_samples,
       running_sum, provisioned_sum, utilization_sum, peak_queued, peak_running, peak_worker_instances,
       last_sample_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
     on conflict (component_id, bucket_start) do update set
       status = excluded.status,
       sample_count = excluded.sample_count,
       available_samples = excluded.available_samples,
       busy_samples = excluded.busy_samples,
       congested_samples = excluded.congested_samples,
       unavailable_samples = excluded.unavailable_samples,
       running_sum = excluded.running_sum,
       provisioned_sum = excluded.provisioned_sum,
       utilization_sum = excluded.utilization_sum,
       peak_queued = excluded.peak_queued,
       peak_running = excluded.peak_running,
       peak_worker_instances = excluded.peak_worker_instances,
       last_sample_at = excluded.last_sample_at,
       updated_at = now()`,
    [
      next.componentId,
      next.bucketStart,
      next.status,
      next.sampleCount,
      next.availableSamples,
      next.busySamples,
      next.congestedSamples,
      next.unavailableSamples,
      next.runningSum,
      next.provisionedSum,
      next.utilizationSum,
      next.peakQueued,
      next.peakRunning,
      next.peakWorkerInstances,
      next.lastSampleAt,
    ],
  )
}

export async function pruneServiceStatusHistory(before: string): Promise<number> {
  await ensureDatabaseSchema()
  const result = await query<{ count: string }>(
    `with deleted as (
       delete from service_status_hourly
        where bucket_start < $1
        returning 1
     )
     select count(*)::text as count from deleted`,
    [before],
  )
  return Number(result.rows[0]?.count ?? 0)
}

export async function getServiceStatusHistory(
  componentId: ServiceStatusComponentId = SERVICE_STATUS_COMPONENT_IDS[0],
  now = new Date(),
): Promise<{
  from: string
  to: string
  buckets: ServiceStatusHistoryBucket[]
}> {
  await ensureDatabaseSchema()
  const to = floorStatusTimestampToHour(now.toISOString())
  const from = new Date(Date.parse(to) - SERVICE_STATUS_HISTORY_HOURS * 60 * 60 * 1000).toISOString()
  const result = await query<ServiceStatusHourlyRow>(
    `select component_id, bucket_start::text, status, sample_count, available_samples,
            busy_samples, congested_samples, unavailable_samples, running_sum::text, provisioned_sum::text, utilization_sum::text,
            peak_queued, peak_running, peak_worker_instances, last_sample_at::text
       from service_status_hourly
      where component_id = $1 and bucket_start >= $2 and bucket_start < $3
      order by bucket_start asc`,
    [componentId, from, to],
  )
  return {
    from,
    to,
    buckets: result.rows.map((row) => {
      const bucket = historyBucketFromAggregate(rowToAggregate(row))
      return {
        component_id: bucket.component_id,
        bucket_start: bucket.bucket_start,
        status: bucket.status,
        sample_count: bucket.sample_count,
        availability_percent: bucket.availability_percent,
      }
    }),
  }
}

export async function getAdminServiceStatusHistory(
  componentId: ServiceStatusComponentId = SERVICE_STATUS_COMPONENT_IDS[0],
  now = new Date(),
): Promise<{
  from: string
  to: string
  buckets: AdminServiceStatusHistoryBucket[]
}> {
  await ensureDatabaseSchema()
  const to = floorStatusTimestampToHour(now.toISOString())
  const from = new Date(Date.parse(to) - SERVICE_STATUS_HISTORY_HOURS * 60 * 60 * 1000).toISOString()
  const result = await query<ServiceStatusHourlyRow>(
    `select component_id, bucket_start::text, status, sample_count, available_samples,
            busy_samples, congested_samples, unavailable_samples, running_sum::text, provisioned_sum::text, utilization_sum::text,
            peak_queued, peak_running, peak_worker_instances, last_sample_at::text
       from service_status_hourly
      where component_id = $1 and bucket_start >= $2 and bucket_start < $3
      order by bucket_start asc`,
    [componentId, from, to],
  )
  return {
    from,
    to,
    buckets: result.rows.map((row) => historyBucketFromAggregate(rowToAggregate(row))),
  }
}

export async function listPublicServiceStatusIncidents(
  from: string,
): Promise<PublicStatusIncident[]> {
  await ensureDatabaseSchema()
  return listServiceStatusIncidents(from)
}

export async function listAdminServiceStatusIncidents(
  from: string,
): Promise<PublicStatusIncident[]> {
  await ensureDatabaseSchema()
  return listServiceStatusIncidents(from)
}

export async function createServiceStatusIncident(
  input: CreateServiceStatusIncidentInput,
): Promise<PublicStatusIncident> {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    const id = randomUUID()
    const now = new Date().toISOString()
    const resolvedAt = input.status === 'resolved' ? now : null
    await client.query(
      `insert into service_status_incidents
        (id, component_id, title, impact, status, started_at, resolved_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [id, input.componentId, input.title.trim(), input.impact, input.status, input.startedAt, resolvedAt, now],
    )
    const update = await insertIncidentUpdate(client, id, input.status, input.body, now)
    await recordAdminOperationAuditInTransaction(client, {
      ...input.audit,
      action: 'service_status_incident.create',
      targetType: 'service_status_incident',
      targetId: id,
      after: { component_id: input.componentId, title: input.title.trim(), impact: input.impact, status: input.status },
    })
    return {
      id,
      component_id: input.componentId,
      title: input.title.trim(),
      impact: input.impact,
      status: input.status,
      started_at: input.startedAt,
      resolved_at: resolvedAt,
      created_at: now,
      updated_at: now,
      updates: [update],
    }
  })
}

export async function appendServiceStatusIncidentUpdate(
  input: AppendServiceStatusIncidentUpdateInput,
): Promise<PublicStatusIncident> {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    const result = await client.query<ServiceStatusIncidentRow>(
      `select id, component_id, title, impact, status, started_at::text, resolved_at::text,
              created_at::text, updated_at::text
         from service_status_incidents
        where id = $1
        for update`,
      [input.incidentId],
    )
    const current = result.rows[0]
    if (!current) throw new Error('service_status_incident_not_found')
    if (normalizeTimestamp(current.updated_at) !== normalizeTimestamp(input.expectedUpdatedAt)) throw conflictError()
    const now = new Date().toISOString()
    const resolvedAt = input.status === 'resolved' ? (current.resolved_at ?? now) : null
    await client.query(
      `update service_status_incidents
          set status = $2, resolved_at = $3, updated_at = $4
        where id = $1`,
      [input.incidentId, input.status, resolvedAt, now],
    )
    const update = await insertIncidentUpdate(client, input.incidentId, input.status, input.body, now)
    await recordAdminOperationAuditInTransaction(client, {
      ...input.audit,
      action: input.status === 'resolved' ? 'service_status_incident.resolve' : 'service_status_incident.update',
      targetType: 'service_status_incident',
      targetId: input.incidentId,
      before: { status: current.status, resolved_at: current.resolved_at, updated_at: current.updated_at },
      after: { status: input.status, resolved_at: resolvedAt, update_id: update.id },
    })
    return incidentWithUpdates(client, { ...current, status: input.status, resolved_at: resolvedAt, updated_at: now })
  })
}

async function listServiceStatusIncidents(from: string): Promise<PublicStatusIncident[]> {
  const incidents = await query<ServiceStatusIncidentRow>(
    `select id, component_id, title, impact, status, started_at::text, resolved_at::text,
            created_at::text, updated_at::text
       from service_status_incidents
      where resolved_at is null or resolved_at >= $1
      order by case when resolved_at is null then 0 else 1 end, updated_at desc, id desc`,
    [from],
  )
  if (incidents.rows.length === 0) return []
  const updates = await query<ServiceStatusIncidentUpdateRow>(
    `select id, incident_id, status, body, created_at::text
       from service_status_incident_updates
      where incident_id = any($1::text[])
      order by created_at asc, id asc`,
    [incidents.rows.map((row) => row.id)],
  )
  const updatesByIncident = new Map<string, PublicStatusIncidentUpdate[]>()
  for (const update of updates.rows) {
    const list = updatesByIncident.get(update.incident_id) ?? []
    list.push({ id: update.id, status: update.status, body: update.body, created_at: update.created_at })
    updatesByIncident.set(update.incident_id, list)
  }
  return incidents.rows.map((row) => ({
    id: row.id,
    component_id: row.component_id,
    title: row.title,
    impact: row.impact,
    status: row.status,
    started_at: normalizeTimestamp(row.started_at),
    resolved_at: row.resolved_at ? normalizeTimestamp(row.resolved_at) : null,
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
    updates: updatesByIncident.get(row.id) ?? [],
  }))
}

async function incidentWithUpdates(
  client: Pick<PoolClient, 'query'>,
  row: ServiceStatusIncidentRow,
): Promise<PublicStatusIncident> {
  const updates = await client.query<ServiceStatusIncidentUpdateRow>(
    `select id, incident_id, status, body, created_at::text
       from service_status_incident_updates
      where incident_id = $1
      order by created_at asc, id asc`,
    [row.id],
  )
  return {
    id: row.id,
    component_id: row.component_id,
    title: row.title,
    impact: row.impact,
    status: row.status,
    started_at: normalizeTimestamp(row.started_at),
    resolved_at: row.resolved_at ? normalizeTimestamp(row.resolved_at) : null,
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
    updates: updates.rows.map((update) => ({
      id: update.id,
      status: update.status,
      body: update.body,
      created_at: normalizeTimestamp(update.created_at),
    })),
  }
}

async function insertIncidentUpdate(
  client: Pick<PoolClient, 'query'>,
  incidentId: string,
  status: StatusIncidentState,
  body: string,
  createdAt: string,
): Promise<PublicStatusIncidentUpdate> {
  const id = randomUUID()
  await client.query(
    `insert into service_status_incident_updates (id, incident_id, status, body, created_at)
     values ($1, $2, $3, $4, $5)`,
    [id, incidentId, status, body.trim(), createdAt],
  )
  return { id, status, body: body.trim(), created_at: createdAt }
}

function conflictError(): ServiceStatusIncidentConflict {
  return Object.assign(new Error('service_status_incident_conflict'), { code: 'service_status_incident_conflict' as const })
}

interface ServiceStatusHourlyRow extends QueryResultRow {
  component_id: ServiceStatusComponentId
  bucket_start: string
  status: 'available' | 'busy' | 'congested' | 'unavailable'
  sample_count: number
  available_samples: number
  busy_samples: number
  congested_samples: number
  unavailable_samples: number
  running_sum: string
  provisioned_sum: string
  utilization_sum: string
  peak_queued: number
  peak_running: number
  peak_worker_instances: number
  last_sample_at: string
}

interface ServiceStatusIncidentRow extends QueryResultRow {
  id: string
  component_id: ServiceStatusComponentId
  title: string
  impact: StatusIncidentImpact
  status: StatusIncidentState
  started_at: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

interface ServiceStatusIncidentUpdateRow extends QueryResultRow {
  id: string
  incident_id: string
  status: StatusIncidentState
  body: string
  created_at: string
}

function rowToAggregate(row: ServiceStatusHourlyRow): ServiceStatusHistoryAggregate {
  return {
    componentId: row.component_id,
    bucketStart: normalizeTimestamp(row.bucket_start),
    status: row.status,
    sampleCount: Number(row.sample_count),
    availableSamples: Number(row.available_samples),
    busySamples: Number(row.busy_samples),
    congestedSamples: Number(row.congested_samples),
    unavailableSamples: Number(row.unavailable_samples),
    runningSum: Number(row.running_sum),
    provisionedSum: Number(row.provisioned_sum),
    utilizationSum: Number(row.utilization_sum),
    peakQueued: Number(row.peak_queued),
    peakRunning: Number(row.peak_running),
    peakWorkerInstances: Number(row.peak_worker_instances),
    lastSampleAt: normalizeTimestamp(row.last_sample_at),
  }
}

function normalizeTimestamp(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value
}
