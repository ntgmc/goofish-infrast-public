import { describe, expect, it } from 'vitest'
import { FREE_PREVIEW_LIMITED_CDK_ACTIVITY } from './free-preview-trial'
import { projectExpiredFreePreviewWorkspace } from './free-preview-workspace'
import { getFreePreviewDefaultConfig } from './handlers/license-utils'
import { toPublicWorkspace, type UserGameAccountRecord, type UserWorkspaceRecord } from './storage/user-store'

const profile: UserGameAccountRecord = {
  version: 1,
  id: 'preview-profile',
  user_id: 'user-1',
  kind: 'free_preview',
  cdk_key: null,
  cdk_code_hash: null,
  cdk_order_hash: null,
  permission: 'growth',
  status: 'active',
  display_name: '体验账号',
  note: '',
  temporary_permission: {
    source: 'limited_profile_voucher',
    activity_id: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id,
    permission: 'advanced',
    starts_at: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.startsAt,
    ends_at: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt,
    operation_id: 'operation-1',
  },
  created_at: '2026-07-17T00:00:00.000Z',
  updated_at: '2026-07-17T00:00:00.000Z',
}

function workspace(): UserWorkspaceRecord {
  const advancedConfig = { ...getFreePreviewDefaultConfig(), optimizer_search: { enabled: true } }
  return {
    version: 1,
    profile_id: profile.id,
    operators: null,
    config: advancedConfig,
    elite_overrides: {},
    last_result: null,
    saved_configs: [],
    result_history: [],
    archived_results: [],
    free_schedule_entitlement: null,
    free_preview_normalized_activity_id: null,
    updated_at: '2026-07-18T00:00:00.000Z',
  }
}

describe('expired free-preview workspace projection', () => {
  it('uses deterministic archive metadata and becomes idempotent after marking the activity', () => {
    const now = new Date(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt)
    const first = projectExpiredFreePreviewWorkspace(profile, workspace(), now)
    const repeatedFromOriginal = projectExpiredFreePreviewWorkspace(profile, workspace(), now)

    expect(first.changed).toBe(true)
    expect(first).toEqual(repeatedFromOriginal)
    expect(first.workspace.free_preview_normalized_activity_id).toBe(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id)
    expect(first.workspace.updated_at).toBe(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt)
    expect(first.workspace.saved_configs[0]).toMatchObject({
      id: `free-preview:${FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id}:advanced-config`,
      created_at: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt,
      updated_at: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt,
      read_only: true,
    })
    expect(first.workspace.config).toEqual(getFreePreviewDefaultConfig())

    const alreadyPersisted = projectExpiredFreePreviewWorkspace(profile, first.workspace, now)
    expect(alreadyPersisted).toEqual({ workspace: first.workspace, changed: false })
  })

  it('does not expose the internal activity marker in public workspace payloads', () => {
    const projected = projectExpiredFreePreviewWorkspace(
      profile,
      workspace(),
      new Date(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt),
    ).workspace
    expect(toPublicWorkspace(projected)).not.toHaveProperty('free_preview_normalized_activity_id')
  })
})
