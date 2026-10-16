import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { adminPath } from '../../../lib/app-routes'
import { operationsCohortLabels, operationsFailureLabels } from '../../../lib/operations-drilldown'
import type { AdminController } from '../useAdminController'
import { UserTable } from './UserTable'
import { UserDetailDialog } from './components'
import { omitFieldError, inputClassName } from '../shared/helpers'

export default function UsersSection({ model: c, active, search = '' }: { model: AdminController; active: boolean; search?: string }) {
  const requestedUser = new URLSearchParams(search).get('user_id')
  const requestedProfile = new URLSearchParams(search).get('profile_id')
  const openedUser = useRef<string | null>(null)
  useEffect(() => {
    if (!requestedUser) { openedUser.current = null; return }
    if (!active || !c.adminCapabilities.includes('sensitive_data_view') || openedUser.current === `${requestedUser}:${requestedProfile}`) return
    openedUser.current = `${requestedUser}:${requestedProfile}`
    void c.loadUserDetail({ id: requestedUser }, 1, requestedProfile ?? undefined)
  }, [active, requestedUser, requestedProfile, c.adminCapabilities, c.loadUserDetail])
  const [resetOpen, setResetOpen] = useState(false)
  const detailHeading = useRef<HTMLDivElement>(null)
  useEffect(() => { setResetOpen(false); c.setResetPassword('') }, [c.selectedUserDetail?.user.id, c.setResetPassword])
  return <section className="space-y-5">
    <div hidden={Boolean(c.selectedUserDetail)}>
      {c.operationsDrilldown && <div className="tool-panel mb-5 p-4" role="status">
        <h2 className="text-base font-semibold">{operationsCohortLabels[c.operationsDrilldown.cohort]}</h2>
        <p className="mt-2 text-sm text-ink-secondary">{c.operationsDrilldown.from} 至 {c.operationsDrilldown.to} · 北京时间 · 观察截至 {new Date(c.operationsDrilldown.observed_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</p>
        {c.operationsDrilldown.reason && <p className="mt-2 text-sm">{operationsFailureLabels[c.operationsDrilldown.reason] ?? '其他生成问题'}</p>}
        {c.operationsDrilldown.cohort.startsWith('maa_') && <p className="mt-2 text-sm text-ink-muted">按方案的文件获取情况筛选，同一用户的多个方案合并为一行。</p>}
        <Link className="ops-text-link mt-3 inline-block" to={adminPath('overview')}>返回运营看板 →</Link>
        <Link className="ml-4 text-sm text-brand-600" to={adminPath('users')}>查看全部用户</Link>
      </div>}
      <UserTable users={c.appUsers} selected={c.selectedUserIds} filters={c.userFilters} search={c.userSearchInput}
      pagination={c.userPagination} loading={c.usersLoading} busyAction={c.busyAction} capabilities={c.adminCapabilities}
      onFilters={(filters) => { c.setUserFilters(filters); c.setUserPage(1) }} onSearch={c.setUserSearchInput} onSelect={c.setSelectedUserIds} onPage={c.setUserPage}
      onPageSize={(size) => { c.setUserPageSize(size); c.setUserPage(1) }} onCopy={c.handleCopyUsers} onExport={c.handleExportUsers} onBulk={c.handleBulkUsers}
      onDetail={async (user) => { await c.loadUserDetail(user); requestAnimationFrame(() => detailHeading.current?.focus()) }} onFreeze={c.handleFreezeAppUser} onUnfreeze={c.handleUnfreezeAppUser} /></div>
    {c.adminCapabilities.includes('sensitive_data_view') && c.selectedUserDetail && <div ref={detailHeading} tabIndex={-1} className="space-y-5" aria-label="用户详情工作区">
      <div className="admin-actions"><button type="button" className="tool-secondary-action" onClick={() => { c.setSelectedUserDetail(null); setResetOpen(false) }}>返回用户列表</button>
        {c.adminCapabilities.includes('user_manage') && <button type="button" className="tool-secondary-action" aria-expanded={resetOpen} onClick={() => { c.setResetUserEmail(c.selectedUserDetail!.user.email); setResetOpen(!resetOpen) }}>重置密码</button>}</div>
      {resetOpen && c.adminCapabilities.includes('user_manage') && <form onSubmit={c.handleResetUserPassword} noValidate className="tool-panel p-5">
        <h2 className="text-lg font-semibold">重置用户密码</h2><p className="mt-2 text-sm text-ink-secondary">保存后该用户现有登录会话会失效。</p>
        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <label><span className="mb-2 block text-sm">用户邮箱</span><input id="admin-reset-email" readOnly value={c.resetUserEmail} className={inputClassName(Boolean(c.resetFieldErrors.resetUserEmail))} aria-invalid={Boolean(c.resetFieldErrors.resetUserEmail)} aria-describedby={c.resetFieldErrors.resetUserEmail ? 'admin-reset-email-error' : undefined} />
            {c.resetFieldErrors.resetUserEmail && <p id="admin-reset-email-error" className="mt-2 text-sm text-error" role="alert">{c.resetFieldErrors.resetUserEmail}</p>}</label>
          <label><span className="mb-2 block text-sm">新密码</span><input id="admin-reset-password" type="password" value={c.resetPassword} onChange={(e) => { c.setResetPassword(e.currentTarget.value); c.setResetFieldErrors((current) => omitFieldError(current, 'resetPassword')) }}
            className={inputClassName(Boolean(c.resetFieldErrors.resetPassword))} autoComplete="new-password" aria-invalid={Boolean(c.resetFieldErrors.resetPassword)} aria-describedby={c.resetFieldErrors.resetPassword ? 'admin-reset-password-error' : undefined} />
            {c.resetFieldErrors.resetPassword && <p id="admin-reset-password-error" className="mt-2 text-sm text-error" role="alert">{c.resetFieldErrors.resetPassword}</p>}</label>
          <button type="submit" disabled={c.busyAction === 'reset-password'} className="tool-primary-action">{c.busyAction === 'reset-password' ? '重置中…' : '确认重置'}</button></div>
      </form>}
      <UserDetailDialog inline active={active} initialProfileId={requestedProfile ?? undefined} capabilities={c.adminCapabilities} detail={c.selectedUserDetail} balance={c.selectedUserBalance} balanceLoading={c.userBalanceLoading}
        busyAction={c.busyAction} operatorDataByProfileId={c.operatorDataByProfileId} expandedOperatorProfileId={c.expandedOperatorProfileId}
        onClose={() => { c.setSelectedUserDetail(null); c.setSelectedUserBalance(null); c.setOperatorDataByProfileId({}); c.setExpandedOperatorProfileId(null); setResetOpen(false) }}
        onUpdateProfile={c.handleUpdateProfile} onSetProfileStatus={c.handleSetProfileStatus} onSetProfilePermission={c.handleSetProfilePermission} onUpgradePreviewProfile={c.handleUpgradePreviewProfile}
        onClearSklandBinding={c.handleClearProfileSklandBinding} onClearWorkspace={c.handleClearProfileWorkspace} onViewOperators={c.handleViewProfileOperators} onDownloadOperators={c.handleDownloadProfileOperators}
        onDownloadWorkspaces={c.handleDownloadUserWorkspaces} onLoadProfilePage={async (page) => { await c.loadUserDetail(c.selectedUserDetail!.user, page) }}
        onAdjustBalance={c.handleAdjustUserBalance} onLoadMoreBalance={c.handleLoadMoreUserBalance} onFreezeUser={c.handleFreezeAppUser} onUnfreezeUser={c.handleUnfreezeAppUser} onDeleteUser={c.handleDeleteAppUser} />
    </div>}
  </section>
}
