import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Announcement,
  AnnouncementPublicResponse,
  AuthSuccessResponse,
  AuthUser,
  LicenseConfig,
  LicenseFile,
  LicenseOperator,
  PermissionMode,
  UserWorkspace,
} from '../lib/types'
import AnnouncementPopup from '../components/AnnouncementPopup'
import AnnouncementBanner from '../components/AnnouncementBanner'
import BuildMetaStrip from '../components/BuildMetaStrip'
import ConfigEditor, { CONFIG_PRESETS, cloneConfig, normalizeConfig, validateConfig } from '../components/ConfigEditor'
import DeferredFeatureMenu from '../components/DeferredFeatureMenu'
import { canonicalJson } from '../lib/crypto'

const OptimizePage = lazy(() => import('./OptimizePage'))

type AuthMode = 'login' | 'register'
type WorkspaceMode = 'setup' | 'optimize'

export default function ToolPage() {
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [workspace, setWorkspace] = useState<UserWorkspace | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('setup')
  const [license, setLicense] = useState<LicenseFile | null>(null)
  const [eliteOverrides, setEliteOverridesState] = useState<Record<string, number>>({})
  const [configOverride, setConfigOverrideState] = useState<LicenseConfig | null>(null)
  const [banner, setBanner] = useState<Announcement | null>(null)
  const [popups, setPopups] = useState<Announcement[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/announcement')
      .then(async (resp) => (resp.ok ? await resp.json() as AnnouncementPublicResponse : null))
      .then((data) => {
        if (cancelled) return
        setBanner(data?.banner ?? null)
        setPopups(Array.isArray(data?.popups) ? data.popups : [])
      })
      .catch(() => {
        if (!cancelled) {
          setBanner(null)
          setPopups([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(async (resp) => (resp.ok ? await resp.json() as AuthSuccessResponse : { user: null, workspace: null }))
      .then((data) => {
        if (cancelled) return
        applyAuthPayload(data.user, data.workspace)
      })
      .catch(() => {
        if (!cancelled) applyAuthPayload(null, null)
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const applyAuthPayload = useCallback((nextUser: AuthUser | null, nextWorkspace: UserWorkspace | null) => {
    setUser(nextUser)
    setWorkspace(nextWorkspace)
    const nextLicense = nextUser && nextWorkspace?.operators && nextWorkspace.config
      ? createAccountLicense(nextUser, nextWorkspace.operators, nextWorkspace.config)
      : null
    setLicense(nextLicense)
    setEliteOverridesState(nextWorkspace?.elite_overrides ?? {})
    setConfigOverrideState(null)
    setWorkspaceMode(nextLicense ? 'optimize' : 'setup')
  }, [])

  const persistWorkspacePatch = useCallback(async (patch: Partial<UserWorkspace>) => {
    const resp = await fetch('/api/user/workspace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await resp.json() as { error?: string; user?: AuthUser; workspace?: UserWorkspace }
    if (!resp.ok || !data.user || !data.workspace) {
      throw new Error(data.error || `保存失败: ${resp.status}`)
    }
    setUser(data.user)
    setWorkspace(data.workspace)
    return data
  }, [])

  const setEliteOverrides = useCallback((next: Record<string, number>) => {
    setEliteOverridesState(next)
    void persistWorkspacePatch({ elite_overrides: next }).catch(console.error)
  }, [persistWorkspacePatch])

  const setConfigOverride = useCallback((next: LicenseConfig | null) => {
    setConfigOverrideState(next)
    const nextConfig = next ?? license?.config ?? null
    if (nextConfig) void persistWorkspacePatch({ config: nextConfig }).catch(console.error)
  }, [license, persistWorkspacePatch])

  const handleAuthenticated = useCallback((payload: AuthSuccessResponse) => {
    applyAuthPayload(payload.user, payload.workspace)
  }, [applyAuthPayload])

  const handleWorkspaceSaved = useCallback((nextUser: AuthUser, nextWorkspace: UserWorkspace) => {
    applyAuthPayload(nextUser, nextWorkspace)
  }, [applyAuthPayload])

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    applyAuthPayload(null, null)
  }, [applyAuthPayload])

  return (
    <>
      <AnnouncementPopup announcements={popups} />
      {authLoading ? (
        <div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">
          正在检查登录状态...
        </div>
      ) : !user ? (
        <AuthPage announcement={banner} onAuthenticated={handleAuthenticated} />
      ) : workspaceMode === 'setup' || !license ? (
        <WorkspaceSetupPage
          user={user}
          workspace={workspace}
          announcement={banner}
          onSaved={handleWorkspaceSaved}
          onLogout={handleLogout}
        />
      ) : (
        <Suspense fallback={
          <div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">
            正在载入排班工具...
          </div>
        }>
          <OptimizePage
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
        body: JSON.stringify(mode === 'login' ? { email, password } : { email, password, cdk }),
      })
      const data = await resp.json() as AuthSuccessResponse & { error?: string }
      if (!resp.ok || !data.user || !data.workspace) {
        throw new Error(data.error || `${mode === 'login' ? '登录' : '注册'}失败: ${resp.status}`)
      }
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
            使用邮箱和密码登录，注册时绑定 CDK。授权和工作状态会保存在后端，不再需要下载或上传授权文件。
          </p>
          <BuildMetaStrip placement="corner" />
          {announcement?.active && <AnnouncementBanner announcement={announcement} className="mt-5" />}
        </section>

        <form onSubmit={handleSubmit} className="rounded-xl border border-surface-3 bg-surface-1 p-6 sm:p-8">
          <div className="mb-6 grid grid-cols-2 rounded-lg bg-surface-2 p-1">
            <button type="button" onClick={() => setMode('login')} className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>
              登录
            </button>
            <button type="button" onClick={() => setMode('register')} className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>
              注册
            </button>
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
              <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK</span>
              <input type="text" value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink-primary" placeholder="MAA-XXXX-XXXX-XXXX" required />
            </label>
          )}

          <button type="submit" disabled={loading} className="mt-6 w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
            {loading ? '处理中...' : mode === 'login' ? '登录' : '注册并绑定 CDK'}
          </button>
        </form>
      </div>
    </main>
  )
}

function WorkspaceSetupPage({
  user,
  workspace,
  announcement,
  onSaved,
  onLogout,
}: {
  user: AuthUser
  workspace: UserWorkspace | null
  announcement: Announcement | null
  onSaved: (user: AuthUser, workspace: UserWorkspace) => void
  onLogout: () => void
}) {
  const [operators, setOperators] = useState<LicenseOperator[] | null>(workspace?.operators ?? null)
  const [operatorFileName, setOperatorFileName] = useState<string | null>(null)
  const [config, setConfig] = useState<LicenseConfig>(() => normalizeConfig(workspace?.config ?? cloneConfig(CONFIG_PRESETS['243'])))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
  const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])
  const canEditConfig = user.permission === 'advanced' || user.permission === 'ultimate' || user.permission === 'admin'
  const canEditLimitedConfig = user.permission === 'recommended' || user.permission === 'growth'

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
          operators,
          config: normalizedConfig,
          elite_overrides: workspace?.elite_overrides ?? {},
        }),
      })
      const data = await resp.json() as { error?: string; user?: AuthUser; workspace?: UserWorkspace }
      if (!resp.ok || !data.user || !data.workspace) throw new Error(data.error || `保存失败: ${resp.status}`)
      onSaved(data.user, data.workspace)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface-0 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 rounded-xl border border-surface-3 bg-surface-1 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium text-brand-400">{user.email}</p>
              <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em] text-ink-primary">准备账号工作区</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-secondary">
                上传干员数据并确认基建配置。保存后这些内容会进入后端工作区，下次登录会自动恢复。
              </p>
            </div>
            <button type="button" onClick={onLogout} className="self-start rounded-lg border border-surface-4 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-2 hover:text-ink-primary">
              退出登录
            </button>
          </div>
          {announcement?.active && <AnnouncementBanner announcement={announcement} className="mt-5" />}
        </header>

        <form onSubmit={handleSave} className="space-y-5">
          {error && <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}

          <section className="rounded-xl bg-surface-1 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-ink-primary">干员数据</h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              从 MAA 干员识别导出的 JSON/TXT 会保存到后端账号工作区。
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">
                {operatorFileName ? `已选择：${operatorFileName}` : operators ? `已载入 ${operators.length} 名干员` : '选择干员数据文件'}
                <input type="file" accept=".json,.txt,application/json,text/plain" onChange={handleOperatorsFile} className="hidden" />
              </label>
              {operators && <span className="text-sm text-brand-400">已载入 {operators.filter((operator) => operator.own !== false).length} 名拥有干员</span>}
            </div>
          </section>

          <ConfigEditor
            config={normalizedConfig}
            canEdit={canEditConfig}
            canEditIntermediateInventory={canEditLimitedConfig}
            canEditShiftHours={canEditLimitedConfig}
            canSelectPreset
            changed={workspace?.config ? canonicalJson(normalizedConfig) !== canonicalJson(workspace.config) : true}
            permission={user.permission}
            validation={configValidation}
            onUpdate={updateConfig}
            note="配置会保存到后端账号工作区，不再生成本地授权文件。"
          />

          <button type="submit" disabled={saving || !operators || !configValidation.ok} className="w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
            {saving ? '正在保存...' : '保存工作区并开始排班'}
          </button>
        </form>
      </div>
    </main>
  )
}

function createAccountLicense(user: AuthUser, operators: LicenseOperator[], config: LicenseConfig): LicenseFile {
  return {
    version: 1,
    order_hash: user.cdk_order_hash ?? user.id.slice(0, 16),
    operators,
    config,
    permission: normalizePermission(user.permission),
    issued_at: user.created_at,
    sig: `account-${user.id}`,
  }
}

function normalizePermission(permission: PermissionMode): PermissionMode {
  if (permission === 'recommended' || permission === 'growth' || permission === 'advanced' || permission === 'ultimate' || permission === 'admin') {
    return permission
  }
  return 'growth'
}

function parseOperatorsText(text: string): LicenseOperator[] {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('干员数据不能为空。')
  }
  const requiredKeys = ['id', 'name', 'own', 'elite', 'rarity']
  data.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`第 ${index + 1} 个干员不是对象。`)
    for (const key of requiredKeys) {
      if (!(key in raw)) throw new Error(`第 ${index + 1} 个干员缺少 ${key} 字段。`)
    }
  })
  return data as LicenseOperator[]
}
