import { describe, expect, it } from 'vitest'
import type { LicenseConfig, OptimizeResult, UserWorkspace, WorkspaceResultHistoryItem, WorkspaceSavedConfig } from '../../src/lib/types'
import { WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT, WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../src/lib/workspace-limits'
import { toPublicWorkspace, type UserWorkspaceRecord } from './user-store'

const config = { layout: '2-4-3', desc: '测试配置' } as LicenseConfig
const result = { schedule_mode: 'maa', plans: [] } as OptimizeResult

describe('workspace retention normalization', () => {
  it('only exposes the newest saved configurations and result history entries', () => {
    const workspace = {
      version: 1,
      profile_id: 'profile-1',
      operators: null,
      config: config,
      elite_overrides: {},
      last_result: null,
      saved_configs: Array.from({ length: WORKSPACE_SAVED_CONFIG_LIMIT + 1 }, (_, index) => savedConfig(index + 1)),
      result_history: Array.from({ length: WORKSPACE_RESULT_HISTORY_LIMIT + 1 }, (_, index) => historyItem(index + 1)),
      free_schedule_entitlement: null,
      updated_at: '2026-07-23T00:00:00.000Z',
    } as UserWorkspaceRecord

    const publicWorkspace = toPublicWorkspace(workspace) as UserWorkspace

    expect(publicWorkspace.saved_configs.map((item) => item.id)).toEqual(
      Array.from({ length: WORKSPACE_SAVED_CONFIG_LIMIT }, (_, index) => `config-${index + 1}`),
    )
    expect(publicWorkspace.result_history.map((item) => item.id)).toEqual(
      Array.from({ length: WORKSPACE_RESULT_HISTORY_LIMIT }, (_, index) => `history-${index + 1}`),
    )
  })

  it('projects last, regular, and archived results through the same capability boundary', () => {
    const sensitiveResult = {
      ...result,
      raw_results: [{ total_efficiency: 100, assignment_detail: [] }],
      daily_production: { manufacturing: { LMD: 1000 } },
      total_efficiency: 100,
    } as OptimizeResult
    const regular = { ...historyItem(1), result: sensitiveResult }
    const archived = { ...historyItem(2), result: sensitiveResult }
    const workspace = {
      version: 1,
      profile_id: 'profile-1',
      operators: null,
      config,
      elite_overrides: {},
      last_result: sensitiveResult,
      saved_configs: [],
      result_history: [regular],
      archived_results: [archived],
      free_schedule_entitlement: null,
      updated_at: '2026-07-23T00:00:00.000Z',
    } as UserWorkspaceRecord

    const projected = toPublicWorkspace(
      workspace,
      { plan: 3, history: 5, archive: 1 },
      { kind: 'cdk', permission: 'growth' },
    )

    for (const projectedResult of [
      projected.last_result,
      projected.result_history[0]?.result,
      projected.archived_results[0]?.result,
    ]) {
      expect(projectedResult?.raw_results).toEqual([])
      expect(projectedResult).not.toHaveProperty('daily_production')
      expect(projectedResult).not.toHaveProperty('total_efficiency')
    }
  })

  it('normalizes archived results to the real maximum capacity', () => {
    const workspace = {
      version: 1,
      profile_id: 'profile-1',
      operators: null,
      config,
      elite_overrides: {},
      last_result: null,
      saved_configs: [],
      result_history: [],
      archived_results: Array.from(
        { length: WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT + 1 },
        (_, index) => historyItem(index + 1),
      ),
      free_schedule_entitlement: null,
      updated_at: '2026-07-23T00:00:00.000Z',
    } as UserWorkspaceRecord

    const projected = toPublicWorkspace(workspace, {
      plan: 3,
      history: 5,
      archive: WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT + 1,
    })

    expect(projected.archived_results).toHaveLength(WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT)
  })
})

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

function historyItem(index: number): WorkspaceResultHistoryItem {
  return {
    id: `history-${index}`,
    name: `结果 ${index}`,
    created_at: '2026-07-23T00:00:00.000Z',
    config,
    result,
    operator_count: 1,
    source: 'generated',
  }
}
