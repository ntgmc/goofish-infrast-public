import type { Dispatch, SetStateAction } from 'react'
import { requestAdminOperationReason } from '../../../lib/admin-operation-reason'
import { adminApiJson as apiJson } from '../../../lib/admin-api-client'
import {
  cdkProductPermissions,
  permissionLabels,
  type AdminProfileOperatorData,
  type AdminProfileSummary,
  type AdminUserDetail,
} from '../contracts'
import {
  isAppUserStatus,
  normalizeProductPermission,
  omitProfileOperatorData,
} from '../shared/helpers'

type ProfileAction =
  | 'update_profile'
  | 'set_profile_status'
  | 'set_profile_permission'
  | 'upgrade_preview_profile'
  | 'clear_profile_skland_binding'
  | 'clear_profile_workspace'

interface AdminProfileActionsOptions {
  selectedUserDetail: AdminUserDetail | null
  expandedOperatorProfileId: string | null
  setSelectedUserDetail: Dispatch<SetStateAction<AdminUserDetail | null>>
  setOperatorDataByProfileId: Dispatch<SetStateAction<Record<string, AdminProfileOperatorData>>>
  setExpandedOperatorProfileId: Dispatch<SetStateAction<string | null>>
  setBusyAction: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setNotice: Dispatch<SetStateAction<string | null>>
  refreshAdminData: () => Promise<void>
}

export function createAdminProfileActions(options: AdminProfileActionsOptions) {
  const requestOperationReason = (message: string) => requestAdminOperationReason({
    title: '确认管理员操作',
    description: message,
  })

  const patchUserProfile = async (
    profile: AdminProfileSummary,
    action: ProfileAction,
    reason: string,
    extraBody: Record<string, unknown> = {},
  ) => {
    if (!options.selectedUserDetail) return
    options.setBusyAction(`profile:${action}:${profile.id}`)
    options.setError(null)
    options.setNotice(null)
    try {
      const data = await apiJson<{ detail?: AdminUserDetail }>('/api/admin/users', {
        method: 'PATCH',
        json: {
          action,
          user_id: options.selectedUserDetail.user.id,
          profile_id: profile.id,
          expected_updated_at: profile.updated_at,
          reason,
          ...extraBody,
        },
        fallbackMessage: '档案操作失败',
      })
      if (!data.detail) throw new Error('档案操作失败')
      options.setSelectedUserDetail(data.detail)
      options.setOperatorDataByProfileId((current) => omitProfileOperatorData(current, profile.id))
      if (options.expandedOperatorProfileId === profile.id) options.setExpandedOperatorProfileId(null)
      options.setNotice('档案已更新')
      await options.refreshAdminData()
    } catch (caught) {
      options.setError((caught as Error).message)
    } finally {
      options.setBusyAction(null)
    }
  }

  const handleUpdateProfile = async (profile: AdminProfileSummary) => {
    const displayName = window.prompt('请输入档案名称。', profile.display_name)
    if (displayName === null) return
    const note = window.prompt('请输入档案备注，留空可清除备注。', profile.note ?? '')
    if (note === null) return
    const reason = await requestOperationReason('请输入修改档案名称/备注的原因。')
    if (!reason) return
    await patchUserProfile(profile, 'update_profile', reason, { display_name: displayName.trim(), note: note.trim() })
  }

  const handleSetProfileStatus = async (profile: AdminProfileSummary) => {
    const status = window.prompt('请输入档案状态：active / frozen / revoked', profile.status)
    if (status === null) return
    if (!isAppUserStatus(status.trim())) {
      options.setNotice(null)
      options.setError('档案状态必须是 active、frozen 或 revoked。')
      return
    }
    if (!window.confirm(`确认将档案「${profile.display_name}」状态从 ${profile.status} 改为 ${status.trim()}？`)) return
    const reason = await requestOperationReason(`档案「${profile.display_name}」状态：${profile.status} → ${status.trim()}。请输入操作原因。`)
    if (!reason) return
    await patchUserProfile(profile, 'set_profile_status', reason, { status: status.trim() })
  }

  const handleSetProfilePermission = async (profile: AdminProfileSummary) => {
    const nextPermission = window.prompt(
      `请输入档案权限：${cdkProductPermissions.join(' / ')}`,
      normalizeProductPermission(profile.permission) ?? 'growth',
    )
    if (nextPermission === null) return
    const permission = normalizeProductPermission(nextPermission.trim())
    if (!permission) {
      options.setNotice(null)
      options.setError('档案权限必须是 recommended、growth、advanced 或 ultimate。')
      return
    }
    if (!window.confirm(`确认将档案「${profile.display_name}」权限改为${permissionLabels[permission]}？`)) return
    const reason = await requestOperationReason(`档案「${profile.display_name}」权限将改为${permissionLabels[permission]}。请输入操作原因。`)
    if (!reason) return
    await patchUserProfile(profile, 'set_profile_permission', reason, { permission })
  }

  const handleUpgradePreviewProfile = async (profile: AdminProfileSummary) => {
    const nextPermission = window.prompt(
      `请选择免 CDK 升级后的档案权限：${cdkProductPermissions.join(' / ')}`,
      'growth',
    )
    if (nextPermission === null) return
    const permission = normalizeProductPermission(nextPermission.trim())
    if (!permission) {
      options.setNotice(null)
      options.setError('档案权限必须是 recommended、growth、advanced 或 ultimate。')
      return
    }
    if (!window.confirm(`确认将档案「${profile.display_name}」免 CDK 升级为${permissionLabels[permission]}？此操作不可撤销。`)) return
    const reason = await requestOperationReason(`档案「${profile.display_name}」将免 CDK 升级为${permissionLabels[permission]}。请输入业务原因。`)
    if (!reason) return
    await patchUserProfile(profile, 'upgrade_preview_profile', reason, { permission })
  }

  const handleClearProfileSklandBinding = async (profile: AdminProfileSummary) => {
    if (!window.confirm(`确认清空档案「${profile.display_name}」的森空岛绑定和风控计数？关联 CDK 的旧干员基线也会重置，下一次有效导入将自动成为新基线。`)) return
    const reason = await requestOperationReason(`档案「${profile.display_name}」将清除森空岛绑定并重置关联 CDK 干员基线。请输入操作原因。`)
    if (!reason) return
    await patchUserProfile(profile, 'clear_profile_skland_binding', reason)
  }

  const handleClearProfileWorkspace = async (profile: AdminProfileSummary) => {
    if (!window.confirm(`确认清空档案「${profile.display_name}」的工作区？干员、配置和最近结果都会重置为空摘要。`)) return
    const reason = await requestOperationReason(`档案「${profile.display_name}」的工作区将被清空。请输入操作原因。`)
    if (!reason) return
    await patchUserProfile(profile, 'clear_profile_workspace', reason, {
      expected_workspace_updated_at: profile.workspace.updated_at,
    })
  }

  return {
    handleUpdateProfile,
    handleSetProfileStatus,
    handleSetProfilePermission,
    handleUpgradePreviewProfile,
    handleClearProfileSklandBinding,
    handleClearProfileWorkspace,
  }
}
