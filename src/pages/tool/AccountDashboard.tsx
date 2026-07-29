import { lazy, Suspense, useMemo, useState } from 'react'
import { LayoutGroup } from 'motion/react'
import { Link } from 'react-router'
import AnnouncementBanner from '../../components/AnnouncementBanner'
import BrandLogo from '../../components/BrandLogo'
import CompactHeaderMenu from '../../components/CompactHeaderMenu'
import GuidedTour, { hasCompletedTour, useFirstRunTour, type TourDefinition } from '../../components/GuidedTour'
import { AnimatedPresenceRegion, MotionNavIndicator, MotionSkeleton } from '../../components/MotionPrimitives'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import type { DashboardSection } from '../../lib/app-routes'
import type { Announcement, AuthSuccessResponse, AuthUser, UserGameAccount } from '../../lib/types'
import { copy } from '../../copy/index'
import { DEFAULT_SITE_FEATURES, type SiteFeatures } from '../../lib/site-features'


const ProfilesSection = lazy(() => import('./dashboard/ProfilesSection'))
const ToolsSection = lazy(() => import('./dashboard/ToolsSection'))
const RedeemSection = lazy(() => import('./dashboard/RedeemSection'))
const InvitationsSection = lazy(() => import('./dashboard/InvitationsSection'))
const InventorySection = lazy(() => import('./dashboard/InventorySection'))
const BalanceSection = lazy(() => import('./dashboard/BalanceSection'))
const AnnouncementsSection = lazy(() => import('./dashboard/AnnouncementsSection'))
const SettingsSection = lazy(() => import('./dashboard/SettingsSection'))

export type { DashboardSection } from '../../lib/app-routes'

