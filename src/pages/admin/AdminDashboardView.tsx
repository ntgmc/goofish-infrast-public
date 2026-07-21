import type { AnnouncementKind } from '../../lib/types'
import { LayoutGroup } from 'motion/react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { adminPath, fallbackAdminPath, resolveAdminSection } from '../../lib/app-routes'
import AnnouncementBodyEditor from '../../components/AnnouncementBodyEditor'
import { AnimatedPresenceRegion, MotionNavIndicator } from '../../components/MotionPrimitives'
import SessionLoader from '../../components/SessionLoader'
import InvitationSettingsSection from './invitations/InvitationSettingsSection'
import RegistrationSettingsSection from './registration/RegistrationSettingsSection'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import QueueMonitorPanel from './optimization/QueueMonitorPanel'

import { GeneratedPermission, AdminSection, UsageRangeKey, AnnouncementSortKey, EMPTY_ANNOUNCEMENT_REACH_STATS, permissionLabels, sectionLabels, announcementKindLabels, announcementSortLabels, cdkProductPermissions, MAX_CDK_BATCH_COUNT, UserDetailDialog, CdkTable, CdkDetailDialog, RiskSettingsPanel, RiskTable, Metric, EMPTY_LATENCY_STATS, EMPTY_SKLAND_STATS, EMPTY_ANNOUNCEMENT_STATS, FunnelPanel, FailureReasonPanel, LatencyPanel, OpsSummaryPanel, SklandPanel, AnnouncementStatsPanel, AnnouncementReachMetrics, CdkDistributionPanel, CdkRecordDistributionPanel, RiskConsoleSummary, RiskTrendPanel, RiskReasonPanel, UsageTrendChart, UserStatusPill, SmallButton, formatDate, formatDuration, omitFieldError, inputClassName, formatAdminProfileAccess } from './modules'
import { useAdminController } from './useAdminController'
import { PaginationControls } from './shared/PaginationControls'

