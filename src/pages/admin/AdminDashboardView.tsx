import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { adminPath, fallbackAdminPath, resolveAdminSection } from '../../lib/app-routes'
import { PageTransition } from '../../components/MotionPrimitives'
import SessionLoader, { SectionLoader } from '../../components/SessionLoader'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import { DialogSurfaceProvider } from '../../components/ui/dialog'
import InvitationSettingsSection from './invitations/InvitationSettingsSection'
import RegistrationSettingsSection from './registration/RegistrationSettingsSection'
import QueueMonitorPanel from './optimization/QueueMonitorPanel'
import FeatureSettingsSection from './features/FeatureSettingsSection'
import PublicContentSettingsSection from './content/PublicContentSettingsSection'
import AnnouncementSettingsSection from './announcements/AnnouncementSettingsSection'
import InventoryAdminSection from './inventory/InventoryAdminSection'
import OverviewSection from './overview/OverviewSection'
import CdkSection from './cdk/CdkSection'
import UsersSection from './users/UsersSection'
import RiskSection from './risk/RiskSection'
import AdminShell, { canAccessAdminSection } from './AdminShell'
import { useAdminController } from './useAdminController'
import { AdminToast } from './shared/AdminToast'
import { formatDate, omitFieldError, inputClassName } from './shared/helpers'
import { sectionLabels, type AdminSection } from './contracts'
import './admin.css'

