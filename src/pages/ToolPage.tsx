import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Announcement,
  AnnouncementPublicResponse,
  AuthSuccessResponse,
  AuthUser,
  LicenseConfig,
  LicenseFile,
  LicenseOperator,
  PermissionMode,
  UserAnnouncementRead,
  UserGameAccount,
  UserWorkspace,
} from '../lib/types'
import AnnouncementPopup from '../components/AnnouncementPopup'
import AnnouncementBanner from '../components/AnnouncementBanner'
import BuildMetaStrip from '../components/BuildMetaStrip'
import ConfigEditor, { CONFIG_PRESETS, PERMISSION_LABELS, cloneConfig, normalizeConfig, validateConfig } from '../components/ConfigEditor'
import DeferredFeatureMenu from '../components/DeferredFeatureMenu'
import { canonicalJson } from '../lib/crypto'

const OptimizePage = lazy(() => import('./OptimizePage'))

type AuthMode = 'login' | 'register'
type DashboardSection = 'profiles' | 'redeem' | 'announcements' | 'settings'
type WorkspaceSetupSection = 'operators' | 'config'
type WorkspaceMode = 'dashboard' | 'setup' | 'optimize'

export default function ToolPage() {
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profiles, setProfiles] = useState<UserGameAccount[]>([])
  const [activeProfile, setActiveProfile] = useState<UserGameAccount | null>(null)
  const [workspace, setWorkspace] = useState<UserWorkspace | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('dashboard')
  const [license, setLicense] = useState<LicenseFile | null>(null)
  const [eliteOverrides, setEliteOverridesState] = useState<Record<string, number>>({})
  const [configOverride, setConfigOverrideState] = useState<LicenseConfig | null>(null)
  const [banner, setBanner] = useState<Announcement | null>(null)
  const [popups, setPopups] = useState<Announcement[]>([])
  const [announcementUnreadCount, setAnnouncementUnreadCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/announcement')
      .then(async (resp) => (resp.ok ? await resp.json() as AnnouncementPublicResponse : null))
      .then((data) => {
        if (cancelled) return
        setBanner(data?.banner ?? null)
        setPopups(Array.isArray(data?.popups) ? data.popups : [])
      })
      .catch(console.error)

    fetch('/api/auth/me')
      .then(async (resp) => await resp.json() as Partial<AuthSuccessResponse> & { user: AuthUser | null })
      .then((data) => {
        if (cancelled) return
        if (!data.user) {
          applyAuthPayload(null)
          return
        }
        applyAuthPayload(data as AuthSuccessResponse, 'dashboard')
      })
      .catch(() => {
        if (!cancelled) applyAuthPayload(null)
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const applyAuthPayload = useCallback((payload: AuthSuccessResponse | null, nextMode?: WorkspaceMode) => {
    const nextUser = payload?.user ?? null
    const nextProfiles = payload?.profiles ?? []
    const nextProfile = payload?.active_profile ?? null
    const nextWorkspace = payload?.workspace ?? null
    setUser(nextUser)
    setProfiles(nextProfiles)
    setActiveProfile(nextProfile)
    setWorkspace(nextWorkspace)
    setAnnouncementUnreadCount(payload?.announcement_unread_count ?? 0)
    setEliteOverridesState(nextWorkspace?.elite_overrides ?? {})
    setConfigOverrideState(null)
    setLicense(nextProfile && nextWorkspace?.operators && nextWorkspace.config
      ? createAccountLicense(nextProfile, nextWorkspace.operators, nextWorkspace.config)
      : null)
    setWorkspaceMode(nextMode ?? 'dashboard')
  }, [])

  const refreshProfileWorkspace = useCallback(async (profile: UserGameAccount, mode: WorkspaceMode) => {
    const resp = await fetch(`/api/user/workspace?profile_id=${encodeURIComponent(profile.id)}`)
    const data = await resp.json() as AuthSuccessResponse & { error?: string }
    if (!resp.ok) throw new Error(data.error || `加载工作区失败: ${resp.status}`)
    applyAuthPayload(data, mode)
  }, [applyAuthPayload])

  const persistWorkspacePatch = useCallback(async (patch: Partial<UserWorkspace>) => {
    if (!activeProfile) throw new Error('请先选择账号档案。')
    const resp = await fetch('/api/user/workspace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, profile_id: activeProfile.id }),
    })
    const data = await resp.json() as AuthSuccessResponse & { error?: string }
    if (!resp.ok) throw new Error(data.error || `保存失败: ${resp.status}`)
    applyAuthPayload(data, workspaceMode)
    return data
  }, [activeProfile, applyAuthPayload, workspaceMode])

  const setEliteOverrides = useCallback((next: Record<string, number>) => {
    setEliteOverridesState(next)
    void persistWorkspacePatch({ elite_overrides: next }).catch(console.error)
  }, [persistWorkspacePatch])

  const setConfigOverride = useCallback((next: LicenseConfig | null) => {
    setConfigOverrideState(next)
    const nextConfig = next ?? license?.config ?? null
    if (nextConfig) void persistWorkspacePatch({ config: nextConfig }).catch(console.error)
  }, [license, persistWorkspacePatch])

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    applyAuthPayload(null)
  }, [applyAuthPayload])

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">正在检查登录状态...</div>
  }

  return (
    <>
      <AnnouncementPopup announcements={popups} />
      {!user ? (
        <AuthPage announcement={banner} onAuthenticated={(payload) => applyAuthPayload(payload, 'dashboard')} />
      ) : workspaceMode === 'dashboard' ? (
        <AccountDashboard
          user={user}
          profiles={profiles}
          activeProfile={activeProfile}
          announcementUnreadCount={announcementUnreadCount}
          onLogout={handleLogout}
          onPayload={(payload) => applyAuthPayload(payload, 'dashboard')}
          onOpenProfile={(profile) => {
            void refreshProfileWorkspace(profile, 'setup').catch(console.error)
          }}
        />
      ) : activeProfile && (workspaceMode === 'setup' || !license) ? (
        <WorkspaceSetupPage
          user={user}
          profile={activeProfile}
          workspace={workspace}
          announcement={banner}
          onSaved={(payload) => applyAuthPayload(payload, 'optimize')}
          onBack={() => setWorkspaceMode('dashboard')}
          onLogout={handleLogout}
        />
      ) : activeProfile && license ? (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">正在载入排班工具...</div>}>
          <OptimizePage
            profileId={activeProfile.id}
            license={license}
            setLicense={(next) => setLicense(next)}
            eliteOverrides={eliteOverrides}
            setEliteOverrides={setEliteOverrides}
            configOverride={configOverride}
            setConfigOverride={setConfigOverride}
            onReset={() => setWorkspaceMode('setup')}
            announcement={banner}
            redeemedNotice={null}
            onRedownloadLicense={null}
          />
        </Suspense>
      ) : (
        <AccountDashboard
          user={user}
          profiles={profiles}
          activeProfile={activeProfile}
          announcementUnreadCount={announcementUnreadCount}
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

function AuthPage({
  announcement,
  onAuthenticated,
}: {
  announcement: Announcement | null
  onAuthenticated: (payload: AuthSuccessResponse) => void
}) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cdk, setCdk] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'login' ? { email, password } : { email, password, cdk: cdk.trim() || undefined }),
      })
      const data = await resp.json() as AuthSuccessResponse & { error?: string }
      if (!resp.ok || !data.user) throw new Error(data.error || `${mode === 'login' ? '登录' : '注册'}失败: ${resp.status}`)
      onAuthenticated(data)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface-0 px-4 py-8 sm:px-6">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <section className="rounded-xl border border-surface-3 bg-surface-1 p-6 sm:p-8">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-brand-500/10">
              <svg className="h-8 w-8 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a8.25 8.25 0 1115 0" />
              </svg>
            </div>
            <DeferredFeatureMenu />
          </div>
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-ink-primary">MAA 基建排班工作台</h1>
          <p className="mt-3 text-sm leading-6 text-ink-secondary">
            使用邮箱和密码登录。注册时 CDK 可选；也可以先创建账号，进入工作区后再兑换多条 CDK 档案。
          </p>
          <BuildMetaStrip className="mt-6" />
          {announcement?.active && <AnnouncementBanner announcement={announcement} className="mt-6" />}
        </section>

        <form onSubmit={handleSubmit} className="rounded-xl border border-surface-3 bg-surface-1 p-6 sm:p-8">
          <div className="mb-6 grid grid-cols-2 rounded-lg bg-surface-2 p-1">
            <button type="button" onClick={() => setMode('login')} className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>登录</button>
            <button type="button" onClick={() => setMode('register')} className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>注册</button>
          </div>
          {error && <div className="mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">邮箱</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" required />
          </label>
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">密码</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" minLength={8} required />
          </label>
          {mode === 'register' && (
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK（可选）</span>
              <input type="text" value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink-primary" placeholder="可注册后再兑换" />
            </label>
          )}
          <p className="mt-4 text-xs leading-5 text-ink-muted">忘记密码请联系管理员重置。重置后使用管理员提供的新密码登录。</p>
          <button type="submit" disabled={loading} className="mt-6 w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
            {loading ? '处理中...' : mode === 'login' ? '登录' : '创建账号'}
          </button>
        </form>
      </div>
    </main>
  )
}

