import { LayoutGroup } from 'motion/react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { adminPath, fallbackAdminPath, resolveAdminSection } from '../../lib/app-routes'
import { AnimatedPresenceRegion, MotionNavIndicator } from '../../components/MotionPrimitives'
import BrandLogo from '../../components/BrandLogo'
import CompactHeaderMenu from '../../components/CompactHeaderMenu'
import SessionLoader from '../../components/SessionLoader'
import InvitationSettingsSection from './invitations/InvitationSettingsSection'
import RegistrationSettingsSection from './registration/RegistrationSettingsSection'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import QueueMonitorPanel from './optimization/QueueMonitorPanel'
import FeatureSettingsSection from './features/FeatureSettingsSection'
import PublicContentSettingsSection from './content/PublicContentSettingsSection'
import AnnouncementSettingsSection from './announcements/AnnouncementSettingsSection'
import InventoryAdminSection from './inventory/InventoryAdminSection'
import BehaviorRiskPanel from './risk/BehaviorRiskPanel'

import { GeneratedPermission, AdminSection, UsageRangeKey, permissionLabels, sectionLabels, cdkProductPermissions, MAX_CDK_BATCH_COUNT, UserDetailDialog, CdkTable, CdkDetailDialog, RiskSettingsPanel, RiskTable, Metric, EMPTY_LATENCY_STATS, EMPTY_SKLAND_STATS, EMPTY_ANNOUNCEMENT_STATS, FunnelPanel, FailureReasonPanel, LatencyPanel, OpsSummaryPanel, SklandPanel, AnnouncementStatsPanel, CdkDistributionPanel, CdkRecordDistributionPanel, RiskConsoleSummary, RiskTrendPanel, RiskReasonPanel, UsageTrendChart, UserStatusPill, SmallButton, formatDate, formatDuration, omitFieldError, inputClassName, formatAdminProfileAccess } from './modules'
import { useAdminController } from './useAdminController'
import { PaginationControls } from './shared/PaginationControls'
import { AdminToast } from './shared/AdminToast'
import type { AdminCapability } from './contracts'

function canAccessAdminSection(section: AdminSection, capabilities: AdminCapability[]): boolean {
  if (section === 'overview') return capabilities.includes('usage_view') || capabilities.includes('risk_view')
  if (section === 'risk') return capabilities.includes('risk_view')
  if (section === 'users') return capabilities.includes('user_view')
  if (section === 'queue') return capabilities.includes('optimization_view')
  return capabilities.includes('admin_manage')
}

