import type { AnnouncementKind } from '../../lib/types'

import { GeneratedPermission, AdminSection, UsageRangeKey, AnnouncementSortKey, EMPTY_ANNOUNCEMENT_REACH_STATS, permissionLabels, sectionLabels, announcementKindLabels, announcementSortLabels, cdkProductPermissions, MAX_CDK_BATCH_COUNT, UserDetailDialog, CdkTable, CdkDetailPanel, RiskSettingsPanel, RiskTable, Metric, EMPTY_LATENCY_STATS, EMPTY_SKLAND_STATS, EMPTY_ANNOUNCEMENT_STATS, FunnelPanel, FailureReasonPanel, LatencyPanel, OpsSummaryPanel, SklandPanel, AnnouncementStatsPanel, AnnouncementReachMetrics, CdkDistributionPanel, CdkRecordDistributionPanel, RiskConsoleSummary, RiskTrendPanel, RiskReasonPanel, UsageTrendChart, UserStatusPill, SmallButton, formatDate, formatDuration, omitFieldError, inputClassName, formatAdminProfileAccess } from './modules'
import { useAdminController } from './useAdminController'

export default function AdminDashboardView() {
  const { permission, announcementSort, adminUsername, loginUser, setLoginUser, loginPassword, setLoginPassword, authenticated, sessionChecking, activeSection, setActiveSection, setStatusFilter, setPermission, setPermissionFilter, setBoundFilter, setRiskFilter, setGeneratedFilter, appUsers, usageRange, setUsageRange, usageRangeFrom, setUsageRangeFrom, usageRangeTo, setUsageRangeTo, usageStats, announcements, announcementStats, setAnnouncementSort, riskSettings, orderNote, setOrderNote, cdkCount, setCdkCount, generatedCodes, selectedCdkHashes, setSelectedCdkHashes, selectedCdkDetail, setSelectedCdkDetail, selectedUserDetail, setSelectedUserDetail, operatorDataByProfileId, setOperatorDataByProfileId, expandedOperatorProfileId, setExpandedOperatorProfileId, resetUserEmail, setResetUserEmail, resetPassword, setResetPassword, loginFieldErrors, setLoginFieldErrors, resetFieldErrors, setResetFieldErrors, loading, busyAction, error, notice, summary, cdkOpsSummary, cdkFilters, visibleRecords, sortedAnnouncements, riskRecords, loadDashboard, handleLogin, handleLogout, handleExportUsageReport, handleGenerateCdk, handleCopyGeneratedCdks, handleDownloadGeneratedCdks, handleSaveAnnouncement, handleSaveRiskSettings, addAnnouncement, updateAnnouncement, deleteAnnouncement, patchCdk, deleteCdk, loadCdkDetail, handleUpdateCdkNote, handleSetCdkPermission, handleBulkRevoke, loadUserDetail, handleViewProfileOperators, handleDownloadProfileOperators, handleUpdateProfile, handleSetProfileStatus, handleSetProfilePermission, handleUpgradePreviewProfile, handleClearProfileSklandBinding, handleClearProfileWorkspace, handleResetUserPassword, handleFreezeAppUser, handleUnfreezeAppUser, handleDeleteAppUser } = useAdminController()

  if (sessionChecking) {
      return (
        <main className="grid min-h-screen place-items-center bg-surface-0 px-6 text-ink-secondary">
          <p className="text-sm">正在检查管理员会话...</p>
        </main>
      )
    }

  if (!authenticated) {
      return (
        <main className="min-h-screen bg-surface-0 px-6 py-10 text-ink-primary">
          <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_380px]">
            <section>
              <div className="max-w-2xl">
                <p className="text-sm font-semibold text-brand-500">MAA 基建管理后台</p>
                <h1 className="mt-3 text-3xl font-semibold text-ink-primary sm:text-4xl">管理工作台</h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-ink-secondary">
                  使用独立管理账号进入后台。Root 口令只用于创建和维护管理账号，日常操作不再需要反复输入。
                </p>
              </div>
            </section>
          <form onSubmit={handleLogin} noValidate className="rounded-xl border border-surface-3 bg-surface-1 p-6">
            <h2 className="text-lg font-semibold text-ink-primary">账号登录</h2>
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
              {loginFieldErrors.loginUser && <p id="admin-login-user-error" className="mt-1.5 text-sm text-error">{loginFieldErrors.loginUser}</p>}
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
              {loginFieldErrors.loginPassword && <p id="admin-login-password-error" className="mt-1.5 text-sm text-error">{loginFieldErrors.loginPassword}</p>}
            </label>
              {error && <div className="mt-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}
            <button type="submit" disabled={loading} className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                {loading ? '正在登录...' : '进入后台'}
              </button>
              <a href="/admin/setup" className="mt-4 block text-center text-sm font-medium text-brand-500 underline-offset-4 hover:underline">添加管理账号</a>
            </form>
          </div>
        </main>
      )
    }

  return (
      <div className="min-h-screen bg-surface-0 text-ink-primary">
        <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-surface-3 bg-surface-1 px-4 py-5 lg:block">
          <div className="px-2">
            <p className="text-sm font-semibold text-brand-500">MAA 管理后台</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{adminUsername}</p>
          </div>
          <nav className="mt-8 space-y-1">
            {(Object.keys(sectionLabels) as AdminSection[]).map((section) => (
              <button key={section} type="button" onClick={() => setActiveSection(section)} className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${activeSection === section ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}>
                {sectionLabels[section]}
              </button>
            ))}
          </nav>
          <button type="button" onClick={handleLogout} className="absolute bottom-5 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">退出登录</button>
        </aside>
  
        <main className="lg:pl-64">
          <header className="sticky top-0 z-20 border-b border-surface-3 bg-surface-0/95 px-5 py-4 backdrop-blur sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-xl font-semibold text-ink-primary">{sectionLabels[activeSection]}</h1>
                <p className="mt-1 text-sm text-ink-muted">最近同步 {loading ? '进行中' : formatDate(new Date().toISOString())}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void loadDashboard()} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">刷新数据</button>
                <a href="/admin/setup" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500">账号设置</a>
              </div>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
              {(Object.keys(sectionLabels) as AdminSection[]).map((section) => (
                <button key={section} type="button" onClick={() => setActiveSection(section)} className={`rounded-lg px-3 py-2 text-sm font-medium ${activeSection === section ? 'bg-brand-600 text-white' : 'bg-surface-1 text-ink-secondary'}`}>
                  {sectionLabels[section]}
                </button>
              ))}
            </div>
          </header>
  
          <div className="px-5 py-6 sm:px-8">
            {error && <div className="mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
            {notice && <div className="mb-5 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{notice}</div>}
  
            {activeSection === 'overview' && (
              <section className="space-y-6">
                <div className="flex flex-col gap-3 rounded-xl border border-surface-3 bg-surface-1 p-4 lg:flex-row lg:items-center lg:justify-between">
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
                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 ${usageRange === range ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'}`}
                      >
                        {range === '7d' ? '7 天' : range === '14d' ? '14 天' : '30 天'}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setUsageRange('custom')}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 ${usageRange === 'custom' ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'}`}
                    >
                      自定义
                    </button>
                    {usageRange === 'custom' && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5">
                        <input
                          type="date"
                          value={usageRangeFrom}
                          max={usageRangeTo}
                          onChange={(event) => setUsageRangeFrom(event.currentTarget.value)}
                          className="rounded-md border border-surface-4 bg-surface-0 px-2 py-1.5 text-sm text-ink-primary"
                          aria-label="统计开始日期"
                        />
                        <span className="text-xs text-ink-muted">至</span>
                        <input
                          type="date"
                          value={usageRangeTo}
                          min={usageRangeFrom}
                          onChange={(event) => setUsageRangeTo(event.currentTarget.value)}
                          className="rounded-md border border-surface-4 bg-surface-0 px-2 py-1.5 text-sm text-ink-primary"
                          aria-label="统计结束日期"
                        />
                      </div>
                    )}
                    <button type="button" onClick={() => void handleExportUsageReport('csv')} disabled={busyAction === 'report:csv'} className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3 disabled:bg-surface-3 disabled:text-ink-muted">
                      {busyAction === 'report:csv' ? '导出中...' : '导出 CSV'}
                    </button>
                    <button type="button" onClick={() => void handleExportUsageReport('json')} disabled={busyAction === 'report:json'} className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3 disabled:bg-surface-3 disabled:text-ink-muted">
                      {busyAction === 'report:json' ? '导出中...' : '导出 JSON'}
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="免费预览" value={summary.freePreviews} />
                  <Metric label="注册数" value={summary.registers} />
                  <Metric label="CDK 兑换" value={summary.cdkRedeems} />
                  <Metric label="排班生成" value={summary.scheduleGenerates} />
                  <Metric label="生成成功率" value={`${summary.scheduleSuccessRate}%`} tone={summary.scheduleSuccessRate < 80 && summary.scheduleAttempts > 0 ? 'warning' : 'default'} />
                  <Metric label="平均耗时" value={formatDuration(usageStats?.latency.schedule_generate.average_ms ?? 0)} />
                  <Metric label="P95 耗时" value={formatDuration(usageStats?.latency.schedule_generate.p95_ms ?? 0)} tone={(usageStats?.latency.schedule_generate.p95_ms ?? 0) > 10000 ? 'warning' : 'default'} />
                  <Metric label="冻结/软拦截" value={summary.frozenCdks + summary.riskEvents} tone={summary.frozenCdks + summary.riskEvents > 0 ? 'warning' : 'default'} />
                </div>
                <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                  <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-semibold text-ink-primary">趋势</h2>
                      <span className="text-xs text-ink-muted">访问 / 生成 / 兑换</span>
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
  
        {activeSection === 'cdk' && (
          <section className="space-y-5">
            <form onSubmit={handleGenerateCdk} className="rounded-xl border border-surface-3 bg-surface-1 p-5">
              <div className="grid gap-4 lg:grid-cols-[220px_140px_1fr_auto] lg:items-end">
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">授权类型</span>
                  <select value={permission} onChange={(event) => setPermission(event.currentTarget.value as GeneratedPermission)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary">
                    {cdkProductPermissions.map((item) => <option key={item} value={item}>{permissionLabels[item]}</option>)}
                  </select>
                </label>
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">生成数量</span>
                  <input type="number" min={1} max={MAX_CDK_BATCH_COUNT} step={1} value={cdkCount} onChange={(event) => setCdkCount(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" />
                </label>
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">订单备注</span>
                  <input value={orderNote} maxLength={120} onChange={(event) => setOrderNote(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="闲鱼订单号、用户昵称或售后备注" />
                </label>
                <button type="submit" disabled={busyAction === 'generate'} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">{busyAction === 'generate' ? '生成中...' : '生成 CDK'}</button>
              </div>
              {generatedCodes.length > 0 && (
                <div className="mt-4 border-t border-surface-3 pt-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-ink-primary">已生成 {generatedCodes.length} 个 CDK</div>
                      <div className="mt-1 text-xs text-ink-muted">{permissionLabels[generatedCodes[0].permission]} · {formatDate(generatedCodes[0].created_at)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={handleCopyGeneratedCdks} className="rounded-lg bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">{generatedCodes.length === 1 ? '复制 CDK' : '复制全部'}</button>
                      <button type="button" onClick={handleDownloadGeneratedCdks} className="rounded-lg bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">下载 CSV</button>
                    </div>
                  </div>
                  <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-surface-3 bg-surface-0">
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
                  busyAction={busyAction}
                  onFilterChange={(patch) => {
                    if (patch.status) setStatusFilter(patch.status)
                    if (patch.permission) setPermissionFilter(patch.permission)
                    if (patch.bound) setBoundFilter(patch.bound)
                    if (patch.risk) setRiskFilter(patch.risk)
                    if (patch.generated) setGeneratedFilter(patch.generated)
                  }}
                  onSelect={setSelectedCdkHashes}
                  onBulkRevoke={handleBulkRevoke}
                  onPatch={patchCdk}
                  onOpenDetail={loadCdkDetail}
                  onDelete={deleteCdk}
                />
                {selectedCdkDetail && (
                  <CdkDetailPanel
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
                <RiskTable records={riskRecords} busyAction={busyAction} onPatch={patchCdk} onOpenDetail={loadCdkDetail} />
              </section>
            )}
  
          {activeSection === 'announcement' && (
            <form onSubmit={handleSaveAnnouncement} className="space-y-5">
              <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-ink-primary">横幅和弹出式公告</h2>
                    <p className="mt-1 text-sm text-ink-secondary">横幅显示在工具页内，弹出式公告会在用户首次未读时弹出。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary">
                      <span>排序</span>
                      <select
                        value={announcementSort}
                        onChange={(event) => setAnnouncementSort(event.currentTarget.value as AnnouncementSortKey)}
                        className="bg-transparent text-sm font-semibold text-ink-primary outline-none"
                      >
                        {Object.entries(announcementSortLabels).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={() => addAnnouncement('banner')} className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">新增横幅</button>
                    <button type="button" onClick={() => addAnnouncement('popup')} className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">新增弹出式公告</button>
                  </div>
                </div>
  
                <div className="mt-5 space-y-4">
                  {announcements.length === 0 && (
                    <div className="rounded-lg border border-dashed border-surface-4 bg-surface-0 px-4 py-6 text-sm text-ink-muted">
                      还没有公告。新增横幅或弹出式公告后保存即可生效。
                    </div>
                  )}
                  {sortedAnnouncements.map((item) => {
                    const stats = announcementStats[item.id] ?? EMPTY_ANNOUNCEMENT_REACH_STATS
                    return (
                      <article key={item.id} className="rounded-lg border border-surface-3 bg-surface-0 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={item.kind}
                              onChange={(event) => updateAnnouncement(item.id, { kind: event.currentTarget.value as AnnouncementKind })}
                              className="rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary"
                            >
                              {Object.entries(announcementKindLabels).map(([kind, label]) => (
                                <option key={kind} value={kind}>{label}</option>
                              ))}
                            </select>
                            <label className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-secondary">
                              <input
                                type="checkbox"
                                checked={item.active}
                                onChange={(event) => updateAnnouncement(item.id, { active: event.currentTarget.checked })}
                                className="h-4 w-4 accent-brand-600"
                              />
                              启用
                            </label>
                          </div>
                          <button type="button" onClick={() => deleteAnnouncement(item.id)} className="rounded-lg bg-error/10 px-3 py-2 text-sm font-semibold text-error hover:bg-error/20">
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
                            className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary"
                          />
                        </label>
                        <label className="mt-4 block">
                          <span className="mb-2 block text-sm font-medium text-ink-secondary">正文</span>
                          <textarea
                            value={item.body}
                            maxLength={600}
                            rows={5}
                            onChange={(event) => updateAnnouncement(item.id, { body: event.currentTarget.value })}
                            className="w-full resize-y rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm leading-6 text-ink-primary"
                          />
                        </label>
                        <p className="mt-3 text-xs text-ink-muted">更新时间：{formatDate(item.updated_at)}</p>
                      </article>
                    )
                  })}
                </div>
  
                <button type="submit" disabled={busyAction === 'announcement'} className="mt-5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                  {busyAction === 'announcement' ? '保存中...' : '保存公告'}
                </button>
              </section>
              </form>
            )}
  
            {activeSection === 'users' && (
              <section className="space-y-5">
              <form onSubmit={handleResetUserPassword} noValidate className="rounded-xl border border-surface-3 bg-surface-1 p-5">
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
                    {resetFieldErrors.resetUserEmail && <p id="admin-reset-email-error" className="mt-1.5 text-sm text-error">{resetFieldErrors.resetUserEmail}</p>}
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
                    {resetFieldErrors.resetPassword && <p id="admin-reset-password-error" className="mt-1.5 text-sm text-error">{resetFieldErrors.resetPassword}</p>}
                  </label>
                  <button type="submit" disabled={busyAction === 'reset-password'} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                      {busyAction === 'reset-password' ? '重置中...' : '重置密码'}
                    </button>
                  </div>
                </form>
  
                <section className="rounded-xl border border-surface-3 bg-surface-1">
                  <div className="border-b border-surface-3 p-4">
                    <h2 className="text-lg font-semibold text-ink-primary">注册用户</h2>
                  </div>
                  <div className="overflow-x-auto">
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
                          <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-muted">暂无注册用户。</td></tr>
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
          </div>
        </main>
      </div>
    )
}
