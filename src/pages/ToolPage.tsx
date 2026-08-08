import { lazy, Suspense } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import AnnouncementPopup from '../components/AnnouncementPopup'
import SessionLoader from '../components/SessionLoader'
import {
  dashboardPath,
  fallbackToolPath,
  optimizePath,
  profileScopedPath,
  resolveToolRoute,
  workspaceSetupPath,
  type DashboardSection,
  type OptimizeSection,
  type WorkspaceSetupSection,
} from '../lib/app-routes'
import AccountDashboard from './tool/AccountDashboard'
import AuthPage from './tool/AuthPage'
import ProfileUpgradePrompt from './tool/ProfileUpgradePrompt'
import WorkspaceSetupPage from './tool/WorkspaceSetupPage'
import { isSchedulableProfile } from './tool/tool-utils'
import { useToolSession } from './tool/useToolSession'
import { useToolVisitReporter } from './tool/useToolVisitReporter'
import { copy } from '../copy/index'
import { useSiteFeatures } from '../lib/site-feature-context'
import type { SiteFeatures } from '../lib/site-features'
import FeatureUnavailablePage from '../components/FeatureUnavailablePage'
import { NotificationCenterProvider } from '../components/NotificationCenter'
import { PublicContentProvider } from '../lib/public-content-context'


const OptimizePage = lazy(() => import('./OptimizePage'))

export default function ToolPage() {
  const featureState = useSiteFeatures()
  if (featureState.status === 'loading') return <SessionLoader label={copy.features.loading} />
  if (featureState.status === 'error') return <FeatureUnavailablePage loadError onRetry={featureState.retry} />
  if (!featureState.features.site) return <FeatureUnavailablePage feature="site" />
  if (!featureState.features.login) {
    return <AuthPage announcement={null} onAuthenticated={() => undefined} />
  }
  return <ToolPageSession features={featureState.features} />
}