export default function AdminDashboardView() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection = resolveAdminSection(location.pathname)
  const setActiveSection = (section: AdminSection) => navigate(adminPath(section))
  const { adminCapabilities, lastSuccessfulSyncAt, overviewPartialFailure, cdkSearchInput, setCdkSearchInput, setCdkPage, setCdkPageSize, cdkPagination, cdkLoading, userSearchInput, setUserSearchInput, setUserPage, setUserPageSize, userPagination, usersLoading, setRiskPage, setRiskPageSize, riskPagination, riskLoading, permission, cdkType, setCdkType, setCdkTypeFilter, balanceAmount, setBalanceAmount, adminUsername, loginUser, setLoginUser, loginPassword, setLoginPassword, authenticated, sessionChecking, setStatusFilter, setPermission, setPermissionFilter, setRiskFilter, setGeneratedFilter, appUsers, usageRange, setUsageRange, usageRangeFrom, setUsageRangeFrom, usageRangeTo, setUsageRangeTo, usageStats, banner, announcements, announcementStats, announcementDraftStatus, announcementDraftSavedAt, announcementDraftRestored, announcementDraftConflict, announcementDraftError, announcementDraftDirty, riskSettings, orderNote, setOrderNote, cdkCount, setCdkCount, generatedCodes, selectedCdkHashes, setSelectedCdkHashes, selectedCdkDetail, setSelectedCdkDetail, selectedUserDetail, setSelectedUserDetail, selectedUserBalance, setSelectedUserBalance, userBalanceLoading, operatorDataByProfileId, setOperatorDataByProfileId, expandedOperatorProfileId, setExpandedOperatorProfileId, resetUserEmail, setResetUserEmail, resetPassword, setResetPassword, loginFieldErrors, setLoginFieldErrors, resetFieldErrors, setResetFieldErrors, loading, busyAction, error, notice, clearNotice, summary, cdkOpsSummary, cdkFilters, visibleRecords, riskRecords, loadDashboard, handleLogin, handleLogout, handleExportUsageReport, handleGenerateCdk, handleCopyGeneratedCdks, handleDownloadGeneratedCdks, handleSaveAnnouncement, handleDiscardAnnouncementDraft, handleSaveRiskSettings, updateBanner, addAnnouncement, updateAnnouncement, deleteAnnouncement, reorderAnnouncements, patchCdk, deleteCdk, loadCdkDetail, handleUpdateCdkNote, handleSetCdkPermission, handleBulkRevoke, loadUserDetail, handleLoadMoreUserBalance, handleAdjustUserBalance, handleViewProfileOperators, handleDownloadProfileOperators, handleDownloadUserWorkspaces, handleUpdateProfile, handleSetProfileStatus, handleSetProfilePermission, handleUpgradePreviewProfile, handleClearProfileSklandBinding, handleClearProfileWorkspace, handleResetUserPassword, handleFreezeAppUser, handleUnfreezeAppUser, handleDeleteAppUser } = useAdminController()
  const visibleSections = (Object.keys(sectionLabels) as AdminSection[])
    .filter((section) => canAccessAdminSection(section, adminCapabilities))
  const canManageAdmins = adminCapabilities.includes('admin_manage')

  if (!activeSection) return <Navigate to={fallbackAdminPath()} replace />

  if (sessionChecking) {
    return <SessionLoader label="正在检查管理员会话…" />
  }

  if (authenticated && !canAccessAdminSection(activeSection, adminCapabilities)) {
    return <Navigate to={adminPath('overview')} replace />
  }

  if (!authenticated) {
      return (
        <main className="tool-page" tabIndex={-1} data-route-focus>
          <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_380px]">
            <section>
              <div className="max-w-2xl">
                <p className="section-index">MAA 基建管理后台</p>
                <h1 className="display-title mt-3 text-3xl text-ink-primary sm:text-4xl">管理工作台</h1>
              </div>
            </section>
          <form onSubmit={handleLogin} noValidate className="tool-panel p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink-primary">账号登录</h2>
              <ThemeSwitcher />
            </div>
            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">账号</span>
              <input
                id="admin-login-user"
                value={loginUser}
                onChange={(event) => {
                  setLoginUser(event.currentTarget.value)
                  setLoginFieldErrors((current) => omitFieldError(current, 'loginUser'))
                }}
                onFocus={() => setLoginFieldErrors((current) => omitFieldError(current, 'loginUser'))}
                className={inputClassName(Boolean(loginFieldErrors.loginUser))}
                autoComplete="username"
                aria-invalid={Boolean(loginFieldErrors.loginUser)}
                aria-describedby={loginFieldErrors.loginUser ? 'admin-login-user-error' : undefined}
              />
              {loginFieldErrors.loginUser && <p id="admin-login-user-error" className="mt-1.5 text-sm text-error" role="alert">{loginFieldErrors.loginUser}</p>}
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">密码</span>
              <input
                id="admin-login-password"
                type="password"
                value={loginPassword}
                onChange={(event) => {
                  setLoginPassword(event.currentTarget.value)
                  setLoginFieldErrors((current) => omitFieldError(current, 'loginPassword'))
                }}
                onFocus={() => setLoginFieldErrors((current) => omitFieldError(current, 'loginPassword'))}
                className={inputClassName(Boolean(loginFieldErrors.loginPassword))}
                autoComplete="current-password"
                aria-invalid={Boolean(loginFieldErrors.loginPassword)}
                aria-describedby={loginFieldErrors.loginPassword ? 'admin-login-password-error' : undefined}
              />
              {loginFieldErrors.loginPassword && <p id="admin-login-password-error" className="mt-1.5 text-sm text-error" role="alert">{loginFieldErrors.loginPassword}</p>}
            </label>
              {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
            <button type="submit" disabled={loading} className="tool-primary-action mt-5 w-full">
                {loading ? '正在登录…' : '进入后台'}
              </button>
            </form>
          </div>
        </main>
      )
    }

  const syncStatus = loading
    ? '正在同步数据'
    : lastSuccessfulSyncAt
      ? `最近成功同步 ${formatDate(lastSuccessfulSyncAt)}${overviewPartialFailure ? '（部分数据失败）' : ''}`
      : '尚未完成成功同步'

  return (
      <div className="tool-shell">
        <aside className="tool-sidebar fixed inset-y-0 left-0 hidden w-64 px-4 py-5 lg:block">
          <div className="px-2">
            <p className="section-index">MAA 管理后台</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{adminUsername}</p>
          </div>
          <LayoutGroup id="admin-desktop">
            <nav className="mt-8 space-y-1">
              {visibleSections.map((section) => (
                <button key={section} type="button" onClick={() => setActiveSection(section)} aria-current={activeSection === section ? 'page' : undefined} className="tool-nav-link w-full px-3 text-left">
                  {activeSection === section && <MotionNavIndicator layoutId="admin-active" />}
                  <span className="relative z-10">{sectionLabels[section]}</span>
                </button>
              ))}
            </nav>
          </LayoutGroup>
          <button type="button" onClick={handleLogout} className="tool-secondary-action absolute bottom-5 left-4 right-4">退出登录</button>
        </aside>
  
        <main className="lg:pl-64" tabIndex={-1} data-route-focus>
          <header className="tool-header sticky top-0 z-20 bg-surface-0/95 px-4 py-1.5 backdrop-blur lg:px-8 lg:py-4">
            <div className="flex h-11 items-center justify-between gap-2 lg:hidden">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <BrandLogo size="sm" />
                <CompactHeaderMenu
                  ariaLabel="打开栏目菜单"
                  triggerLabel={sectionLabels[activeSection]}
                  align="start"
                  className="min-w-0 flex-1 justify-between"
                  metadata={{ title: adminUsername ?? '', description: syncStatus }}
                  items={[
                    ...visibleSections.map((section) => ({
                      type: 'button' as const,
                      id: section,
                      label: sectionLabels[section],
                      current: activeSection === section,
                      onSelect: () => setActiveSection(section),
                    })),
                    { type: 'separator' as const, id: 'actions' },
                    { type: 'button' as const, id: 'refresh', label: '刷新数据', onSelect: () => void loadDashboard() },
                    ...(canManageAdmins ? [{ type: 'link' as const, id: 'settings', label: '账号设置', to: '/admin/setup' }] : []),
                    { type: 'button' as const, id: 'logout', label: '退出登录', intent: 'danger' as const, onSelect: handleLogout },
                  ]}
                />
              </div>
              <ThemeSwitcher iconOnly />
            </div>

            <div className="hidden items-center justify-between gap-4 lg:flex">
              <div>
                <h1 className="text-xl font-semibold text-ink-primary">{sectionLabels[activeSection]}</h1>
                <p className="mt-1 text-sm text-ink-muted">{syncStatus}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ThemeSwitcher />
                <button type="button" onClick={() => void loadDashboard()} className="tool-secondary-action">刷新数据</button>
                {canManageAdmins && <Link to="/admin/setup" className="tool-primary-action">账号设置</Link>}
              </div>
            </div>
          </header>
  
          <div className="px-5 py-6 sm:px-8">
            {error && <div className="tool-alert tool-alert--error mb-5" role="alert">{error}</div>}
            {notice && <AdminToast message={notice} onDismiss={clearNotice} />}

            <AnimatedPresenceRegion motionKey={activeSection}>
            {activeSection === 'overview' && (
              <section className="space-y-6">
                <div className="tool-panel flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-ink-primary">运营概览</h2>
                    <p className="mt-1 text-sm text-ink-muted">
                      {usageStats?.range.from && usageStats?.range.to ? `${usageStats.range.from} 至 ${usageStats.range.to}` : '选择统计范围'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['7d', '14d', '30d'] as UsageRangeKey[]).map((range) => (
                      <button
                        key={range}
                        type="button"
                        onClick={() => setUsageRange(range)}
                        aria-pressed={usageRange === range}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 ${usageRange === range ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'}`}
                      >
                        {range === '7d' ? '7 天' : range === '14d' ? '14 天' : '30 天'}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setUsageRange('custom')}
                      aria-pressed={usageRange === 'custom'}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 ${usageRange === 'custom' ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'}`}
                    >
                      自定义
                    </button>
                    {usageRange === 'custom' && (
                      <div className="tool-inset flex flex-wrap items-center gap-2 px-2 py-1.5">
                        <input
                          type="date"
                          value={usageRangeFrom}
                          max={usageRangeTo}
                          onChange={(event) => setUsageRangeFrom(event.currentTarget.value)}
                          className="tool-field w-auto px-2"
                          aria-label="统计开始日期"
                        />
                        <span className="text-xs text-ink-muted">至</span>
                        <input
                          type="date"
                          value={usageRangeTo}
                          min={usageRangeFrom}
                          onChange={(event) => setUsageRangeTo(event.currentTarget.value)}
                          className="tool-field w-auto px-2"
                          aria-label="统计结束日期"
                        />
                      </div>
                    )}
                    <button type="button" onClick={() => void handleExportUsageReport('csv')} disabled={busyAction === 'report:csv'} className="tool-secondary-action px-3 text-sm">
                      {busyAction === 'report:csv' ? '导出中…' : '导出 CSV'}
                    </button>
                    <button type="button" onClick={() => void handleExportUsageReport('json')} disabled={busyAction === 'report:json'} className="tool-secondary-action px-3 text-sm">
                      {busyAction === 'report:json' ? '导出中…' : '导出 JSON'}
                    </button>
                  </div>
                </div>
                {usageStats && (
                  <div className={usageStats.completeness.complete ? 'tool-alert' : 'tool-alert tool-alert--warning'} role="status">
                    <p className="font-medium">
                      统计日期按 UTC 自然日，原始事件保留 {usageStats.completeness.retention_days || '-'} 天；指标版本 {usageStats.metrics_version}。
                    </p>
                    <p className="mt-1 text-xs">
                      数据生成时间：{usageStats.generated_at || '-'}。{usageStats.completeness.complete
                        ? '当前范围内未发现状态缺失事件。'
                        : `当前范围数据不完整：${usageStats.completeness.unknown_status_events} 条事件缺少状态${usageStats.completeness.raw_events_truncated ? `，且原始事件超过 ${usageStats.completeness.raw_event_limit} 条读取上限` : ''}；成功率与失败分析仅供参考。`}
                    </p>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="免费预览新增" value={summary.freePreviews} />
                  <Metric label="注册数" value={summary.registers} />
                  <Metric label="CDK 兑换" value={summary.cdkRedeems} />
                  <Metric label="排班生成" value={summary.scheduleGenerates} />
                  <Metric label="生成成功率" value={`${summary.scheduleSuccessRate}%`} tone={summary.scheduleSuccessRate < 80 && summary.scheduleAttempts > 0 ? 'warning' : 'default'} />
                  <Metric label="平均单次计算耗时" value={formatDuration(usageStats?.latency.schedule_generate.average_ms ?? 0)} />
                  <Metric label="P95 单次计算耗时" value={formatDuration(usageStats?.latency.schedule_generate.p95_ms ?? 0)} tone={(usageStats?.latency.schedule_generate.p95_ms ?? 0) > 10000 ? 'warning' : 'default'} />
                  <Metric label="冻结/软拦截" value={summary.frozenCdks + summary.riskEvents} tone={summary.frozenCdks + summary.riskEvents > 0 ? 'warning' : 'default'} />
                </div>
                <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                  <section className="tool-panel p-5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold text-ink-primary">趋势</h2>
                      <span className="text-xs text-ink-muted">访问 / 生成 / CDK 兑换与免费预览新增</span>
                    </div>
                    <UsageTrendChart days={usageStats?.days ?? []} />
                  </section>
                  <FunnelPanel steps={usageStats?.funnel ?? []} />
                </div>
                <div className="grid gap-5 xl:grid-cols-2">
                  <FailureReasonPanel reasons={usageStats?.failure_reasons ?? []} samples={usageStats?.recent_failures ?? []} />
                  <LatencyPanel stats={usageStats?.latency.schedule_generate ?? EMPTY_LATENCY_STATS} />
                </div>
                <div className="grid gap-5 xl:grid-cols-3">
                  <OpsSummaryPanel summary={summary} />
                  <SklandPanel stats={usageStats?.skland ?? EMPTY_SKLAND_STATS} />
                  <AnnouncementStatsPanel stats={usageStats?.announcement ?? EMPTY_ANNOUNCEMENT_STATS} />
                </div>
                <CdkDistributionPanel items={usageStats?.cdk_distribution ?? []} />
              </section>
            )}

            {activeSection === 'queue' && <QueueMonitorPanel />}
  
        {activeSection === 'cdk' && (
          <section className="space-y-5">
            <form onSubmit={handleGenerateCdk} className="tool-panel p-5">
              <div className="grid gap-4 lg:grid-cols-[180px_220px_140px_1fr_auto] lg:items-end">
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK 类型</span>
                  <select value={cdkType} onChange={(event) => setCdkType(event.currentTarget.value as 'profile' | 'balance' | 'item')} className="tool-field">
                    <option value="profile">档案兑换</option>
                    <option value="balance">余额兑换</option>
                    <option value="item">道具兑换</option>
                  </select>
                </label>
                {cdkType === 'profile' ? <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">授权类型</span>
                  <select value={permission} onChange={(event) => setPermission(event.currentTarget.value as GeneratedPermission)} className="tool-field">
                    {cdkProductPermissions.map((item) => <option key={item} value={item}>{permissionLabels[item]}</option>)}
                  </select>
                </label> : cdkType === 'balance' ? <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">积分面额</span>
                  <input value={balanceAmount} onChange={(event) => setBalanceAmount(event.currentTarget.value)} inputMode="decimal" pattern="\d+(\.\d{1,2})?" className="tool-field" required />
                </label> : <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">道具类型</span>
                  <select name="item_code" className="tool-field" defaultValue="lifetime_profile_voucher">
                    <option value="lifetime_profile_voucher">终身版兑换 CDK</option>
                    <option value="limited_profile_voucher" disabled={Date.now() < Date.parse('2026-07-17T04:00:00.000Z') || Date.now() >= Date.parse('2026-08-19T16:00:00.000Z')}>限时 CDK（2026-08-20 00:00 到期）</option>
                  </select>
                </label>}
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">生成数量</span>
                  <input type="number" min={1} max={MAX_CDK_BATCH_COUNT} step={1} value={cdkCount} onChange={(event) => setCdkCount(event.currentTarget.value)} className="tool-field" />
                </label>
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">订单备注</span>
                  <input value={orderNote} maxLength={120} onChange={(event) => setOrderNote(event.currentTarget.value)} className="tool-field" placeholder="闲鱼订单号、用户昵称或售后备注" />
                </label>
                <button type="submit" disabled={busyAction === 'generate'} className="tool-primary-action">{busyAction === 'generate' ? '生成中…' : '生成 CDK'}</button>
              </div>
              {generatedCodes.length > 0 && (
                <div className="mt-4 border-t border-surface-3 pt-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-ink-primary">已生成 {generatedCodes.length} 个 CDK</div>
                      <div className="mt-1 text-xs text-ink-muted">{generatedCodes[0].cdk_type === 'balance' ? `余额 ${generatedCodes[0].amount} 积分` : generatedCodes[0].cdk_type === 'item' ? `${generatedCodes[0].item_name ?? generatedCodes[0].item_code}${generatedCodes[0].item_expires_at ? ` · ${formatDate(generatedCodes[0].item_expires_at)} 到期` : ''}` : permissionLabels[generatedCodes[0].permission!]} · {formatDate(generatedCodes[0].created_at)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={handleCopyGeneratedCdks} className="tool-secondary-action">{generatedCodes.length === 1 ? '复制 CDK' : '复制全部'}</button>
                      <button type="button" onClick={handleDownloadGeneratedCdks} className="tool-secondary-action">下载 CSV</button>
                    </div>
                  </div>
                  <div className="tool-inset mt-3 max-h-64 overflow-auto">
                    {generatedCodes.map((item) => (
                      <div key={item.code} className="flex flex-col gap-1 border-b border-surface-3 px-3 py-2 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                        <span className="break-all font-mono text-sm font-semibold text-ink-primary">{item.code}</span>
                        <span className="text-xs text-ink-muted">{formatDate(item.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </form>
                <CdkRecordDistributionPanel summary={cdkOpsSummary} />
                <CdkTable
                  records={visibleRecords}
                  selected={selectedCdkHashes}
                  filters={cdkFilters}
                  search={cdkSearchInput}
                  pagination={cdkPagination}
                  loading={cdkLoading}
                  busyAction={busyAction}
                  onSearchChange={setCdkSearchInput}
                  onPageChange={setCdkPage}
                  onPageSizeChange={(size) => { setCdkPageSize(size); setCdkPage(1) }}
                  onFilterChange={(patch) => {
                    if (patch.status) setStatusFilter(patch.status)
                    if (patch.cdk_type) setCdkTypeFilter(patch.cdk_type)
                    if (patch.permission) setPermissionFilter(patch.permission)
                    if (patch.risk) setRiskFilter(patch.risk)
                    if (patch.generated) setGeneratedFilter(patch.generated)
                    setCdkPage(1)
                  }}
                  onSelect={setSelectedCdkHashes}
                  onBulkRevoke={handleBulkRevoke}
                  onPatch={patchCdk}
                  onOpenDetail={loadCdkDetail}
                  onDelete={deleteCdk}
                />
                {selectedCdkDetail && (
                  <CdkDetailDialog
                    detail={selectedCdkDetail}
                    busyAction={busyAction}
                    onClose={() => setSelectedCdkDetail(null)}
                    onPatch={patchCdk}
                    onUpdateNote={handleUpdateCdkNote}
                    onSetPermission={handleSetCdkPermission}
                  />
                )}
              </section>
            )}
  
            {activeSection === 'risk' && (
              <section className="space-y-5">
                <RiskSettingsPanel
                  settings={riskSettings}
                  saving={busyAction === 'risk-settings'}
                  onChange={handleSaveRiskSettings}
                />
                <BehaviorRiskPanel />
                <RiskConsoleSummary summary={cdkOpsSummary} />
                <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <RiskTrendPanel days={cdkOpsSummary.risk_trend} />
                  <RiskReasonPanel reasons={cdkOpsSummary.risk_reasons} onOpenDetail={loadCdkDetail} />
                </div>
                <RiskTable records={riskRecords} pagination={riskPagination} loading={riskLoading} busyAction={busyAction} onPageChange={setRiskPage} onPageSizeChange={(size) => { setRiskPageSize(size); setRiskPage(1) }} onPatch={patchCdk} onOpenDetail={loadCdkDetail} />
              </section>
            )}
  
            {activeSection === 'announcement' && (
              <AnnouncementSettingsSection
                banner={banner}
                announcements={announcements}
                stats={announcementStats}
                saving={busyAction === 'announcement'}
                discarding={busyAction === 'announcement-discard'}
                draftStatus={announcementDraftStatus}
                draftSavedAt={announcementDraftSavedAt}
                draftRestored={announcementDraftRestored}
                draftConflict={announcementDraftConflict}
                draftError={announcementDraftError}
                draftDirty={announcementDraftDirty}
                onSubmit={handleSaveAnnouncement}
                onDiscardDraft={handleDiscardAnnouncementDraft}
                onUpdateBanner={updateBanner}
                onAdd={addAnnouncement}
                onUpdate={updateAnnouncement}
                onDelete={deleteAnnouncement}
                onReorder={reorderAnnouncements}
              />
            )}

            {activeSection === 'features' && <FeatureSettingsSection />}
            {activeSection === 'content' && <PublicContentSettingsSection />}
            {activeSection === 'items' && <InventoryAdminSection />}
            {activeSection === 'registration' && <RegistrationSettingsSection />}
            {activeSection === 'invitation' && <InvitationSettingsSection />}
  
            {activeSection === 'users' && (
              <section className="space-y-5">
              <form onSubmit={handleResetUserPassword} noValidate className="tool-panel p-5">
                  <h2 className="text-lg font-semibold text-ink-primary">重置用户密码</h2>
                  <p className="mt-2 text-sm leading-6 text-ink-secondary">输入用户邮箱和新临时密码。保存后该用户现有登录会话会失效。</p>
                  <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_240px_auto] lg:items-end">
                  <label>
                    <span className="mb-2 block text-sm font-medium text-ink-secondary">用户邮箱</span>
                    <input
                      id="admin-reset-email"
                      value={resetUserEmail}
                      onChange={(event) => {
                        setResetUserEmail(event.currentTarget.value)
                        setResetFieldErrors((current) => omitFieldError(current, 'resetUserEmail'))
                      }}
                      onFocus={() => setResetFieldErrors((current) => omitFieldError(current, 'resetUserEmail'))}
                      className={inputClassName(Boolean(resetFieldErrors.resetUserEmail))}
                      placeholder="user@example.com"
                      aria-invalid={Boolean(resetFieldErrors.resetUserEmail)}
                      aria-describedby={resetFieldErrors.resetUserEmail ? 'admin-reset-email-error' : undefined}
                    />
                    {resetFieldErrors.resetUserEmail && <p id="admin-reset-email-error" className="mt-1.5 text-sm text-error" role="alert">{resetFieldErrors.resetUserEmail}</p>}
                  </label>
                  <label>
                    <span className="mb-2 block text-sm font-medium text-ink-secondary">新密码</span>
                    <input
                      id="admin-reset-password"
                      type="password"
                      value={resetPassword}
                      onChange={(event) => {
                        setResetPassword(event.currentTarget.value)
                        setResetFieldErrors((current) => omitFieldError(current, 'resetPassword'))
                      }}
                      onFocus={() => setResetFieldErrors((current) => omitFieldError(current, 'resetPassword'))}
                      className={inputClassName(Boolean(resetFieldErrors.resetPassword))}
                      aria-invalid={Boolean(resetFieldErrors.resetPassword)}
                      aria-describedby={resetFieldErrors.resetPassword ? 'admin-reset-password-error' : undefined}
                    />
                    {resetFieldErrors.resetPassword && <p id="admin-reset-password-error" className="mt-1.5 text-sm text-error" role="alert">{resetFieldErrors.resetPassword}</p>}
                  </label>
                  <button type="submit" disabled={busyAction === 'reset-password'} className="tool-primary-action">
                      {busyAction === 'reset-password' ? '重置中…' : '重置密码'}
                    </button>
                  </div>
                </form>
  
                <section className="tool-panel overflow-hidden">
                  <div className="border-b border-surface-3 p-4">
                    <h2 className="text-lg font-semibold text-ink-primary">注册用户</h2>
                    <label className="mt-3 block">
                      <span className="mb-1.5 block text-xs font-medium text-ink-muted">搜索</span>
                      <div className="flex gap-2">
                        <input type="search" value={userSearchInput} onChange={(event) => setUserSearchInput(event.currentTarget.value)} placeholder="搜索邮箱、用户 ID、档案或订单标识" className="tool-field" />
                        {userSearchInput && <button type="button" onClick={() => setUserSearchInput('')} className="tool-secondary-action px-3 text-sm">清空</button>}
                      </div>
                    </label>
                  </div>
                  <div className="overflow-x-auto" aria-busy={usersLoading}>
                    {usersLoading && <div className="border-b border-surface-3 px-4 py-2 text-sm text-ink-muted" role="status">正在加载…</div>}
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
                        <tr>
                          <th className="px-4 py-3">邮箱</th>
                          <th className="px-4 py-3">状态</th>
                          <th className="px-4 py-3">权限</th>
                          <th className="px-4 py-3">档案</th>
                          <th className="px-4 py-3">时间</th>
                          <th className="px-4 py-3">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-3">
                        {appUsers.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-muted">{userSearchInput ? '没有匹配的用户，请调整搜索条件。' : '暂无注册用户。'}</td></tr>
                        ) : appUsers.map((item) => (
                          <tr key={item.id} className="hover:bg-surface-2/50">
                            <td className="px-4 py-4 font-medium text-ink-primary">{item.email}</td>
                            <td className="px-4 py-4"><UserStatusPill status={item.status} emailVerifiedAt={item.email_verified_at} /></td>
                            <td className="px-4 py-4 text-ink-secondary">{formatAdminProfileAccess(item.profile_access)}</td>
                            <td className="px-4 py-4 text-ink-secondary">{item.profile_count}</td>
                            <td className="px-4 py-4 text-xs text-ink-muted">{formatDate(item.updated_at)}</td>
                            <td className="px-4 py-4">
                              <div className="flex flex-wrap gap-2">
                                <SmallButton onClick={() => void loadUserDetail(item)} loading={busyAction === `user-detail:${item.id}`}>详情</SmallButton>
                                {item.status === 'active' && <SmallButton onClick={() => void handleFreezeAppUser(item)} loading={busyAction === `app-user:freeze_account:${item.id}`}>冻结</SmallButton>}
                                {item.status === 'frozen' && <SmallButton onClick={() => void handleUnfreezeAppUser(item)} loading={busyAction === `app-user:unfreeze_account:${item.id}`} tone="success">解冻</SmallButton>}
                                <SmallButton onClick={() => void handleDeleteAppUser(item)} loading={busyAction === `app-user:delete_account:${item.id}`} tone="danger">删除</SmallButton>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PaginationControls pagination={userPagination} loading={usersLoading} onPageChange={setUserPage} onPageSizeChange={(size) => { setUserPageSize(size); setUserPage(1) }} />
                </section>
                {selectedUserDetail && (
                  <UserDetailDialog
                    detail={selectedUserDetail}
                    balance={selectedUserBalance}
                    balanceLoading={userBalanceLoading}
                    busyAction={busyAction}
                    operatorDataByProfileId={operatorDataByProfileId}
                    expandedOperatorProfileId={expandedOperatorProfileId}
                    onClose={() => {
                      setSelectedUserDetail(null)
                      setSelectedUserBalance(null)
                      setOperatorDataByProfileId({})
                      setExpandedOperatorProfileId(null)
                    }}
                    onUpdateProfile={handleUpdateProfile}
                    onSetProfileStatus={handleSetProfileStatus}
                    onSetProfilePermission={handleSetProfilePermission}
                    onUpgradePreviewProfile={handleUpgradePreviewProfile}
                    onClearSklandBinding={handleClearProfileSklandBinding}
                    onClearWorkspace={handleClearProfileWorkspace}
                    onViewOperators={handleViewProfileOperators}
                    onDownloadOperators={handleDownloadProfileOperators}
                    onDownloadWorkspaces={handleDownloadUserWorkspaces}
                    onLoadProfilePage={(page) => loadUserDetail(selectedUserDetail.user, page)}
                    onAdjustBalance={handleAdjustUserBalance}
                    onLoadMoreBalance={handleLoadMoreUserBalance}
                    onFreezeUser={handleFreezeAppUser}
                    onUnfreezeUser={handleUnfreezeAppUser}
                    onDeleteUser={handleDeleteAppUser}
                  />
                )}
              </section>
            )}
            </AnimatedPresenceRegion>
          </div>
        </main>
      </div>
    )
}