export default function AdminDashboardView() {
  const location = useLocation()
  const activeSection = resolveAdminSection(location.pathname)
  const c = useAdminController(activeSection ?? 'overview')
  const visibleSections = (Object.keys(sectionLabels) as AdminSection[]).filter((section) => canAccessAdminSection(section, c.adminCapabilities))
  const [visitedSections, setVisitedSections] = useState<AdminSection[]>([])
  useEffect(() => {
    if (!c.authenticated) setVisitedSections([])
    else if (activeSection && canAccessAdminSection(activeSection, c.adminCapabilities)) setVisitedSections((current) => current.includes(activeSection) ? current : [...current, activeSection])
  }, [activeSection, c.authenticated, c.adminCapabilities])

  if (!activeSection) return <Navigate to={fallbackAdminPath()} replace />
  if (c.sessionChecking) return <div className="admin-app"><SessionLoader label="正在检查管理员会话…" /></div>
  if (c.authenticated && !canAccessAdminSection(activeSection, c.adminCapabilities)) return <Navigate to={adminPath(visibleSections[0] ?? 'overview')} replace />
  if (!c.authenticated) return <DialogSurfaceProvider value="admin-dialog"><main className="admin-app admin-login" tabIndex={-1} data-route-focus>
    <div className="admin-login-frame"><div className="admin-login-heading"><p className="text-sm text-ink-muted">MAA 基建管理后台</p><h1>管理工作台</h1></div>
      <form onSubmit={c.handleLogin} noValidate className="tool-panel p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">账号登录</h2><ThemeSwitcher iconOnly /></div>
        <label className="mt-5 block"><span className="mb-2 block text-sm">账号</span><input id="admin-login-user" value={c.loginUser}
          onChange={(e) => { c.setLoginUser(e.currentTarget.value); c.setLoginFieldErrors((current) => omitFieldError(current, 'loginUser')) }} className={inputClassName(Boolean(c.loginFieldErrors.loginUser))}
          autoComplete="username" aria-invalid={Boolean(c.loginFieldErrors.loginUser)} aria-describedby={c.loginFieldErrors.loginUser ? 'admin-login-user-error' : undefined} />
          {c.loginFieldErrors.loginUser && <p id="admin-login-user-error" className="mt-2 text-sm text-error" role="alert">{c.loginFieldErrors.loginUser}</p>}</label>
        <label className="mt-4 block"><span className="mb-2 block text-sm">密码</span><input id="admin-login-password" type="password" value={c.loginPassword}
          onChange={(e) => { c.setLoginPassword(e.currentTarget.value); c.setLoginFieldErrors((current) => omitFieldError(current, 'loginPassword')) }} className={inputClassName(Boolean(c.loginFieldErrors.loginPassword))}
          autoComplete="current-password" aria-invalid={Boolean(c.loginFieldErrors.loginPassword)} aria-describedby={c.loginFieldErrors.loginPassword ? 'admin-login-password-error' : undefined} />
          {c.loginFieldErrors.loginPassword && <p id="admin-login-password-error" className="mt-2 text-sm text-error" role="alert">{c.loginFieldErrors.loginPassword}</p>}</label>
        {c.error && <div className="tool-alert tool-alert--error mt-4" role="alert">{c.error}</div>}
        <button type="submit" disabled={c.loading} className="tool-primary-action mt-5 w-full">{c.loading ? '正在登录…' : '进入后台'}</button>
      </form></div>
  </main></DialogSurfaceProvider>

  const sectionLoading = (section: AdminSection) => (c.loading && section === 'overview' && !c.usageStats)
    || (section === 'cdk' && c.cdkLoading && !c.cdkLoaded) || (section === 'users' && c.usersLoading && !c.usersLoaded)
  const syncStatus = c.loading ? '正在同步数据' : c.lastSuccessfulSyncAt ? `最近成功同步 ${formatDate(c.lastSuccessfulSyncAt)}${c.overviewPartialFailure ? '（部分数据失败）' : ''}` : '选择栏目查看数据'
  return <AdminShell section={activeSection} username={c.adminUsername} capabilities={c.adminCapabilities} syncStatus={syncStatus}
    onRefresh={['overview', 'users', 'cdk', 'announcement'].includes(activeSection) ? () => {
      if (activeSection === 'users' && c.selectedUserDetail) void c.loadUserDetail(c.selectedUserDetail.user, c.selectedUserDetail.profile_pagination?.page ?? 1)
      else void c.loadDashboard()
    } : undefined}
    refreshing={Boolean(c.busyAction) || c.loading || (activeSection === 'users' && c.usersLoading) || (activeSection === 'cdk' && c.cdkLoading) || (activeSection === 'risk' && c.riskLoading)} onLogout={c.handleLogout}>
    {c.error && <div className="tool-alert tool-alert--error mb-5" role="alert">{c.error}</div>}
    {c.notice && <AdminToast message={c.notice} onDismiss={c.clearNotice} />}
    <PageTransition motionKey={activeSection} className="tool-page-transition">{(displayedSection) => <>
      {visibleSections.filter((section) => section === displayedSection || visitedSections.includes(section)).map((section) => <div key={section}
        hidden={section !== displayedSection} className="admin-section tool-section-content" data-loading={sectionLoading(section) || undefined}>
        <SectionLoader label={`正在加载${sectionLabels[section]}…`} /><div className="admin-section-body tool-page-content">
          {section === 'overview' && <OverviewSection model={c} />}
          {section === 'users' && <UsersSection model={c} active={displayedSection === 'users'} />}
          {section === 'cdk' && <CdkSection model={c} active={displayedSection === 'cdk'} />}
          {section === 'risk' && <RiskSection model={c} active={displayedSection === 'risk'} />}
          {section === 'queue' && <QueueMonitorPanel active={displayedSection === 'queue'} />}
          {section === 'features' && <FeatureSettingsSection />}
          {section === 'content' && <PublicContentSettingsSection />}
          {section === 'items' && <InventoryAdminSection />}
          {section === 'registration' && <RegistrationSettingsSection />}
          {section === 'invitation' && <InvitationSettingsSection active={displayedSection === 'invitation'} />}
          {section === 'announcement' && <AnnouncementSettingsSection banner={c.banner} announcements={c.announcements} stats={c.announcementStats}
            saving={c.busyAction === 'announcement'} discarding={c.busyAction === 'announcement-discard'} draftStatus={c.announcementDraftStatus}
            draftSavedAt={c.announcementDraftSavedAt} draftRestored={c.announcementDraftRestored} draftConflict={c.announcementDraftConflict}
            draftError={c.announcementDraftError} draftDirty={c.announcementDraftDirty} onSubmit={c.handleSaveAnnouncement} onDiscardDraft={c.handleDiscardAnnouncementDraft}
            onUpdateBanner={c.updateBanner} onAdd={c.addAnnouncement} onUpdate={c.updateAnnouncement} onDelete={c.deleteAnnouncement} onReorder={c.reorderAnnouncements} />}
        </div>
      </div>)}
    </>}</PageTransition>
  </AdminShell>
}
