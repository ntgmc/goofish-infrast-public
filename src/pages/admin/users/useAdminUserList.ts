import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import { adminUserFiltersSchema, DEFAULT_ADMIN_USER_FILTERS, type AdminUserFilters } from '../../../lib/admin-user-filters'
import { requestAdminOperationReason } from '../../../lib/admin-operation-reason'
import { EMPTY_PAGINATION, type AdminUserSummary, type AppUserSummary, type PaginationMeta } from '../contracts'
import { downloadBlob, formatAdminProfileAccess, formatDownloadTimestamp } from '../shared/helpers'

interface Options {
  setAdminUsers: (users: AdminUserSummary[]) => void
  setBusyAction: (action: string | null) => void
  setError: (error: string | null) => void
  setNotice: (notice: string | null) => void
  closeDetail: () => void
}

export function useAdminUserList(options: Options) {
  const { setAdminUsers, setBusyAction, setError, setNotice, closeDetail } = options
  const [appUsers, setAppUsers] = useState<AppUserSummary[]>([])
  const [userSearchInput, setUserSearchInput] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [userPage, setUserPage] = useState(1)
  const [userPageSize, setUserPageSize] = useState(25)
  const [userPagination, setUserPagination] = useState<PaginationMeta>(EMPTY_PAGINATION)
  const [usersLoading, setUsersLoading] = useState(false)
  const [userFilters, setUserFilters] = useState<AdminUserFilters>(DEFAULT_ADMIN_USER_FILTERS)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const selectedUsers = useMemo(() => appUsers.filter((user) => selectedUserIds.includes(user.id)), [appUsers, selectedUserIds])

  useEffect(() => {
    setSelectedUserIds([])
    const timeout = window.setTimeout(() => {
      setUserSearch(userSearchInput.trim())
      setUserPage(1)
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [userSearchInput])

  useEffect(() => { setSelectedUserIds([]) }, [userPage, userPageSize, userSearch, userFilters])

  const loadUsersPage = useCallback(async (signal?: AbortSignal) => {
    const filters = adminUserFiltersSchema.safeParse(userFilters)
    if (!filters.success) {
      setAppUsers([])
      setUsersLoading(false)
      throw new Error(filters.error.issues.map((issue) => issue.message).join('；'))
    }
    setUsersLoading(true)
    try {
      const params = new URLSearchParams({ page: String(userPage), page_size: String(userPageSize), search: userSearch, ...filters.data })
      const data = await adminApiJson<{ users?: AdminUserSummary[]; app_users?: AppUserSummary[]; pagination?: PaginationMeta }>(`/api/admin/users?${params}`, { signal, fallbackMessage: '加载账号失败' })
      if (signal?.aborted) return
      setAdminUsers(data.users ?? [])
      setAppUsers(data.app_users ?? [])
      setUserPagination(data.pagination ?? { ...EMPTY_PAGINATION, page_size: userPageSize })
      if (data.pagination && data.pagination.page !== userPage) setUserPage(data.pagination.page)
    } finally {
      if (!signal?.aborted) setUsersLoading(false)
    }
  }, [userPage, userPageSize, userSearch, userFilters, setAdminUsers])

  const handleCopyUsers = async (field: 'id' | 'email') => {
    if (!selectedUsers.length || usersLoading) return
    setError(null)
    try {
      await navigator.clipboard.writeText(selectedUsers.map((user) => user[field]).join('\n'))
      setNotice(`已复制 ${selectedUsers.length} 个用户${field === 'id' ? ' ID，可粘贴到道具批量发放表单' : '邮箱'}。`)
    } catch (caught) { setError((caught as Error).message || '复制失败。') }
  }

  const handleExportUsers = () => {
    if (!selectedUsers.length || usersLoading) return
    const rows = [
      ['用户 ID', '邮箱', '状态', '邮箱验证时间', '档案权限', '档案数量', '注册时间', '最近上线时间'],
      ...selectedUsers.map((user) => [user.id, user.email, user.status, user.email_verified_at ?? '', formatAdminProfileAccess(user.profile_access), String(user.profile_count), user.created_at, user.last_seen_at ?? '']),
    ]
    const csv = rows.map((row) => row.map((value) => `"${(/^[\s]*[=+\-@]/.test(value) ? "'" : '') + value.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `users-${formatDownloadTimestamp()}.csv`)
    setNotice(`已导出 ${selectedUsers.length} 个用户。`)
  }

  const handleBulkUsers = async (action: 'freeze' | 'unfreeze') => {
    if (usersLoading) return
    const targets = selectedUsers.filter((user) => user.status === (action === 'freeze' ? 'active' : 'frozen'))
    const label = action === 'freeze' ? '冻结' : '解冻'
    if (!targets.length) return
    const reason = await requestAdminOperationReason({
      title: `批量${label}用户`,
      description: `确认${label} ${targets.length} 个用户？${action === 'freeze' ? '冻结后现有登录会话会失效，用户无法登录。' : '解冻后用户可以重新登录。'}`,
      confirmLabel: `确认${label}`,
    })
    if (!reason) return
    setBusyAction(`user-bulk-${action}`)
    setError(null)
    setNotice(null)
    try {
      const data = await adminApiJson<{
        succeeded: number; failed: number; results: Array<{ user_id: string; ok: boolean; error?: string }>
      }>('/api/admin/users', { method: 'PATCH', json: {
        action: action === 'freeze' ? 'batch_freeze_accounts' : 'batch_unfreeze_accounts',
        user_ids: targets.map((user) => user.id), reason,
      } })
      const failed = data.results.filter((item) => !item.ok)
      setSelectedUserIds(failed.map((item) => item.user_id))
      closeDetail()
      setNotice(`已${label} ${data.succeeded} 个用户，跳过 ${selectedUsers.length - targets.length} 个状态不适用的用户。`)
      setError(failed.length ? `${data.failed} 个用户失败：${failed.map((item) => `${item.user_id}：${item.error ?? '操作失败'}`).join('；')}` : null)
      try { await loadUsersPage() }
      catch (caught) { setError(`${failed.length ? `${data.failed} 个用户操作失败；` : ''}操作结果已保存，列表刷新失败：${(caught as Error).message}`) }
    } catch (caught) { setError((caught as Error).message) }
    finally { setBusyAction(null) }
  }

  return {
    appUsers, setAppUsers, userSearchInput, setUserSearchInput, userPage, setUserPage, userPageSize, setUserPageSize,
    userPagination, usersLoading, userFilters, setUserFilters, selectedUserIds, setSelectedUserIds,
    loadUsersPage, handleCopyUsers, handleExportUsers, handleBulkUsers,
  }
}
