import { lazy, Suspense } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import AnnouncementPopup from '../components/AnnouncementPopup'
import SessionLoader from '../components/SessionLoader'
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
import { useSiteFeatures } from '../lib/site-feature-context'
import type { SiteFeatures } from '../lib/site-features'
import FeatureUnavailablePage from '../components/FeatureUnavailablePage'


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
  } = useToolSession(requestedProfileId)

  if (!route) return <Navigate to={profileScopedPath(fallbackToolPath(location.pathname), requestedProfileId)} replace />

  if (authLoading) {
    return <SessionLoader label={copy.common.pages_ToolPage_001} />
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
    navigate(path, { replace: options?.replace, flushSync: true })
  }
  const navigateDashboard = (section: DashboardSection, options?: { replace?: boolean }) => {
    navigateToToolPath(dashboardPath(section), options)
  }
  const navigateSetup = (section: WorkspaceSetupSection) => navigateToToolPath(profileScopedPath(workspaceSetupPath(section), activeProfile?.id))
  const navigateOptimize = (section: OptimizeSection) => navigateToToolPath(profileScopedPath(optimizePath(section), activeProfile?.id))

  if (route.kind === 'dashboard') {
    const requiredFeature = dashboardFeature(route.section, features)
    if (requiredFeature) return <FeatureUnavailablePage feature={requiredFeature} />
    return (
      <>
        {features.announcements && <AnnouncementPopup announcements={popups} />}
        <AccountDashboard
          user={user}
          profiles={cdkProfiles}
          activeProfile={activeCdkProfile}
          announcement={banner}
          announcementUnreadCount={announcementUnreadCount}
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
        {features.announcements && <AnnouncementPopup announcements={popups} />}
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
      </>
    )
  }

  if (!license) {
    return <Navigate to={profileScopedPath(workspace?.operators ? workspaceSetupPath('config') : workspaceSetupPath('operators'), activeProfile.id)} replace />
  }

  if (route.section === 'lab' && !canUseScenarioComparison(license)) {
    return <Navigate to={profileScopedPath(optimizePath('overview'), activeProfile.id)} replace />
  }

  if (route.section === 'lab' && !features.schedule_generation) {
    return <FeatureUnavailablePage feature="schedule_generation" />
  }

  return (
    <>
      {features.announcements && <AnnouncementPopup announcements={popups} />}
      <Suspense fallback={<SessionLoader label={copy.common.pages_ToolPage_002} />}>
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
          onReset={() => navigate(profileScopedPath(workspaceSetupPath('operators'), activeProfile.id))}
          announcement={banner}
          redeemedNotice={null}
          onProfileUpgraded={applyAuthPayload}
        />
      </Suspense>
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

function profileScopedPath(path: string, profileId?: string | null): string {
  if (!profileId) return path
  return `${path}?${new URLSearchParams({ profile_id: profileId })}`
}