export default function AdminDashboardView() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection = resolveAdminSection(location.pathname)
  const setActiveSection = (section: AdminSection) => navigate(adminPath(section))
  const { cdkSearchInput, setCdkSearchInput, setCdkPage, setCdkPageSize, cdkPagination, cdkLoading, userSearchInput, setUserSearchInput, setUserPage, setUserPageSize, userPagination, usersLoading, setRiskPage, setRiskPageSize, riskPagination, riskLoading, permission, announcementSort, adminUsername, loginUser, setLoginUser, loginPassword, setLoginPassword, authenticated, sessionChecking, setStatusFilter, setPermission, setPermissionFilter, setRiskFilter, setGeneratedFilter, appUsers, usageRange, setUsageRange, usageRangeFrom, setUsageRangeFrom, usageRangeTo, setUsageRangeTo, usageStats, announcements, announcementStats, setAnnouncementSort, riskSettings, orderNote, setOrderNote, cdkCount, setCdkCount, generatedCodes, selectedCdkHashes, setSelectedCdkHashes, selectedCdkDetail, setSelectedCdkDetail, selectedUserDetail, setSelectedUserDetail, operatorDataByProfileId, setOperatorDataByProfileId, expandedOperatorProfileId, setExpandedOperatorProfileId, resetUserEmail, setResetUserEmail, resetPassword, setResetPassword, loginFieldErrors, setLoginFieldErrors, resetFieldErrors, setResetFieldErrors, loading, busyAction, error, notice, summary, cdkOpsSummary, cdkFilters, visibleRecords, sortedAnnouncements, riskRecords, loadDashboard, handleLogin, handleLogout, handleExportUsageReport, handleGenerateCdk, handleCopyGeneratedCdks, handleDownloadGeneratedCdks, handleSaveAnnouncement, handleSaveRiskSettings, addAnnouncement, updateAnnouncement, deleteAnnouncement, patchCdk, deleteCdk, loadCdkDetail, handleUpdateCdkNote, handleSetCdkPermission, handleBulkRevoke, loadUserDetail, handleViewProfileOperators, handleDownloadProfileOperators, handleUpdateProfile, handleSetProfileStatus, handleSetProfilePermission, handleUpgradePreviewProfile, handleClearProfileSklandBinding, handleClearProfileWorkspace, handleResetUserPassword, handleFreezeAppUser, handleUnfreezeAppUser, handleDeleteAppUser } = useAdminController()

  if (!activeSection) return <Navigate to={fallbackAdminPath()} replace />

  if (sessionChecking) {
    return <SessionLoader label="正在检查管理员会话…" />
  }

  if (!authenticated) {
      return (
        <main className="tool-page" tabIndex={-1} data-route-focus>
          <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_380px]">
            <section>
              <div className="max-w-2xl">
                <p className="section-index">MAA 基建管理后台</p>
                <h1 className="display-title mt-3 text-3xl text-ink-primary sm:text-4xl">管理工作台</h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-ink-secondary">
                  使用独立管理账号进入后台。Root 口令只用于创建和维护管理账号，日常操作不再需要反复输入。
                </p>
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
              <Link to="/admin/setup" className="tool-secondary-action mt-4 w-full">添加管理账号</Link>
            </form>
          </div>
        </main>
      )
    }

  return (
      <div className="tool-shell">
        <aside className="tool-sidebar fixed inset-y-0 left-0 hidden w-64 px-4 py-5 lg:block">
          <div className="px-2">
            <p className="section-index">MAA 管理后台</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{adminUsername}</p>
          </div>
          <LayoutGroup id="admin-desktop">
            <nav className="mt-8 space-y-1">
              {(Object.keys(sectionLabels) as AdminSection[]).map((section) => (
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
          <header className="tool-header sticky top-0 z-20 bg-surface-0/95 px-5 py-4 backdrop-blur sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-xl font-semibold text-ink-primary">{sectionLabels[activeSection]}</h1>
                <p className="mt-1 text-sm text-ink-muted">最近同步 {loading ? '进行中' : formatDate(new Date().toISOString())}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ThemeSwitcher />
                <button type="button" onClick={() => void loadDashboard()} className="tool-secondary-action">刷新数据</button>
                <Link to="/admin/setup" className="tool-primary-action">账号设置</Link>
              </div>
            </div>
            <LayoutGroup id="admin-mobile">
              <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
                {(Object.keys(sectionLabels) as AdminSection[]).map((section) => (
                  <button key={section} type="button" onClick={() => setActiveSection(section)} aria-current={activeSection === section ? 'page' : undefined} className="tool-nav-link shrink-0 px-3">
                    {activeSection === section && <MotionNavIndicator layoutId="admin-active" />}
                    <span className="relative z-10">{sectionLabels[section]}</span>
                  </button>
                ))}
              </div>
            </LayoutGroup>
          </header>
  
          <div className="px-5 py-6 sm:px-8">
            {error && <div className="tool-alert tool-alert--error mb-5" role="alert">{error}</div>}
            {notice && <div className="tool-alert tool-alert--success mb-5" role="status" aria-live="polite">{notice}</div>}

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
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="免费预览新增" value={summary.freePreviews} />
                  <Metric label="注册数" value={summary.registers} />
                  <Metric label="CDK 兑换" value={summary.cdkRedeems} />
                  <Metric label="排班生成" value={summary.scheduleGenerates} />
                  <Metric label="生成成功率" value={`${summary.scheduleSuccessRate}%`} tone={summary.scheduleSuccessRate < 80 && summary.scheduleAttempts > 0 ? 'warning' : 'default'} />
                  <Metric label="平均耗时" value={formatDuration(usageStats?.latency.schedule_generate.average_ms ?? 0)} />
                  <Metric label="P95 耗时" value={formatDuration(usageStats?.latency.schedule_generate.p95_ms ?? 0)} tone={(usageStats?.latency.schedule_generate.p95_ms ?? 0) > 10000 ? 'warning' : 'default'} />
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
              <div className="grid gap-4 lg:grid-cols-[220px_140px_1fr_auto] lg:items-end">
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">授权类型</span>
                  <select value={permission} onChange={(event) => setPermission(event.currentTarget.value as GeneratedPermission)} className="tool-field">
                    {cdkProductPermissions.map((item) => <option key={item} value={item}>{permissionLabels[item]}</option>)}
                  </select>
                </label>
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
                      <div className="mt-1 text-xs text-ink-muted">{permissionLabels[generatedCodes[0].permission]} · {formatDate(generatedCodes[0].created_at)}</div>
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
                <RiskConsoleSummary summary={cdkOpsSummary} />
                <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <RiskTrendPanel days={cdkOpsSummary.risk_trend} />
                  <RiskReasonPanel reasons={cdkOpsSummary.risk_reasons} onOpenDetail={loadCdkDetail} />
                </div>
                <RiskTable records={riskRecords} pagination={riskPagination} loading={riskLoading} busyAction={busyAction} onPageChange={setRiskPage} onPageSizeChange={(size) => { setRiskPageSize(size); setRiskPage(1) }} onPatch={patchCdk} onOpenDetail={loadCdkDetail} />
              </section>
            )}
  
            {activeSection === 'announcement' && (
            <form onSubmit={handleSaveAnnouncement} className="space-y-5">
              <section className="tool-panel p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-ink-primary">横幅和弹出式公告</h2>
                    <p className="mt-1 text-sm text-ink-secondary">横幅显示在工具页内，弹出式公告会在用户首次未读时弹出。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="tool-inset flex items-center gap-2 px-3 py-2 text-sm font-semibold text-ink-secondary">
                      <span>排序</span>
                      <select
                        value={announcementSort}
                        onChange={(event) => setAnnouncementSort(event.currentTarget.value as AnnouncementSortKey)}
                        className="min-h-8 bg-transparent text-sm font-semibold text-ink-primary outline-none"
                      >
                        {Object.entries(announcementSortLabels).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={() => addAnnouncement('banner')} className="tool-secondary-action px-3 text-sm">新增横幅</button>
                    <button type="button" onClick={() => addAnnouncement('popup')} className="tool-secondary-action px-3 text-sm">新增弹出式公告</button>
                  </div>
                </div>
  
                <div className="mt-5 space-y-4">
                  {announcements.length === 0 && (
                    <div className="tool-inset border-dashed px-4 py-6 text-sm text-ink-muted">
                      还没有公告。新增横幅或弹出式公告后保存即可生效。
                    </div>
                  )}
                  {sortedAnnouncements.map((item) => {
                    const stats = announcementStats[item.id] ?? EMPTY_ANNOUNCEMENT_REACH_STATS
                    return (
                      <article key={item.id} className="tool-inset p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={item.kind}
                              onChange={(event) => updateAnnouncement(item.id, { kind: event.currentTarget.value as AnnouncementKind })}
                              className="tool-field w-auto"
                            >
                              {Object.entries(announcementKindLabels).map(([kind, label]) => (
                                <option key={kind} value={kind}>{label}</option>
                              ))}
                            </select>
                            <label className="tool-inset flex min-h-11 items-center gap-2 px-3 text-sm font-medium text-ink-secondary">
                              <input
                                type="checkbox"
                                checked={item.active}
                                onChange={(event) => updateAnnouncement(item.id, { active: event.currentTarget.checked })}
                                className="h-4 w-4 accent-brand-600"
                              />
                              启用
                            </label>
                          </div>
                          <button type="button" onClick={() => deleteAnnouncement(item.id)} className="tool-secondary-action border-error/40 bg-error/10 px-3 text-sm text-error hover:border-error/60 hover:bg-error/20 hover:text-error">
                            删除
                          </button>
                        </div>
  
                        <AnnouncementReachMetrics stats={stats} />
  
                        <label className="mt-4 block">
                          <span className="mb-2 block text-sm font-medium text-ink-secondary">标题</span>
                          <input
                            value={item.title}
                            maxLength={80}
                            onChange={(event) => updateAnnouncement(item.id, { title: event.currentTarget.value })}
                            className="tool-field"
                          />
                        </label>
                        <AnnouncementBodyEditor
                          id={`announcement-${item.id}`}
                          value={item.body}
                          onChange={(body) => updateAnnouncement(item.id, { body })}
                        />
                        <p className="mt-3 text-xs text-ink-muted">更新时间：{formatDate(item.updated_at)}</p>
                      </article>
                    )
                  })}
                </div>
  
                <button type="submit" disabled={busyAction === 'announcement'} className="tool-primary-action mt-5">
                  {busyAction === 'announcement' ? '保存中…' : '保存公告'}
                </button>
              </section>
              </form>
            )}

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
                            <td className="px-4 py-4"><UserStatusPill status={item.status} /></td>
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
                    busyAction={busyAction}
                    operatorDataByProfileId={operatorDataByProfileId}
                    expandedOperatorProfileId={expandedOperatorProfileId}
                    onClose={() => {
                      setSelectedUserDetail(null)
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
