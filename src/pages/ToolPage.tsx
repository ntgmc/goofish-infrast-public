import { lazy, Suspense } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import AnnouncementPopup from '../components/AnnouncementPopup'
import { canUseScenarioComparison } from '../lib/license'
import {
  dashboardPath,
  fallbackToolPath,
  optimizePath,
  resolveToolRoute,
  workspaceSetupPath,
  type DashboardSection,
  type OptimizeSection,
  type WorkspaceSetupSection,
} from '../lib/app-routes'
import AccountDashboard from './tool/AccountDashboard'
import AuthPage from './tool/AuthPage'
import WorkspaceSetupPage from './tool/WorkspaceSetupPage'
import { isSchedulableProfile } from './tool/tool-utils'
import { useToolSession } from './tool/useToolSession'
import { useToolVisitReporter } from './tool/useToolVisitReporter'
import { copy } from '../copy/index'


const OptimizePage = lazy(() => import('./OptimizePage'))

export default function ToolPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const route = resolveToolRoute(location.pathname)
  useToolVisitReporter(Boolean(route))
  const {
    authLoading,
    user,
    activeProfile,
    activeCdkProfile,
    cdkProfiles,
    workspace,
    license,
    setLicense,
    eliteOverrides,
    setEliteOverrides,
    configOverride,
    setConfigOverride,
    configSyncStatus,
    flushConfigSave,
    retryConfigSave,
    banner,
    popups,
    announcementUnreadCount,
    openingProfileId,
    workspaceLoadError,
    applyAuthPayload,
    refreshProfileWorkspace,
    persistWorkspacePatch,
    handleLogout,
  } = useToolSession()

  if (!route) return <Navigate to={fallbackToolPath(location.pathname)} replace />

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">{copy.common.pages_ToolPage_001}</div>
  }

  if (!user) {
    return (
      <>
        <AnnouncementPopup announcements={popups} />
        <AuthPage announcement={banner} onAuthenticated={applyAuthPayload} />
      </>
    )
  }

  const navigateToToolPath = (path: string, options?: { replace?: boolean }) => {
    navigate(path, { replace: options?.replace, flushSync: true })
  }
  const navigateDashboard = (section: DashboardSection, options?: { replace?: boolean }) => {
    navigateToToolPath(dashboardPath(section), options)
  }
  const navigateSetup = (section: WorkspaceSetupSection) => navigateToToolPath(workspaceSetupPath(section))
  const navigateOptimize = (section: OptimizeSection) => navigateToToolPath(optimizePath(section))

  if (route.kind === 'dashboard') {
    return (
      <>
        <AnnouncementPopup announcements={popups} />
        <AccountDashboard
          user={user}
          profiles={cdkProfiles}
          activeProfile={activeCdkProfile}
          announcementUnreadCount={announcementUnreadCount}
          openingProfileId={openingProfileId}
          workspaceLoadError={workspaceLoadError}
          section={route.section}
          onSectionChange={navigateDashboard}
          onLogout={handleLogout}
          onPayload={applyAuthPayload}
          onOpenProfile={(profile) => {
            void refreshProfileWorkspace(profile)
              .then(() => navigate(workspaceSetupPath('operators')))
              .catch(console.error)
          }}
        />
      </>
    )
  }

  if (!activeProfile || !isSchedulableProfile(activeProfile)) {
    return <Navigate to={dashboardPath('profiles')} replace />
  }

  if (route.kind === 'setup') {
    return (
      <>
        <AnnouncementPopup announcements={popups} />
        <WorkspaceSetupPage
          user={user}
          profile={activeProfile}
          workspace={workspace}
          announcement={banner}
          activeSection={route.section}
          onSectionChange={navigateSetup}
          onSaved={(payload) => {
            applyAuthPayload(payload)
            navigate(optimizePath('overview'))
          }}
          onSynced={applyAuthPayload}
          onBack={() => navigate(dashboardPath('profiles'))}
          onRedeemNewProfile={() => navigate(dashboardPath('redeem'))}
          onLogout={handleLogout}
        />
      </>
    )
  }

  if (!license) {
    return <Navigate to={workspace?.operators ? workspaceSetupPath('config') : workspaceSetupPath('operators')} replace />
  }

  if (route.section === 'lab' && !canUseScenarioComparison(license)) {
    return <Navigate to={optimizePath('overview')} replace />
  }

  return (
    <>
      <AnnouncementPopup announcements={popups} />
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">{copy.common.pages_ToolPage_002}</div>}>
        <OptimizePage
          profileId={activeProfile.id}
          profile={activeProfile}
          license={license}
          workspace={workspace}
          setLicense={setLicense}
          eliteOverrides={eliteOverrides}
          setEliteOverrides={setEliteOverrides}
          configOverride={configOverride}
          setConfigOverride={setConfigOverride}
          configSyncStatus={configSyncStatus}
          flushConfigSave={flushConfigSave}
          retryConfigSave={retryConfigSave}
          onWorkspacePatch={persistWorkspacePatch}
          section={route.section}
          onSectionChange={navigateOptimize}
          onReset={() => navigate(workspaceSetupPath('operators'))}
          announcement={banner}
          redeemedNotice={null}
          onRedownloadLicense={null}
          onProfileUpgraded={applyAuthPayload}
        />
      </Suspense>
    </>
  )
}
