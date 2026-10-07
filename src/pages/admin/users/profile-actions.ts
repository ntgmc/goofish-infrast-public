import type { Dispatch, SetStateAction } from 'react'
import { requestAdminOperationEdit, requestAdminOperationReason } from '../../../lib/admin-operation-reason'
import { adminApiJson as apiJson } from '../../../lib/admin-api-client'
import { cdkProductPermissions, permissionLabels, type AdminProfileOperatorData, type AdminProfileSummary, type AdminUserDetail } from '../contracts'
import { isAppUserStatus, normalizeProductPermission, omitProfileOperatorData } from '../shared/helpers'

type ProfileAction = 'update_profile' | 'set_profile_status' | 'set_profile_permission' | 'upgrade_preview_profile' | 'clear_profile_skland_binding' | 'clear_profile_workspace'
interface AdminProfileActionsOptions {
  selectedUserDetail: AdminUserDetail | null
  loadUserDetail: (user: AdminUserDetail['user'], page: number) => Promise<AdminUserDetail | null>
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
  const patchUserProfile = async (profile: AdminProfileSummary, action: ProfileAction, reason: string, extraBody: Record<string, unknown> = {}): Promise<string | null> => {
    if (!options.selectedUserDetail) return '请重新选择用户。'
    options.setBusyAction(`profile:${action}:${profile.id}`)
    options.setError(null)
    options.setNotice(null)
    try {
      const data = await apiJson<{ detail?: AdminUserDetail }>('/api/admin/users', { method: 'PATCH', json: {
        action, user_id: options.selectedUserDetail.user.id, profile_id: profile.id, expected_updated_at: profile.updated_at, reason, ...extraBody,
      }, fallbackMessage: '档案操作失败' })
      if (!data.detail) throw new Error('档案操作失败')
      options.setSelectedUserDetail(data.detail)
      options.setOperatorDataByProfileId((current) => omitProfileOperatorData(current, profile.id))
      if (options.expandedOperatorProfileId === profile.id) options.setExpandedOperatorProfileId(null)
      options.setNotice('档案已更新')
      await options.refreshAdminData()
      return null
    } catch (caught) {
      const message = (caught as Error).message
      options.setError(message)
      return message
    } finally { options.setBusyAction(null) }
  }
  const editProfile = (profile: AdminProfileSummary, action: ProfileAction, request: Omit<Parameters<typeof requestAdminOperationEdit>[0], 'onSubmit' | 'onRefresh'>) => {
    let currentProfile = profile
    return requestAdminOperationEdit({ ...request,
      onRefresh: async () => {
        if (!options.selectedUserDetail) throw new Error('请重新选择用户。')
        const detail = await options.loadUserDetail(options.selectedUserDetail.user, options.selectedUserDetail.profile_pagination?.page ?? 1)
        const refreshedProfile = detail?.profiles.find((item) => item.id === profile.id)
        if (!refreshedProfile) throw new Error('无法刷新该档案，请重新选择用户并核对档案。')
        currentProfile = refreshedProfile
      },
      onSubmit: (values, reason) => {
        if ('status' in values && !isAppUserStatus(values.status)) return Promise.resolve('请选择有效的档案状态。')
        if ('permission' in values && !normalizeProductPermission(values.permission)) return Promise.resolve('请选择有效的档案权限。')
        return patchUserProfile(currentProfile, action, reason, values)
      },
    })
  }
  const handleUpdateProfile = (profile: AdminProfileSummary) => editProfile(profile, 'update_profile', {
    title: '修改档案资料', description: `用户 ${options.selectedUserDetail?.user.email}，档案「${profile.display_name}」。请核对名称和备注后保存。`, confirmLabel: '保存资料',
    fields: [{ name: 'display_name', label: '档案名称', value: profile.display_name, required: true, maxLength: 40 }, { name: 'note', label: '档案备注', value: profile.note ?? '', maxLength: 500 }],
  })
  const handleSetProfileStatus = (profile: AdminProfileSummary) => editProfile(profile, 'set_profile_status', {
    title: '修改档案状态', description: `档案「${profile.display_name}」当前状态为 ${profile.status}。`, confirmLabel: '确认修改状态',
    fields: [{ name: 'status', label: '新状态', value: profile.status, required: true, options: [{ value: 'active', label: '正常' }, { value: 'frozen', label: '冻结' }, { value: 'revoked', label: '撤销' }] }],
  })
  const editPermission = (profile: AdminProfileSummary, upgrade: boolean) => editProfile(profile, upgrade ? 'upgrade_preview_profile' : 'set_profile_permission', {
    title: upgrade ? '免 CDK 升级' : '修改档案权限',
    description: `档案「${profile.display_name}」当前权限为 ${getPermissionLabel(profile.permission)}。${upgrade ? '免 CDK 升级后无法恢复为免费预览档案。' : '请选择新权限并填写操作原因。'}`,
    confirmLabel: upgrade ? '确认升级' : '确认修改权限',
    fields: [{ name: 'permission', label: '新权限', value: normalizeProductPermission(profile.permission) ?? 'growth', required: true,
      options: cdkProductPermissions.map((value) => ({ value, label: permissionLabels[value] })) }],
  })
  const handleClearProfileSklandBinding = async (profile: AdminProfileSummary) => {
    if (!window.confirm(`确认清空档案「${profile.display_name}」的森空岛绑定和风控计数？关联 CDK 的旧干员基线也会重置，下一次有效导入将自动成为新基线。`)) return
    const reason = await requestAdminOperationReason({ title: '确认管理员操作', description: `档案「${profile.display_name}」将清除森空岛绑定并重置关联 CDK 干员基线。请输入操作原因。` })
    if (reason) await patchUserProfile(profile, 'clear_profile_skland_binding', reason)
  }
  const handleClearProfileWorkspace = async (profile: AdminProfileSummary) => {
    if (!window.confirm(`确认清空档案「${profile.display_name}」的工作区？干员、配置和最近结果都会重置为空摘要。`)) return
    const reason = await requestAdminOperationReason({ title: '确认管理员操作', description: `档案「${profile.display_name}」的工作区将被清空。请输入操作原因。` })
    if (reason) await patchUserProfile(profile, 'clear_profile_workspace', reason, { expected_workspace_updated_at: profile.workspace.updated_at })
  }
  return { handleUpdateProfile, handleSetProfileStatus,
    handleUpgradePreviewProfile: (profile: AdminProfileSummary) => editPermission(profile, true),
    handleSetProfilePermission: (profile: AdminProfileSummary) => editPermission(profile, false),
    handleClearProfileSklandBinding, handleClearProfileWorkspace }
}
function getPermissionLabel(value: string) { const permission = normalizeProductPermission(value); return permission ? permissionLabels[permission] : value }