export default function AccountDashboard({
  user,
  profiles,
  activeProfile,
  announcement,
  announcementUnreadCount,
  openingProfileId,
  workspaceLoadError,
  section,
  onSectionChange,
  onLogout,
  onPayload,
  onOpenProfile,
  features = DEFAULT_SITE_FEATURES,
}: {
  user: AuthUser
  profiles: UserGameAccount[]
  activeProfile: UserGameAccount | null
  announcement: Announcement | null
  announcementUnreadCount: number
  openingProfileId: string | null
  workspaceLoadError: string | null
  section: DashboardSection
  onSectionChange: (section: DashboardSection, options?: { replace?: boolean }) => void
  onLogout: () => void
  onPayload: (payload: AuthSuccessResponse) => void
  onOpenProfile: (profile: UserGameAccount) => void
  features?: SiteFeatures
}) {
  const [redeemTourReplayToken, setRedeemTourReplayToken] = useState(0)
  const [suppressInitialRedeemTour] = useState(() => section === 'redeem' && !hasCompletedTour('dashboard-overview', 1))
  const dashboardTour = useFirstRunTour({ id: 'dashboard-overview', version: 1 })
  const dashboardTourDefinition = useMemo<TourDefinition>(() => ({
    id: 'dashboard-overview',
    version: 1,
    steps: [
      { target: 'dashboard-nav-profiles', title: copy.dashboard.pages_tool_AccountDashboard_tour_002, body: copy.dashboard.pages_tool_AccountDashboard_tour_003 },
      { target: 'dashboard-nav-tools', title: copy.dashboard.pages_tool_AccountDashboard_tour_004, body: copy.dashboard.pages_tool_AccountDashboard_tour_005 },
      { target: 'dashboard-nav-redeem', title: copy.dashboard.pages_tool_AccountDashboard_tour_006, body: copy.dashboard.pages_tool_AccountDashboard_tour_007 },
      { target: 'dashboard-nav-invitations', title: copy.dashboard.pages_tool_AccountDashboard_tour_008, body: copy.dashboard.pages_tool_AccountDashboard_tour_009 },
      { target: 'dashboard-nav-settings', title: copy.dashboard.pages_tool_AccountDashboard_tour_010, body: copy.dashboard.pages_tool_AccountDashboard_tour_011 },
    ],
  }), [])
  const labels: Record<DashboardSection, string> = {
    profiles: copy.common.pages_tool_AccountDashboard_001,
    tools: copy.common.pages_tool_AccountDashboard_002,
    redeem: copy.common.pages_tool_AccountDashboard_003,
    invitations: copy.common.pages_tool_AccountDashboard_004,
    inventory: copy.inventory.nav,
    balance: copy.balance.nav,
    announcements: copy.common.pages_tool_AccountDashboard_005,
    settings: copy.common.pages_tool_AccountDashboard_006,
  }
  const announcementBadge = announcementUnreadCount > 0 ? String(announcementUnreadCount) : undefined
  const announcementBadgeLabel = announcementBadge
    ? `${announcementBadge} ${copy.dashboard.pages_tool_dashboard_AnnouncementsSection_008}`
    : undefined
  const sections = (Object.keys(labels) as DashboardSection[]).filter((key) => {
    if (key === 'profiles') return features.profiles
    if (key === 'tools') return features.tools
    if (key === 'redeem') return features.cdk_redemption || features.free_preview
    if (key === 'invitations') return features.invitations
    if (key === 'inventory') return features.inventory
    if (key === 'announcements') return features.announcements
    return true
  })
  const replayTour = () => {
    if (section === 'redeem') setRedeemTourReplayToken((token) => token + 1)
    else dashboardTour.start()
  }

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

        <LayoutGroup id="dashboard-desktop">
          <nav className="mt-5 space-y-1" aria-label={copy.common.pages_tool_AccountDashboard_008}>
            {sections.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onSectionChange(key)}
                data-tour-target={`dashboard-nav-${key}`}
                aria-label={key === 'announcements' && announcementBadgeLabel
                  ? `${labels[key]} ${announcementBadgeLabel}`
                  : undefined}
                aria-current={section === key ? 'page' : undefined}
                className="tool-nav-link flex w-full items-center gap-2 px-3 text-left text-sm font-medium"
              >
                {section === key && <MotionNavIndicator layoutId="dashboard-active" />}
                <span className="relative z-10 min-w-0 flex-1 truncate">{labels[key]}</span>
                {key === 'announcements' && announcementBadge && (
                  <AnnouncementUnreadBadge value={announcementBadge} label={announcementBadgeLabel!} />
                )}
              </button>
            ))}
          </nav>
        </LayoutGroup>

        <nav
          className={`absolute inset-x-4 bottom-5 grid gap-2 border-t border-surface-3 pt-4 ${section === 'profiles' ? 'grid-cols-2' : 'grid-cols-1'}`}
          aria-label={copy.common.pages_tool_AccountDashboard_017}
        >
          {section === 'profiles' && (
            <Link to="/" className="tool-secondary-action w-full">
              {copy.common.pages_tool_AccountDashboard_016}
            </Link>
          )}
          <button type="button" onClick={onLogout} className="tool-secondary-action w-full">
            {copy.common.pages_tool_AccountDashboard_009}</button>
        </nav>
      </aside>

      <main className="lg:pl-64" tabIndex={-1} data-route-focus>
        <header className="tool-header sticky top-0 z-20 px-4 py-1.5 lg:px-8 lg:py-4">
          <div className="mx-auto flex h-11 max-w-7xl items-center justify-between gap-2 lg:hidden">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <BrandLogo size="sm" />
              <CompactHeaderMenu
                ariaLabel={section === 'announcements' && announcementBadgeLabel
                  ? `${copy.common.components_CompactHeaderMenu_001}，${announcementBadgeLabel}`
                  : copy.common.components_CompactHeaderMenu_001}
                triggerLabel={labels[section]}
                triggerBadge={section === 'announcements' ? announcementBadge : undefined}
                triggerBadgeLabel={section === 'announcements' ? announcementBadgeLabel : undefined}
                align="start"
                tourTargets={sections.map((key) => `dashboard-nav-${key}`)}
                className="min-w-0 flex-1 justify-between"
                metadata={{
                  title: copy.common.pages_tool_AccountDashboard_010,
                  description: activeProfile ? `${copy.common.pages_tool_AccountDashboard_011}${activeProfile.display_name}` : copy.common.pages_tool_AccountDashboard_012,
                }}
                items={[
                  ...sections.map((key) => ({
                    type: 'button' as const,
                    id: key,
                    label: labels[key],
                    badge: key === 'announcements' ? announcementBadge : undefined,
                    badgeLabel: key === 'announcements' ? announcementBadgeLabel : undefined,
                    current: section === key,
                    tourTarget: `dashboard-nav-${key}`,
                    onSelect: () => onSectionChange(key),
                  })),
                  { type: 'separator' as const, id: 'actions' },
                  { type: 'button' as const, id: 'tour', label: copy.dashboard.pages_tool_AccountDashboard_tour_001, onSelect: replayTour },
                  ...(section === 'profiles' ? [{ type: 'link' as const, id: 'home', label: copy.common.pages_tool_AccountDashboard_016, to: '/' }] : []),
                  { type: 'button' as const, id: 'logout', label: copy.common.pages_tool_AccountDashboard_013, intent: 'danger' as const, onSelect: onLogout },
                ]}
              />
            </div>
            <ThemeSwitcher iconOnly />
          </div>

          <div className="mx-auto hidden max-w-7xl items-center justify-between gap-4 lg:flex">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0">
                <p className="section-index">{copy.common.pages_tool_AccountDashboard_010}</p>
                <div className="mt-1 flex items-center gap-2">
                  <h1 className="display-title text-xl text-ink-primary">{labels[section]}</h1>
                  {section === 'announcements' && announcementBadge && (
                    <AnnouncementUnreadBadge value={announcementBadge} label={announcementBadgeLabel!} />
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {activeProfile ? `${copy.common.pages_tool_AccountDashboard_011}${activeProfile.display_name}` : copy.common.pages_tool_AccountDashboard_012}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 self-start">
              <button
                type="button"
                onClick={replayTour}
                className="tool-secondary-action"
              >
                {copy.dashboard.pages_tool_AccountDashboard_tour_001}
              </button>
              <ThemeSwitcher />
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl space-y-4 px-5 py-6 sm:px-8">
          <AnnouncementBanner announcement={announcement} />
          {workspaceLoadError && (
            <div className="tool-alert tool-alert--error" role="alert">
              {workspaceLoadError}
            </div>
          )}
          <AnimatedPresenceRegion motionKey={section}>
            <Suspense fallback={<SectionFallback />}>
              {section === 'profiles' && <ProfilesSection profiles={profiles} openingProfileId={openingProfileId} onOpen={onOpenProfile} onEdit={onPayload} />}
              {section === 'tools' && <ToolsSection />}
              {section === 'redeem' && <RedeemSection autoStartTour={!suppressInitialRedeemTour} tourReplayToken={redeemTourReplayToken} onRedeemed={(payload) => { onPayload(payload); onSectionChange('profiles', { replace: true }) }} />}
              {section === 'invitations' && <InvitationsSection />}
              {section === 'inventory' && <InventorySection />}
              {section === 'balance' && <BalanceSection redemptionEnabled={features.cdk_redemption} />}
              {section === 'announcements' && <AnnouncementsSection />}
              {section === 'settings' && <SettingsSection profiles={profiles} onLogout={onLogout} />}
            </Suspense>
          </AnimatedPresenceRegion>
        </div>
      </main>
      <GuidedTour
        definition={dashboardTourDefinition}
        open={dashboardTour.open}
        onFinish={dashboardTour.finish}
        onSkip={dashboardTour.skip}
      />
    </div>
  )
}

function AnnouncementUnreadBadge({ value, label }: { value: string; label: string }) {
  return (
    <span aria-label={label} className="tool-status relative z-10 shrink-0 px-1.5 py-0.5 text-[11px]">
      {value}
    </span>
  )
}

function SectionFallback() {
  return <MotionSkeleton label={copy.common.pages_tool_AccountDashboard_015} rows={4} />
}
