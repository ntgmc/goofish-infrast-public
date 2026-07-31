import { WORKSPACE_SAVED_CONFIG_MAX_LIMIT } from '../src/lib/workspace-limits'
import { hasFreePreviewTrialEnded } from './free-preview-trial'
import { getFreePreviewDefaultConfig, resolveFreePreviewConfig } from './handlers/license-utils'
import type { UserGameAccountRecord, UserWorkspaceRecord } from './storage/user-store'

export interface FreePreviewWorkspaceProjection {
  workspace: UserWorkspaceRecord
  changed: boolean
}

export function projectExpiredFreePreviewWorkspace(
  profile: UserGameAccountRecord,
  workspace: UserWorkspaceRecord,
  now = new Date(),
): FreePreviewWorkspaceProjection {
  const temporaryPermission = profile.temporary_permission
  if (!temporaryPermission || !hasFreePreviewTrialEnded(profile, now)) {
    return { workspace, changed: false }
  }
  const activityId = temporaryPermission.activity_id
  if (workspace.free_preview_normalized_activity_id === activityId) {
    return { workspace, changed: false }
  }

  const normalizedAt = temporaryPermission.ends_at
  const archiveId = `free-preview:${activityId}:advanced-config`
  const currentConfigNeedsDowngrade = Boolean(workspace.config && !resolveFreePreviewConfig(workspace.config).ok)
  const savedConfigs = workspace.saved_configs.map((item) => (
    resolveFreePreviewConfig(item.config).ok ? item : { ...item, read_only: true }
  ))
  if (currentConfigNeedsDowngrade && !savedConfigs.some((item) => item.id === archiveId)) {
    savedConfigs.unshift({
      id: archiveId,
      name: '体验期高级配置（只读）',
      config: workspace.config!,
      created_at: normalizedAt,
      updated_at: normalizedAt,
      last_used_at: null,
      read_only: true,
    })
  }

  return {
    changed: true,
    workspace: {
      ...workspace,
      config: currentConfigNeedsDowngrade ? getFreePreviewDefaultConfig() : workspace.config,
      saved_configs: savedConfigs.slice(0, WORKSPACE_SAVED_CONFIG_MAX_LIMIT),
      free_preview_normalized_activity_id: activityId,
      updated_at: normalizedAt,
    },
  }
}
