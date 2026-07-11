import { lazy, Suspense } from 'react'
import type { AuthSuccessResponse, AuthUser, UserGameAccount } from '../../lib/types'
import type { DashboardSection } from '../../lib/app-routes'
import BrandLogo from '../../components/BrandLogo'

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

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-surface-3 bg-surface-1 px-4 py-5 lg:block">
        <div className="flex items-center gap-3 px-2">
          <BrandLogo size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-500">MAA 工作台</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          {(Object.keys(labels) as DashboardSection[]).map((key) => (
            <button key={key} type="button" onClick={() => onSectionChange(key)} aria-current={section === key ? 'page' : undefined} className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${section === key ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}>
              {labels[key]}
            </button>
          ))}
        </nav>
        <button type="button" onClick={onLogout} className="absolute bottom-5 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">退出登录</button>
      </aside>
      <main className="lg:pl-64" tabIndex={-1} data-route-focus>
        <header className="sticky top-0 z-20 border-b border-surface-3 bg-surface-0/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <BrandLogo size="sm" className="lg:hidden" />
            <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink-primary">{labels[section]}</h1>
            <p className="mt-1 text-sm text-ink-muted">{activeProfile ? `正在查看：${activeProfile.display_name}` : '一个登录账号可以添加多个游戏账号。'}</p>
            </div>
          </div>
            <button type="button" onClick={onLogout} className="self-start rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary lg:hidden">退出登录</button>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {(Object.keys(labels) as DashboardSection[]).map((key) => (
              <button key={key} type="button" onClick={() => onSectionChange(key)} aria-current={section === key ? 'page' : undefined} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${section === key ? 'bg-brand-600 text-white' : 'bg-surface-1 text-ink-secondary'}`}>{labels[key]}</button>
            ))}
          </div>
        </header>
        <div className="px-5 py-6 sm:px-8">
        {workspaceLoadError && (
          <div className="mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            {workspaceLoadError}
          </div>
        )}
<Suspense fallback={<SectionFallback />}>{section === 'profiles' && <ProfilesSection profiles={profiles} openingProfileId={openingProfileId} onOpen={onOpenProfile} onEdit={onPayload} />}</Suspense>
<Suspense fallback={<SectionFallback />}>{section === 'tools' && <ToolsSection />}</Suspense>
<Suspense fallback={<SectionFallback />}>{section === 'redeem' && <RedeemSection onRedeemed={(payload) => { onPayload(payload); onSectionChange('profiles', { replace: true }) }} />}</Suspense>
          <Suspense fallback={<SectionFallback />}>{section === 'announcements' && <AnnouncementsSection />}</Suspense>
          <Suspense fallback={<SectionFallback />}>{section === 'settings' && <SettingsSection />}</Suspense>
        </div>
      </main>
    </div>
  )
}


function SectionFallback() {
  return <div className="rounded-xl border border-surface-3 bg-surface-1 p-6 text-sm text-ink-secondary">正在载入...</div>
}
