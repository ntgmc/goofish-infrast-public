import { adminApiBlob } from '../../../lib/admin-api-client'
import { buildUserWorkspaceExportFilename, downloadBlob } from '../shared/helpers'

export async function downloadAdminUserWorkspaces(options: {
  userId: string
  setBusyAction: (value: string | null) => void
  setError: (value: string | null) => void
  setNotice: (value: string | null) => void
}): Promise<void> {
  options.setBusyAction(`user-workspaces-export:${options.userId}`)
  options.setError(null)
  options.setNotice(null)
  try {
    const blob = await adminApiBlob(
      `/api/admin/users?user_id=${encodeURIComponent(options.userId)}&include=workspaces`,
      { fallbackMessage: '导出完整工作区数据失败' },
    )
    downloadBlob(blob, buildUserWorkspaceExportFilename(options.userId))
    options.setNotice('已开始下载完整工作区数据')
  } catch (caught) {
    options.setError((caught as Error).message)
  } finally {
    options.setBusyAction(null)
  }
}