function ToolPageSession({ features }: { features: SiteFeatures }) {
  const location = useLocation()
  const navigate = useNavigate()
  const route = resolveToolRoute(location.pathname)
  const requestedProfileId = new URLSearchParams(location.search).get('profile_id')
  useToolVisitReporter(Boolean(route))
  const {
    authStatus,
    retryAuth,
    authLoading,
    user,
    activeProfile,
    activeCdkProfile,
    cdkProfiles,
    workspace,
    license,
    setLicense,
    eliteOverrides,
    configOverride,
    setConfigOverride,
    configSyncStatus,
    flushConfigSave,
    retryConfigSave,
    banner,
    popups,
    announcementUnreadCount,
    setAnnouncementUnreadCount,
    openingProfileId,
    workspaceLoadError,
    applyAuthPayload,
    refreshProfileWorkspace,
    applyWorkspaceSnapshot,
    persistWorkspacePatch,
    handleLogout,
  } = useToolSession(requestedProfileId)

  if (!route) return <Navigate to={profileScopedPath(fallbackToolPath(location.pathname), requestedProfileId)} replace />

  if (authLoading) {
    return <SessionLoader label={copy.common.pages_ToolPage_001} />
  }

  if (authStatus === 'error') {
    return (
      <main className="tool-shell flex min-h-dvh items-center justify-center px-4 py-8" tabIndex={-1} data-route-focus>
        <section className="tool-panel w-full max-w-lg p-6 sm:p-8" aria-labelledby="auth-service-error-title">
          <p className="section-index">{copy.auth.pages_VerifyEmailPage_004}</p>
          <h1 id="auth-service-error-title" className="display-title mt-2 text-2xl text-ink-primary">
            {copy.common.pages_ToolPage_003}
          </h1>
          <div className="tool-alert tool-alert--error mt-5" role="alert">
            {copy.common.pages_ToolPage_004}
          </div>
          <button type="button" onClick={retryAuth} className="tool-primary-action mt-6 min-h-11 w-full">
            {copy.common.pages_ToolPage_005}
          </button>
        </section>
      </main>
    )
  }

  if (!user) {
    return (
      <>
        {features.announcements && <AnnouncementPopup announcements={popups} />}
        <AuthPage announcement={banner} onAuthenticated={applyAuthPayload} />
      </>
    )
  }

  const navigateToToolPath = (path: string, options?: { replace?: boolean }) => {
    void navigate(path, { replace: options?.replace })
  }
  const navigateDashboard = (section: DashboardSection, options?: { replace?: boolean }) => {
    navigateToToolPath(dashboardPath(section), options)
  }
  const navigateSetup = (section: WorkspaceSetupSection) => navigateToToolPath(profileScopedPath(workspaceSetupPath(section), activeProfile?.id))
  const navigateOptimize = (section: OptimizeSection) => navigateToToolPath(profileScopedPath(optimizePath(section), activeProfile?.id))
  const profileUpgradePrompt = (
    <ProfileUpgradePrompt
      userId={user.id}
      profile={activeCdkProfile}
      inventoryEnabled={features.inventory}
      currentPath={location.pathname}
      onOpenInventory={() => navigateDashboard('inventory')}
    />
  )

  if (route.kind === 'dashboard') {
    const requiredFeature = dashboardFeature(route.section, features)
    if (requiredFeature) return <FeatureUnavailablePage feature={requiredFeature} />
    return (
      <>
        <NotificationCenterProvider userId={user.id}>
          {features.announcements && <AnnouncementPopup announcements={popups} userId={user.id} onUnreadCountChange={setAnnouncementUnreadCount} />}
          <AccountDashboard
            user={user}
            profiles={cdkProfiles}
            activeProfile={activeCdkProfile}
            announcement={banner}
            announcementUnreadCount={announcementUnreadCount}
            onAnnouncementUnreadCountChange={setAnnouncementUnreadCount}
            openingProfileId={openingProfileId}
            workspaceLoadError={workspaceLoadError}
            section={route.section}
            onSectionChange={navigateDashboard}
            onLogout={handleLogout}
            onPayload={applyAuthPayload}
            onOpenProfile={(profile) => {
              void refreshProfileWorkspace(profile)
                .then(() => navigate(profileScopedPath(workspaceSetupPath('operators'), profile.id)))
                .catch(console.error)
            }}
            features={features}
          />
        </NotificationCenterProvider>
        {profileUpgradePrompt}
      </>
    )
  }

  if (!activeProfile || !isSchedulableProfile(activeProfile)) {
    return <Navigate to={dashboardPath('profiles')} replace />
  }

  if (route.kind === 'setup') {
    if (!features.profiles) return <FeatureUnavailablePage feature="profiles" />
    if (route.section === 'cdk' && !features.cdk_redemption) return <FeatureUnavailablePage feature="cdk_redemption" />
    return (
      <>
        <PublicContentProvider>
          <NotificationCenterProvider userId={user.id}>
            {features.announcements && <AnnouncementPopup announcements={popups} userId={user.id} onUnreadCountChange={setAnnouncementUnreadCount} />}
            <WorkspaceSetupPage
              user={user}
              profile={activeProfile}
              workspace={workspace}
              announcement={banner}
              activeSection={route.section}
              onSectionChange={navigateSetup}
              onSaved={(payload) => {
                applyAuthPayload(payload)
                navigate(profileScopedPath(optimizePath('overview'), activeProfile.id))
              }}
              onSynced={applyAuthPayload}
              onBack={() => navigate(dashboardPath('profiles'))}
              onRedeemNewProfile={() => navigate(dashboardPath('redeem'))}
              onLogout={handleLogout}
            />
          </NotificationCenterProvider>
        </PublicContentProvider>
        {profileUpgradePrompt}
      </>
    )
  }

  if (!license) {
    return <Navigate to={profileScopedPath(workspace?.operators ? workspaceSetupPath('config') : workspaceSetupPath('operators'), activeProfile.id)} replace />
  }

  if (route.section === 'lab' && !features.schedule_generation) {
    return <FeatureUnavailablePage feature="schedule_generation" />
  }

  return (
    <>
      <NotificationCenterProvider userId={user.id}>
        {features.announcements && <AnnouncementPopup announcements={popups} userId={user.id} onUnreadCountChange={setAnnouncementUnreadCount} />}
        <Suspense fallback={<SessionLoader label={copy.common.pages_ToolPage_002} />}>
          <OptimizePage
            profileId={activeProfile.id}
            profile={activeProfile}
            license={license}
            workspace={workspace}
            setLicense={setLicense}
            eliteOverrides={eliteOverrides}
            configOverride={configOverride}
            setConfigOverride={setConfigOverride}
            configSyncStatus={configSyncStatus}
            flushConfigSave={flushConfigSave}
            retryConfigSave={retryConfigSave}
            onWorkspacePatch={persistWorkspacePatch}
            onWorkspaceUpdated={applyWorkspaceSnapshot}
            section={route.section}
            onSectionChange={navigateOptimize}
            onReset={() => navigate(profileScopedPath(workspaceSetupPath('operators'), activeProfile.id))}
            onLogout={handleLogout}
            announcement={banner}
            redeemedNotice={null}
            onProfileUpgraded={applyAuthPayload}
          />
        </Suspense>
      </NotificationCenterProvider>
      {profileUpgradePrompt}
    </>
  )
}

function dashboardFeature(section: DashboardSection, features: SiteFeatures) {
  if (section === 'profiles' && !features.profiles) return 'profiles' as const
  if (section === 'tools' && !features.tools) return 'tools' as const
  if (section === 'redeem' && !features.cdk_redemption && !features.free_preview) return 'cdk_redemption' as const
  if (section === 'invitations' && !features.invitations) return 'invitations' as const
  if (section === 'inventory' && !features.inventory) return 'inventory' as const
  if (section === 'announcements' && !features.announcements) return 'announcements' as const
  return null
}
