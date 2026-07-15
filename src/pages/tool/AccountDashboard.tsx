import { lazy, Suspense } from 'react'
import BrandLogo from '../../components/BrandLogo'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import type { DashboardSection } from '../../lib/app-routes'
import type { AuthSuccessResponse, AuthUser, UserGameAccount } from '../../lib/types'
import { copy } from '../../copy/index'


const ProfilesSection = lazy(() => import('./dashboard/ProfilesSection'))
const ToolsSection = lazy(() => import('./dashboard/ToolsSection'))
const RedeemSection = lazy(() => import('./dashboard/RedeemSection'))
const InvitationsSection = lazy(() => import('./dashboard/InvitationsSection'))
const AnnouncementsSection = lazy(() => import('./dashboard/AnnouncementsSection'))
const SettingsSection = lazy(() => import('./dashboard/SettingsSection'))

export type { DashboardSection } from '../../lib/app-routes'

export default function AccountDashboard({
  user,
  profiles,
  activeProfile,
  announcementUnreadCount,
  openingProfileId,
  workspaceLoadError,
  section,
  onSectionChange,
  onLogout,
  onPayload,
  onOpenProfile,
}: {
  user: AuthUser
  profiles: UserGameAccount[]
  activeProfile: UserGameAccount | null
  announcementUnreadCount: number
  openingProfileId: string | null
  workspaceLoadError: string | null
  section: DashboardSection
  onSectionChange: (section: DashboardSection, options?: { replace?: boolean }) => void
  onLogout: () => void
  onPayload: (payload: AuthSuccessResponse) => void
  onOpenProfile: (profile: UserGameAccount) => void
}) {
  const labels: Record<DashboardSection, string> = {
    profiles: copy.common.pages_tool_AccountDashboard_001,
    tools: copy.common.pages_tool_AccountDashboard_002,
    redeem: copy.common.pages_tool_AccountDashboard_003,
    invitations: copy.common.pages_tool_AccountDashboard_004,
    announcements: `${copy.common.pages_tool_AccountDashboard_005}${announcementUnreadCount > 0 ? ` (${announcementUnreadCount})` : ''}`,
    settings: copy.common.pages_tool_AccountDashboard_006,
  }
  const sections = Object.keys(labels) as DashboardSection[]

  return (
    <div className="tool-shell">
      <aside className="tool-sidebar fixed inset-y-0 left-0 hidden w-64 px-4 py-5 lg:block">
        <div className="border-b border-surface-3 px-2 pb-5">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-primary">{copy.common.pages_tool_AccountDashboard_007}</p>
              <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
            </div>
          </div>
        </div>

        <nav className="mt-5 space-y-1" aria-label={copy.common.pages_tool_AccountDashboard_008}>
          {sections.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onSectionChange(key)}
              aria-current={section === key ? 'page' : undefined}
              className="tool-nav-link flex w-full items-center px-3 text-left text-sm font-medium"
            >
              {labels[key]}
            </button>
          ))}
        </nav>

        <div className="absolute inset-x-4 bottom-5 border-t border-surface-3 pt-4">
          <button type="button" onClick={onLogout} className="tool-secondary-action w-full">
            {copy.common.pages_tool_AccountDashboard_009}</button>
        </div>
      </aside>

      <main className="lg:pl-64" tabIndex={-1} data-route-focus>
        <header className="tool-header sticky top-0 z-20 px-5 py-4 sm:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <BrandLogo size="sm" className="lg:hidden" />
              <div className="min-w-0">
                <p className="tool-eyebrow">{copy.common.pages_tool_AccountDashboard_010}</p>
                <h1 className="mt-1 text-xl font-semibold text-ink-primary">{labels[section]}</h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {activeProfile ? `${copy.common.pages_tool_AccountDashboard_011}${activeProfile.display_name}` : copy.common.pages_tool_AccountDashboard_012}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 self-start">
              <ThemeSwitcher />
              <button type="button" onClick={onLogout} className="tool-secondary-action lg:hidden">
                {copy.common.pages_tool_AccountDashboard_013}</button>
            </div>
          </div>

          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label={copy.common.pages_tool_AccountDashboard_014}>
            {sections.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onSectionChange(key)}
                aria-current={section === key ? 'page' : undefined}
                className="tool-nav-link shrink-0 px-3 text-sm font-medium"
              >
                {labels[key]}
              </button>
            ))}
          </nav>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
          {workspaceLoadError && (
            <div className="tool-alert tool-alert--error mb-5" role="alert">
              {workspaceLoadError}
            </div>
          )}
          <Suspense fallback={<SectionFallback />}>
            {section === 'profiles' && <ProfilesSection profiles={profiles} openingProfileId={openingProfileId} onOpen={onOpenProfile} onEdit={onPayload} />}
          </Suspense>
          <Suspense fallback={<SectionFallback />}>
            {section === 'tools' && <ToolsSection />}
          </Suspense>
          <Suspense fallback={<SectionFallback />}>
            {section === 'redeem' && <RedeemSection onRedeemed={(payload) => { onPayload(payload); onSectionChange('profiles', { replace: true }) }} />}
          </Suspense>
          <Suspense fallback={<SectionFallback />}>
            {section === 'invitations' && <InvitationsSection />}
          </Suspense>
          <Suspense fallback={<SectionFallback />}>
            {section === 'announcements' && <AnnouncementsSection />}
          </Suspense>
          <Suspense fallback={<SectionFallback />}>
            {section === 'settings' && <SettingsSection profiles={profiles} onLogout={onLogout} />}
          </Suspense>
        </div>
      </main>
    </div>
  )
}

function SectionFallback() {
  return <div className="tool-panel p-6 text-sm text-ink-secondary">{copy.common.pages_tool_AccountDashboard_015}</div>
}
