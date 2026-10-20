import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formatResultHistorySummary } from '../../src/lib/workspace-history'
import { getLatestProfileOptimizationResultSummaries, getWorkspaceOptimizationResultOverview, listProfileOptimizationResults } from './optimization-result-store'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'

let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})
afterAll(async () => { await closePool(); if (container) await container.stop() })

it('projects saved layouts and legacy result layouts into paginated, archived and latest history summaries', async () => {
  const userId = randomUUID(), profileId = randomUUID()
  await query(`insert into user_accounts (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
    values ($1, 'result-layout@example.test', 'hash', 'salt', 1, 'recommended', 'active', '{}'::jsonb, now(), now())`, [userId])
  await query(`insert into user_game_accounts (id, user_id, permission, status, display_name, note, record_json, created_at, updated_at, kind)
    values ($1, $2, 'recommended', 'active', '布局测试', '', '{}'::jsonb, now(), now(), 'cdk')`, [profileId, userId])
  const fixtures = [
    { id: 'unknown', config: null, result: {}, archived: null },
    { id: 'fallback', config: { layout: '' }, result: { buildingType: 333 }, archived: null },
    { id: 'saved', config: { layout: '2-5-2' }, result: { buildingType: 243 }, archived: null },
    { id: 'archived', config: null, result: { buildingType: 243 }, archived: '2026-10-20T00:00:00Z' },
  ]
  for (const fixture of fixtures) await query(`insert into optimization_result_history
    (profile_id, id, name, created_at, config_json, result_json, source, archived_at)
    values ($1, $2, $2, now()::text, $3::jsonb, $4::jsonb, 'generated', $5)`,
  [profileId, fixture.id, fixture.config === null ? null : JSON.stringify(fixture.config), JSON.stringify({ schedule_mode: 'maa', ...fixture.result }), fixture.archived])

  const page = await listProfileOptimizationResults(profileId, 'active', { limit: 2 })
  expect(page.items).toMatchObject([{ id: 'saved', layout: '2-5-2' }, { id: 'fallback', layout: '333' }])
  expect(formatResultHistorySummary(page.items[0])).toBe('252 · MAA 排班表')
  expect(formatResultHistorySummary(page.items[1])).toBe('333 · MAA 排班表')
  expect(page.items[0]).not.toHaveProperty('config')
  expect(page.items[0]).not.toHaveProperty('result')
  expect(page.next_cursor).toEqual(expect.any(String))
  const nextPage = await listProfileOptimizationResults(profileId, 'active', { limit: 2, cursor: page.next_cursor })
  expect(nextPage.items).toMatchObject([{ id: 'unknown', layout: null }])
  expect(formatResultHistorySummary(nextPage.items[0])).toBe('MAA 排班表')
  expect(nextPage.next_cursor).toBeNull()

  const overview = await getWorkspaceOptimizationResultOverview(profileId)
  expect(overview.latest_result).toMatchObject({ id: 'saved', layout: '2-5-2' })
  expect(overview.archived_results.items).toMatchObject([{ id: 'archived', layout: '243', archived: true }])
  expect(formatResultHistorySummary(overview.archived_results.items[0])).toBe('243 · MAA 排班表')
  const latest = await getLatestProfileOptimizationResultSummaries([profileId])
  expect(latest.get(profileId)).toMatchObject({ id: 'saved', layout: '2-5-2' })
  await query('delete from user_accounts where id = $1', [userId])
})
