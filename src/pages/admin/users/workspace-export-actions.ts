import { adminApiBlob } from '../../../lib/admin-api-client'
import { buildUserWorkspaceExportFilename, downloadBlob } from '../shared/helpers'

export async function downloadAdminUserWorkspaces(options: {
  userId: string
  profileIds?: string[]
  setBusyAction: (value: string | null) => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
}): Promise<boolean> {
  if (options.profileIds?.length === 0) {
    options.setError('请至少选择一个账号。')
    return false
  }
  options.setBusyAction(`user-workspaces-export:${options.userId}`)
  options.setError(null)
  options.setNotice(null)
  try {
    const params = new URLSearchParams({ user_id: options.userId, include: 'workspaces' })
    options.profileIds?.forEach((profileId) => params.append('profile_id', profileId))
    const blob = await adminApiBlob(
      `/api/admin/users?${params}`,
      { fallbackMessage: '导出完整工作区数据失败' },
    )
    downloadBlob(blob, buildUserWorkspaceExportFilename(options.userId))
    options.setNotice('已开始下载完整工作区数据')
    return true
  } catch (caught) {
    options.setError((caught as Error).message)
    return false
  } finally {
    options.setBusyAction(null)
  }
}