function AccountDashboard({
  user,
  profiles,
  activeProfile,
  announcementUnreadCount,
  onLogout,
  onPayload,
  onOpenProfile,
}: {
  user: AuthUser
  profiles: UserGameAccount[]
  activeProfile: UserGameAccount | null
  announcementUnreadCount: number
  onLogout: () => void
  onPayload: (payload: AuthSuccessResponse) => void
  onOpenProfile: (profile: UserGameAccount) => void
}) {
  const [section, setSection] = useState<DashboardSection>('profiles')
  const labels: Record<DashboardSection, string> = {
    profiles: '账号档案',
    redeem: '兑换 CDK',
    announcements: `公告${announcementUnreadCount > 0 ? ` (${announcementUnreadCount})` : ''}`,
    settings: '账号设置',
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-surface-3 bg-surface-1 px-4 py-5 lg:block">
        <div className="px-2">
          <p className="text-sm font-semibold text-brand-500">MAA Workspace</p>
          <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
        </div>
        <nav className="mt-8 space-y-1">
          {(Object.keys(labels) as DashboardSection[]).map((key) => (
            <button key={key} type="button" onClick={() => setSection(key)} className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${section === key ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}>
              {labels[key]}
            </button>
          ))}
        </nav>
        <button type="button" onClick={onLogout} className="absolute bottom-5 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">退出登录</button>
      </aside>
      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-surface-3 bg-surface-0/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-ink-primary">{labels[section]}</h1>
              <p className="mt-1 text-sm text-ink-muted">{activeProfile ? `当前: ${activeProfile.display_name}` : '一个登录账号可以维护多个 CDK 档案。'}</p>
            </div>
            <button type="button" onClick={onLogout} className="self-start rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary lg:hidden">退出登录</button>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {(Object.keys(labels) as DashboardSection[]).map((key) => (
              <button key={key} type="button" onClick={() => setSection(key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${section === key ? 'bg-brand-600 text-white' : 'bg-surface-1 text-ink-secondary'}`}>{labels[key]}</button>
            ))}
          </div>
        </header>
        <div className="px-5 py-6 sm:px-8">
          {section === 'profiles' && <ProfileList profiles={profiles} onOpen={onOpenProfile} onEdit={onPayload} />}
          {section === 'redeem' && <RedeemPanel onRedeemed={(payload) => { onPayload(payload); setSection('profiles') }} />}
          {section === 'announcements' && <AnnouncementCenter />}
          {section === 'settings' && <SettingsPanel />}
        </div>
      </main>
    </div>
  )
}

function ProfileList({
  profiles,
  onOpen,
  onEdit,
}: {
  profiles: UserGameAccount[]
  onOpen: (profile: UserGameAccount) => void
  onEdit: (payload: AuthSuccessResponse) => void
}) {
  if (profiles.length === 0) {
    return (
      <section className="rounded-xl border border-surface-3 bg-surface-1 p-6">
        <h2 className="text-lg font-semibold text-ink-primary">还没有 CDK 档案</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">请先进入“兑换 CDK”，创建第一个游戏账号档案。</p>
      </section>
    )
  }
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      {profiles.map((profile, index) => (
        <ProfileCard key={profile.id} profile={profile} fallbackName={`账号 ${index + 1}`} onOpen={() => onOpen(profile)} onSaved={onEdit} />
      ))}
    </section>
  )
}

function ProfileCard({
  profile,
  fallbackName,
  onOpen,
  onSaved,
}: {
  profile: UserGameAccount
  fallbackName: string
  onOpen: () => void
  onSaved: (payload: AuthSuccessResponse) => void
}) {
  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState(profile.display_name || fallbackName)
  const [note, setNote] = useState(profile.note)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    const resp = await fetch('/api/user/profiles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profile.id, display_name: displayName, note }),
    })
    const data = await resp.json() as AuthSuccessResponse & { error?: string }
    if (!resp.ok) {
      setError(data.error || `保存失败: ${resp.status}`)
      return
    }
    onSaved(data)
    setEditing(false)
  }

  return (
    <article className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-ink-primary">{profile.display_name || fallbackName}</h2>
            <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold text-brand-300">{PERMISSION_LABELS[profile.permission]}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{profile.note || '暂无备注'}</p>
          <p className="mt-3 text-xs text-ink-muted">{profile.operator_count} 名干员 · 更新 {formatDate(profile.updated_at)}</p>
        </div>
        <button type="button" onClick={onOpen} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500">进入工作区</button>
      </div>
      <button type="button" onClick={() => setEditing((value) => !value)} className="mt-4 text-sm font-semibold text-brand-400 hover:text-brand-300">编辑名称和备注</button>
      {editing && (
        <div className="mt-4 space-y-3 rounded-lg bg-surface-2 p-4">
          {error && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}
          <input value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" />
          <textarea value={note} maxLength={500} rows={3} onChange={(event) => setNote(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="账号备注" />
          <button type="button" onClick={() => void save()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">保存</button>
        </div>
      )}
    </article>
  )
}

function RedeemPanel({ onRedeemed }: { onRedeemed: (payload: AuthSuccessResponse) => void }) {
  const [cdk, setCdk] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/user/profiles/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cdk, display_name: displayName, note }),
      })
      const data = await resp.json() as AuthSuccessResponse & { error?: string }
      if (!resp.ok) throw new Error(data.error || `兑换失败: ${resp.status}`)
      setCdk('')
      setDisplayName('')
      setNote('')
      onRedeemed(data)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl rounded-xl border border-surface-3 bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-ink-primary">兑换新的 CDK 档案</h2>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">只能兑换未使用的 CDK。每条 CDK 会创建一个独立账号工作区。</p>
      {error && <div className="mt-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
      <label className="mt-5 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK</span>
        <input value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink-primary" required />
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">档案名称</span>
        <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="例如：主号" />
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">备注</span>
        <textarea value={note} onChange={(event) => setNote(event.currentTarget.value)} rows={4} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="只建议填写账号说明，不要保存密码。" />
      </label>
      <button type="submit" disabled={loading} className="mt-5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">{loading ? '兑换中...' : '兑换 CDK'}</button>
    </form>
  )
}

function AnnouncementCenter() {
  const [items, setItems] = useState<UserAnnouncementRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const resp = await fetch('/api/user/announcements')
      const data = await resp.json() as { announcements?: UserAnnouncementRead[]; error?: string }
      if (!resp.ok) throw new Error(data.error || `加载公告失败: ${resp.status}`)
      setItems(data.announcements ?? [])
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const markRead = async (announcementId?: string) => {
    await fetch('/api/user/announcements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(announcementId ? { announcement_id: announcementId } : { all: true }),
    })
    await load()
  }

  return (
    <section className="max-w-4xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-secondary">查看当前启用公告，并维护已读状态。</p>
        <button type="button" onClick={() => void markRead()} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">全部已读</button>
      </div>
      {loading && <p className="text-sm text-ink-secondary">正在加载公告...</p>}
      {error && <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
      {!loading && items.length === 0 && <div className="rounded-xl border border-surface-3 bg-surface-1 p-6 text-sm text-ink-secondary">暂无启用公告。</div>}
      {items.map(({ announcement, read_at }) => (
        <article key={announcement.id} className={`rounded-xl border p-5 ${read_at ? 'border-surface-3 bg-surface-1' : 'border-brand-500/50 bg-brand-500/10'}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-ink-primary">{announcement.title}</h2>
                {!read_at && <span className="rounded-md bg-brand-600 px-2 py-1 text-xs font-semibold text-white">未读</span>}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{announcement.body}</p>
              <p className="mt-3 text-xs text-ink-muted">更新 {formatDate(announcement.updated_at)}</p>
            </div>
            {!read_at && <button type="button" onClick={() => void markRead(announcement.id)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">标记已读</button>}
          </div>
        </article>
      ))}
    </section>
  )
}

function SettingsPanel() {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。')
      return
    }
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const resp = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      })
      const data = await resp.json() as { error?: string }
      if (!resp.ok) throw new Error(data.error || `修改失败: ${resp.status}`)
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setStatus('密码已更新。')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-xl rounded-xl border border-surface-3 bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-ink-primary">修改登录密码</h2>
      {error && <div className="mt-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
      {status && <div className="mt-5 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{status}</div>}
      <label className="mt-5 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">当前密码</span>
        <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" required />
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">新密码</span>
        <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" minLength={8} required />
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">确认新密码</span>
        <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" minLength={8} required />
      </label>
      <button type="submit" disabled={loading} className="mt-5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">{loading ? '保存中...' : '修改密码'}</button>
    </form>
  )
}

function WorkspaceSetupPage({
  user,
  profile,
  workspace,
  announcement,
  onSaved,
  onBack,
  onLogout,
}: {
  user: AuthUser
  profile: UserGameAccount
  workspace: UserWorkspace | null
  announcement: Announcement | null
  onSaved: (payload: AuthSuccessResponse) => void
  onBack: () => void
  onLogout: () => void
}) {
  const [operators, setOperators] = useState<LicenseOperator[] | null>(workspace?.operators ?? null)
  const [operatorFileName, setOperatorFileName] = useState<string | null>(null)
  const [operatorSearch, setOperatorSearch] = useState('')
  const [config, setConfig] = useState<LicenseConfig>(() => normalizeConfig(workspace?.config ?? cloneConfig(CONFIG_PRESETS['243'])))
  const [activeSection, setActiveSection] = useState<WorkspaceSetupSection>('operators')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
  const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])
  const canEditConfig = profile.permission === 'advanced' || profile.permission === 'ultimate' || profile.permission === 'admin'
  const canEditLimitedConfig = profile.permission === 'recommended' || profile.permission === 'growth'
  const ownedOperatorCount = useMemo(() => operators?.filter((operator) => operator.own !== false).length ?? 0, [operators])
  const configChanged = workspace?.config ? canonicalJson(normalizedConfig) !== canonicalJson(workspace.config) : true
  const filteredOperators = useMemo(() => {
    const keyword = operatorSearch.trim().toLowerCase()
    const source = operators ?? []
    return keyword ? source.filter((operator) => operator.name.toLowerCase().includes(keyword) || operator.id.toLowerCase().includes(keyword)) : source
  }, [operatorSearch, operators])
  const setupSections: Array<{ id: WorkspaceSetupSection; label: string; ready: boolean }> = [
    { id: 'operators', label: '干员数据', ready: Boolean(operators) },
    { id: 'config', label: '基建配置', ready: configValidation.ok },
  ]

  const updateConfig = useCallback((mutate: (config: LicenseConfig) => void) => {
    const next = normalizeConfig(normalizedConfig)
    mutate(next)
    setConfig(next)
  }, [normalizedConfig])

  const handleOperatorsFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    setOperatorFileName(file?.name ?? null)
    setError(null)
    if (!file) return
    try {
      setOperators(parseOperatorsText(await file.text()))
    } catch (caught) {
      setOperators(null)
      setError((caught as Error).message)
    }
  }

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!operators) {
      setError('请先上传 operators.json。')
      return
    }
    if (!configValidation.ok) {
      setError(configValidation.message)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const resp = await fetch('/api/user/workspace', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: profile.id,
          operators,
          config: normalizedConfig,
          elite_overrides: workspace?.elite_overrides ?? {},
        }),
      })
      const data = await resp.json() as AuthSuccessResponse & { error?: string }
      if (!resp.ok || !data.user) throw new Error(data.error || `保存失败: ${resp.status}`)
      onSaved(data)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-surface-3 bg-surface-1 px-4 py-5 lg:block">
        <div className="px-2">
          <p className="text-sm font-semibold text-brand-500">MAA Workspace</p>
          <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
          <p className="mt-3 truncate text-sm font-medium text-ink-primary">{profile.display_name}</p>
        </div>
        <nav className="mt-8 space-y-1">
          {setupSections.map((section) => (
            <button key={section.id} type="button" onClick={() => setActiveSection(section.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${activeSection === section.id ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}>
              <span>{section.label}</span>
              <span className={`h-2 w-2 rounded-full ${section.ready ? 'bg-success' : 'bg-surface-4'}`} />
            </button>
          ))}
        </nav>
        <button type="button" onClick={onBack} className="absolute bottom-16 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">返回档案</button>
        <button type="button" onClick={onLogout} className="absolute bottom-5 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">退出登录</button>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-surface-3 bg-surface-0/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-brand-400">{profile.display_name}</p>
              <h1 className="mt-1 text-xl font-semibold text-ink-primary">准备账号工作区</h1>
              <p className="mt-1 text-sm text-ink-muted">上传干员数据并确认基建配置，保存后进入排班优化。</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onBack} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">返回档案</button>
              <button type="button" onClick={onLogout} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3 lg:hidden">退出登录</button>
            </div>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {setupSections.map((section) => (
              <button key={section.id} type="button" onClick={() => setActiveSection(section.id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${activeSection === section.id ? 'bg-brand-600 text-white' : 'bg-surface-1 text-ink-secondary'}`}>{section.label}</button>
            ))}
          </div>
          {announcement?.active && <AnnouncementBanner announcement={announcement} className="mt-4" />}
        </header>

        <form onSubmit={handleSave} className="px-5 py-6 sm:px-8">
          <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              {error && <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
              {activeSection === 'operators' && (
                <section className="rounded-xl border border-surface-3 bg-surface-1 p-5 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-ink-primary">干员数据</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">上传 MAA 干员识别导出的 JSON/TXT，并在保存前预览头像、精英化和等级。</p>
                    </div>
                    {operators && <span className="rounded-md bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">已就绪</span>}
                  </div>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">
                      {operatorFileName ? `已选择：${operatorFileName}` : operators ? `已载入 ${operators.length} 名干员` : '选择干员数据文件'}
                      <input type="file" accept=".json,.txt,application/json,text/plain" onChange={handleOperatorsFile} className="hidden" />
                    </label>
                    {operators && <span className="text-sm text-brand-400">拥有干员 {ownedOperatorCount} 名</span>}
                  </div>
                  {operators && (
                    <div className="mt-5">
                      <input value={operatorSearch} onChange={(event) => setOperatorSearch(event.currentTarget.value)} className="mb-4 w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="搜索干员名称或 ID" />
                      <div className="grid max-h-[560px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                        {filteredOperators.map((operator) => <OperatorPreviewCard key={operator.id} operator={operator} />)}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {activeSection === 'config' && (
                <ConfigEditor
                  config={normalizedConfig}
                  canEdit={canEditConfig}
                  canEditIntermediateInventory={canEditLimitedConfig}
                  canEditShiftHours={canEditLimitedConfig}
                  canSelectPreset
                  changed={configChanged}
                  permission={profile.permission}
                  validation={configValidation}
                  onUpdate={updateConfig}
                  note="配置会保存到当前 CDK 档案，不再生成本地授权文件。"
                />
              )}
            </div>

            <aside className="space-y-5">
              <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                <h2 className="text-base font-semibold text-ink-primary">工作区状态</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <InfoRow label="权限" value={PERMISSION_LABELS[profile.permission]} />
                  <InfoRow label="干员" value={operators ? `${operators.length} 名` : '未上传'} />
                  <InfoRow label="拥有" value={operators ? `${ownedOperatorCount} 名` : '-'} />
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-ink-muted">配置</dt>
                    <dd className={`font-medium ${configValidation.ok ? 'text-success' : 'text-error'}`}>{configValidation.ok ? (configChanged ? '已调整' : '已同步') : '需修正'}</dd>
                  </div>
                </dl>
              </section>
              <button type="submit" disabled={saving || !operators || !configValidation.ok} className="w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                {saving ? '正在保存...' : '保存工作区并开始排班'}
              </button>
            </aside>
          </div>
        </form>
      </main>
    </div>
  )
}

function OperatorPreviewCard({ operator }: { operator: LicenseOperator }) {
  const avatarRef = useRef<HTMLDivElement | null>(null)
  const [shouldLoadAvatar, setShouldLoadAvatar] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const owned = operator.own !== false
  const level = typeof operator.level === 'number' ? operator.level : typeof operator.level === 'string' ? operator.level : '-'

  useEffect(() => {
    setImageFailed(false)
    setShouldLoadAvatar(false)
  }, [operator.id])

  useEffect(() => {
    const target = avatarRef.current
    if (!target || shouldLoadAvatar) return
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoadAvatar(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setShouldLoadAvatar(true)
        observer.disconnect()
      },
      { root: null, rootMargin: '360px 0px', threshold: 0.01 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [shouldLoadAvatar])

  return (
    <article className={`flex min-w-0 items-center gap-3 rounded-lg border border-surface-3 bg-surface-0 p-3 ${owned ? '' : 'opacity-55 grayscale'}`}>
      <div ref={avatarRef} className="h-14 w-14 flex-none overflow-hidden rounded-lg bg-surface-2">
        {shouldLoadAvatar && !imageFailed ? (
          <img
            src={`/webp96/${operator.id}.webp`}
            alt={operator.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-ink-muted">{operator.name.slice(0, 1)}</div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink-primary">{operator.name}</p>
        <p className="mt-1 text-xs text-ink-muted">精 {operator.elite} · Lv {level}</p>
        {!owned && <p className="mt-1 text-xs font-medium text-ink-muted">未拥有</p>}
      </div>
    </article>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-surface-3 pb-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink-primary">{value}</dd>
    </div>
  )
}

function createAccountLicense(profile: UserGameAccount, operators: LicenseOperator[], config: LicenseConfig): LicenseFile {
  return {
    version: 1,
    order_hash: profile.cdk_order_hash ?? profile.id.slice(0, 16),
    operators,
    config,
    permission: normalizePermission(profile.permission),
    issued_at: profile.created_at,
    sig: `account-${profile.id}`,
  }
}

function normalizePermission(permission: PermissionMode): PermissionMode {
  if (permission === 'recommended' || permission === 'growth' || permission === 'advanced' || permission === 'ultimate' || permission === 'admin') return permission
  return 'growth'
}

function parseOperatorsText(text: string): LicenseOperator[] {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (!Array.isArray(data) || data.length === 0) throw new Error('干员数据不能为空。')
  const requiredKeys = ['id', 'name', 'own', 'elite', 'rarity']
  data.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`第 ${index + 1} 个干员不是对象。`)
    for (const key of requiredKeys) {
      if (!(key in raw)) throw new Error(`第 ${index + 1} 个干员缺少 ${key} 字段。`)
    }
  })
  return data as LicenseOperator[]
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
