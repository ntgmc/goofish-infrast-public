import { describe, expect, it } from 'vitest'
import type {
  LicenseConfig,
  UserWorkspace,
  WorkspaceResultHistorySummary,
  WorkspaceSavedConfig,
} from '../../src/lib/types'
import {
  WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT,
  WORKSPACE_RESULT_HISTORY_LIMIT,
  WORKSPACE_SAVED_CONFIG_LIMIT,
} from '../../src/lib/workspace-limits'
import { toPublicWorkspace, type UserWorkspaceRecord } from './user-store'

const config = { layout: '2-4-3', desc: '测试配置' } as LicenseConfig

describe('workspace retention normalization', () => {
  it('only exposes saved configurations and the requested result summary page', () => {
    const workspace = buildWorkspace({
      saved_configs: Array.from(
        { length: WORKSPACE_SAVED_CONFIG_LIMIT + 1 },
        (_, index) => savedConfig(index + 1),
      ),
    })
    const resultItems = Array.from(
      { length: WORKSPACE_RESULT_HISTORY_LIMIT + 1 },
      (_, index) => historySummary(index + 1),
    )

    const publicWorkspace = toPublicWorkspace(workspace, undefined, {
      latest_result: resultItems[0],
      result_history: { items: resultItems, next_cursor: 'next-active' },
      archived_results: { items: [], next_cursor: null },
    }) as UserWorkspace

    expect(publicWorkspace.saved_configs.map((item) => item.id)).toEqual(
      Array.from({ length: WORKSPACE_SAVED_CONFIG_LIMIT }, (_, index) => `config-${index + 1}`),
    )
    expect(publicWorkspace.result_history.map((item) => item.id)).toEqual(
      Array.from({ length: WORKSPACE_RESULT_HISTORY_LIMIT }, (_, index) => `history-${index + 1}`),
    )
    expect(publicWorkspace.latest_result?.id).toBe('history-1')
    expect(publicWorkspace.result_history_next_cursor).toBe('next-active')
  })

  it('never exposes full result or config payloads in workspace result summaries', () => {
    const projected = toPublicWorkspace(buildWorkspace(), { plan: 3, history: 5, archive: 1 }, {
      latest_result: historySummary(1),
      result_history: { items: [historySummary(1)], next_cursor: null },
      archived_results: { items: [historySummary(2, true)], next_cursor: null },
    })

    expect(projected.latest_result).toEqual(historySummary(1))
    expect(projected.result_history[0]).not.toHaveProperty('result')
    expect(projected.result_history[0]).not.toHaveProperty('config')
    expect(projected.archived_results[0]).not.toHaveProperty('result')
    expect(projected.archived_results[0]).not.toHaveProperty('config')
  })

  it('limits the archived summary page to the granted public capacity', () => {
    const archived = Array.from(
      { length: WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT + 1 },
      (_, index) => historySummary(index + 1, true),
    )
    const projected = toPublicWorkspace(
      buildWorkspace(),
      { plan: 3, history: 5, archive: WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT },
      {
        latest_result: null,
        result_history: { items: [], next_cursor: null },
        archived_results: { items: archived, next_cursor: 'next-archive' },
      },
    )

    expect(projected.archived_results).toHaveLength(WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT)
    expect(projected.archived_results_next_cursor).toBe('next-archive')
  })
})

function buildWorkspace(overrides: Partial<UserWorkspaceRecord> = {}): UserWorkspaceRecord {
  return {
    version: 1,
    profile_id: 'profile-1',
    operators: null,
    config,
    elite_overrides: {},
    saved_configs: [],
    free_schedule_entitlement: null,
    free_preview_normalized_activity_id: null,
    updated_at: '2026-07-23T00:00:00.000Z',
    ...overrides,
  }
}

function savedConfig(index: number): WorkspaceSavedConfig {
  return {
    id: `config-${index}`,
    name: `配置 ${index}`,
    config,
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
    last_used_at: null,
  }
}

function historySummary(index: number, archived = false): WorkspaceResultHistorySummary {
  return {
    id: `history-${index}`,
    name: `结果 ${index}`,
    created_at: '2026-07-23T00:00:00.000Z',
    operator_count: 1,
    source: 'generated',
    archived,
    schedule_mode: 'maa',
    maa_exportable: true,
    has_config: true,
  }
}
