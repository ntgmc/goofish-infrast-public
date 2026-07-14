import { lazy, Suspense } from 'react'
import BrandLogo from '../../components/BrandLogo'
import type { DashboardSection } from '../../lib/app-routes'
import type { AuthSuccessResponse, AuthUser, UserGameAccount } from '../../lib/types'

const ProfilesSection = lazy(() => import('./dashboard/ProfilesSection'))
const ToolsSection = lazy(() => import('./dashboard/ToolsSection'))
const RedeemSection = lazy(() => import('./dashboard/RedeemSection'))
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
    profiles: '游戏账号',
    tools: '工具',
    redeem: '添加账号',
    announcements: `公告${announcementUnreadCount > 0 ? ` (${announcementUnreadCount})` : ''}`,
    settings: '账号设置',
  }
  const sections = Object.keys(labels) as DashboardSection[]

  return (
    <div className="tool-shell">
      <aside className="tool-sidebar fixed inset-y-0 left-0 hidden w-64 px-4 py-5 lg:block">
        <div className="border-b border-surface-3 px-2 pb-5">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-primary">MAA 工作台</p>
              <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
            </div>
          </div>
        </div>

        <nav className="mt-5 space-y-1" aria-label="账号导航">
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
            退出登录
          </button>
        </div>
      </aside>

      <main className="lg:pl-64" tabIndex={-1} data-route-focus>
        <header className="tool-header sticky top-0 z-20 px-5 py-4 sm:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <BrandLogo size="sm" className="lg:hidden" />
              <div className="min-w-0">
                <p className="tool-eyebrow">账号工作台</p>
                <h1 className="mt-1 text-xl font-semibold text-ink-primary">{labels[section]}</h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {activeProfile ? `正在查看：${activeProfile.display_name}` : '一个登录账号可以管理多个游戏账号。'}
                </p>
              </div>
            </div>
            <button type="button" onClick={onLogout} className="tool-secondary-action self-start lg:hidden">
              退出登录
            </button>
          </div>

          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="移动端账号导航">
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
  return <div className="tool-panel p-6 text-sm text-ink-secondary">正在载入...</div>
}
