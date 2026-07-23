import { describe, expect, it } from 'vitest'
import type { LicenseConfig, OptimizeResult, UserWorkspace, WorkspaceResultHistoryItem, WorkspaceSavedConfig } from '../../src/lib/types'
import { WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../src/lib/workspace-limits'
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
