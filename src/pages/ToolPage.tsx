import { lazy, Suspense } from 'react'
import AnnouncementPopup from '../components/AnnouncementPopup'
import AccountDashboard from './tool/AccountDashboard'
import AuthPage from './tool/AuthPage'
import WorkspaceSetupPage from './tool/WorkspaceSetupPage'
import { isCdkProfile } from './tool/tool-utils'
import { useToolSession } from './tool/useToolSession'

const OptimizePage = lazy(() => import('./OptimizePage'))

export default function ToolPage() {
  const {
    authLoading,
    user,
    activeProfile,
    activeCdkProfile,
    cdkProfiles,
    workspace,
    workspaceMode,
    setWorkspaceMode,
    license,
    setLicense,
    eliteOverrides,
    setEliteOverrides,
    configOverride,
    setConfigOverride,
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

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">正在确认登录信息...</div>
  }

  return (
    <>
      <AnnouncementPopup announcements={popups} />
      {!user ? (
        <AuthPage announcement={banner} onAuthenticated={(payload) => applyAuthPayload(payload, 'dashboard')} />
      ) : workspaceMode === 'dashboard' ? (
        <AccountDashboard
          user={user}
          profiles={cdkProfiles}
          activeProfile={activeCdkProfile}
          announcementUnreadCount={announcementUnreadCount}
          openingProfileId={openingProfileId}
          workspaceLoadError={workspaceLoadError}
          onLogout={handleLogout}
          onPayload={(payload) => applyAuthPayload(payload, 'dashboard')}
          onOpenProfile={(profile) => {
            void refreshProfileWorkspace(profile, 'setup').catch(console.error)
          }}
        />
      ) : activeProfile && isCdkProfile(activeProfile) && (workspaceMode === 'setup' || !license) ? (
        <WorkspaceSetupPage
          user={user}
          profile={activeProfile}
          workspace={workspace}
          announcement={banner}
          onSaved={(payload) => applyAuthPayload(payload, 'optimize')}
          onSynced={(payload) => applyAuthPayload(payload, 'setup')}
          onBack={() => setWorkspaceMode('dashboard')}
          onLogout={handleLogout}
        />
      ) : activeProfile && isCdkProfile(activeProfile) && license ? (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">正在载入排班工具...</div>}>
          <OptimizePage
            profileId={activeProfile.id}
            license={license}
            workspace={workspace}
            setLicense={(next) => setLicense(next)}
            eliteOverrides={eliteOverrides}
            setEliteOverrides={setEliteOverrides}
            configOverride={configOverride}
            setConfigOverride={setConfigOverride}
            onWorkspacePatch={persistWorkspacePatch}
            onReset={() => setWorkspaceMode('setup')}
            announcement={banner}
            redeemedNotice={null}
            onRedownloadLicense={null}
          />
        </Suspense>
      ) : (
        <AccountDashboard
          user={user}
          profiles={cdkProfiles}
          activeProfile={activeCdkProfile}
          announcementUnreadCount={announcementUnreadCount}
          openingProfileId={openingProfileId}
          workspaceLoadError={workspaceLoadError}
          onLogout={handleLogout}
          onPayload={(payload) => applyAuthPayload(payload, 'dashboard')}
          onOpenProfile={(profile) => {
            void refreshProfileWorkspace(profile, 'setup').catch(console.error)
          }}
        />
      )}
    </>
  )
}
