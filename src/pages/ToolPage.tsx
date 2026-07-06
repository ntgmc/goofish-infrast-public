import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Announcement,
  AnnouncementPublicResponse,
  AuthSuccessResponse,
  AuthUser,
  FreePreviewRequest,
  FreePreviewResult,
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
import BrandLogo from '../components/BrandLogo'
import ConfigEditor, { CONFIG_PRESETS, PERMISSION_LABELS, cloneConfig, normalizeConfig, validateConfig } from '../components/ConfigEditor'
import DeferredFeatureMenu from '../components/DeferredFeatureMenu'
import ScheduleAnalysisTool from '../components/ScheduleAnalysisTool'
import { canonicalJson } from '../lib/crypto'

const OptimizePage = lazy(() => import('./OptimizePage'))

type AuthMode = 'login' | 'register' | 'forgot'
type DashboardSection = 'profiles' | 'preview' | 'tools' | 'redeem' | 'announcements' | 'settings'
type WorkspaceSetupSection = 'operators' | 'config'
type WorkspaceMode = 'dashboard' | 'setup' | 'optimize'
type FieldErrors = Record<string, string>
type SklandPreview = {
  uid: string
  nickname: string
  channel_name: string
  operator_count: number
}

type SklandLoginState = {
  open: boolean
  mode: 'scan' | 'manual' | 'bookmarklet' | 'password'
  scanId: string | null
  qrDataUrl: string | null
  expiresAt: string | null
  confirmationId: string | null
  preview: SklandPreview | null
  status: 'idle' | 'starting' | 'waiting' | 'confirm_required' | 'account_mismatch' | 'importing' | 'imported' | 'frozen' | 'error'
  message: string | null
}

type SklandPayload = AuthSuccessResponse & {
  skland_import?: {
    status: 'imported'
    uid: string
    nickname: string
    channel_name: string
    operator_count: number
    imported_at: string
  }
  error?: string
  confirmation_id?: string
  skland_preview?: SklandPreview
  warning?: string
  status?: string
}

const SKLAND_SCAN_POLL_DELAY_MS = 5000
const SKLAND_SCAN_MAX_POLLS = 18
const SKLAND_CONSOLE_CODE = `(()=>{const raw=localStorage.getItem('SK_OAUTH_CRED_KEY');let cred=raw;try{const data=JSON.parse(raw||'null');cred=data?.cred||data?.value||raw;}catch{}copy('SK_OAUTH_CRED_KEY='+encodeURIComponent(cred||''));console.log(cred?'已复制到粘贴板':'未找到 SK_OAUTH_CRED_KEY');})()`
const SKLAND_BOOKMARKLET = `javascript:(()=>{const raw=localStorage.getItem("SK_OAUTH_CRED_KEY");if(!raw){alert("未找到 SK_OAUTH_CRED_KEY，请先登录森空岛网页。");return;}let cred=raw;try{const data=JSON.parse(raw);cred=data.cred||data.value||raw;}catch{}const text="SK_OAUTH_CRED_KEY="+encodeURIComponent(cred);const done=()=>alert("森空岛凭据已复制，请回到排班工作台粘贴。");navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(text).then(done).catch(()=>prompt("复制下面的森空岛凭据",text)):prompt("复制下面的森空岛凭据",text);})()`

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
  const [openingProfileId, setOpeningProfileId] = useState<string | null>(null)
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null)

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
    setOpeningProfileId(profile.id)
    setWorkspaceLoadError(null)
    try {
      const resp = await fetch(`/api/user/workspace?profile_id=${encodeURIComponent(profile.id)}`)
      const data = await resp.json() as AuthSuccessResponse & { error?: string }
      if (!resp.ok) throw new Error(data.error || `加载账号资料失败: ${resp.status}`)
      applyAuthPayload(data, mode)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '加载账号资料失败，请稍后重试。'
      setWorkspaceLoadError(message)
      throw caught
    } finally {
      setOpeningProfileId(null)
    }
  }, [applyAuthPayload])

  const persistWorkspacePatch = useCallback(async (patch: Partial<UserWorkspace>) => {
    if (!activeProfile) throw new Error('请先选择游戏账号。')
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
          profiles={profiles}
        activeProfile={activeProfile}
        announcementUnreadCount={announcementUnreadCount}
        openingProfileId={openingProfileId}
        workspaceLoadError={workspaceLoadError}
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
          onSynced={(payload) => applyAuthPayload(payload, 'setup')}
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
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    const emailError = validateEmailInput(email)
    const passwordError = mode === 'forgot' ? null : validatePasswordInput(password)
    if (emailError) nextErrors.email = emailError
    if (passwordError) nextErrors.password = passwordError
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'forgot') {
        const resp = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        const data = await resp.json() as { error?: string; message?: string }
        if (!resp.ok) throw new Error(data.error || `发送重置邮件失败: ${resp.status}`)
        setNotice(data.message || '如果该邮箱已注册，我们会发送重置密码邮件。')
        return
      }
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

  const clearFieldError = (field: string) => {
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  return (
    <main className="min-h-screen bg-surface-0 px-4 py-8 sm:px-6">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <section className="rounded-xl border border-surface-3 bg-surface-1 p-6 sm:p-8">
          <div className="mb-5 flex items-start justify-between gap-4">
        <BrandLogo size="lg" />
            <DeferredFeatureMenu />
          </div>
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-ink-primary">MAA 基建排班工作台</h1>
          <p className="mt-3 text-sm leading-6 text-ink-secondary">
            使用邮箱和密码登录。注册时 CDK 可选；也可以先创建账号，登录后再添加多个游戏账号。
          </p>
          {announcement?.active && <AnnouncementBanner announcement={announcement} className="mt-6" />}
        </section>

        <form onSubmit={handleSubmit} noValidate className="rounded-xl border border-surface-3 bg-surface-1 p-6 sm:p-8">
            <div className="mb-6 grid grid-cols-2 rounded-lg bg-surface-2 p-1">
              <button type="button" onClick={() => { setMode('login'); setError(null); setNotice(null) }} className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>登录</button>
              <button type="button" onClick={() => { setMode('register'); setError(null); setNotice(null) }} className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-brand-600 text-white' : 'text-ink-secondary'}`}>注册</button>
            </div>
            {error && <div className="mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
            {notice && <div className="mb-5 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{notice}</div>}
            {mode === 'forgot' && <h2 className="mb-5 text-lg font-semibold text-ink-primary">重置密码</h2>}
            <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">邮箱</span>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.currentTarget.value)
                clearFieldError('email')
              }}
              onFocus={() => clearFieldError('email')}
              className={inputClassName(Boolean(fieldErrors.email))}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
            />
            {fieldErrors.email && <p id="auth-email-error" className="mt-1.5 text-sm text-error">{fieldErrors.email}</p>}
          </label>
            {mode !== 'forgot' && (
              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-medium text-ink-secondary">密码</span>
                <input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.currentTarget.value)
                    clearFieldError('password')
                  }}
                  onFocus={() => clearFieldError('password')}
                  className={inputClassName(Boolean(fieldErrors.password))}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined}
                />
                {fieldErrors.password && <p id="auth-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.password}</p>}
              </label>
            )}
            {mode === 'register' && (
              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK（可选）</span>
                <input type="text" value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink-primary" placeholder="可注册后再兑换" />
              </label>
            )}
            {mode === 'login' && (
              <button type="button" onClick={() => { setMode('forgot'); setError(null); setNotice(null); setFieldErrors({}) }} className="mt-4 text-sm font-medium text-brand-500 underline-offset-4 hover:underline">
                忘记密码？
              </button>
            )}
            {mode === 'forgot' && (
              <button type="button" onClick={() => { setMode('login'); setError(null); setNotice(null); setFieldErrors({}) }} className="mt-4 text-sm font-medium text-brand-500 underline-offset-4 hover:underline">
                返回登录
              </button>
            )}
      <button type="submit" disabled={loading} className="mt-6 w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
        {loading ? '处理中...' : mode === 'login' ? '登录' : mode === 'register' ? '创建账号' : '发送重置邮件'}
      </button>
    </form>
  </div>
</main>
)
}

function FreePreviewPage({ onUseCdk }: { onUseCdk: () => void }) {
const [operators, setOperators] = useState<LicenseOperator[] | null>(null)
const [operatorFileName, setOperatorFileName] = useState<string | null>(null)
const [config, setConfig] = useState<LicenseConfig>(() => normalizeConfig(cloneConfig(CONFIG_PRESETS['243'])))
const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)
const [preview, setPreview] = useState<FreePreviewResult | null>(null)
const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])

const clearPreviewState = useCallback(() => {
  setPreview(null)
  setError(null)
}, [])

const updateConfig = useCallback((mutate: (config: LicenseConfig) => void) => {
  const next = normalizeConfig(normalizedConfig)
  mutate(next)
  setConfig(normalizeConfig(next))
  clearPreviewState()
}, [clearPreviewState, normalizedConfig])

const handleOperatorsFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.currentTarget.files?.[0]
  setOperatorFileName(file?.name ?? null)
  setOperators(null)
  clearPreviewState()
  if (!file) return
  try {
    setOperators(parseOperatorsText(await file.text()))
  } catch (caught) {
    setError((caught as Error).message)
  }
}

const handleSubmit = async (event: React.FormEvent) => {
  event.preventDefault()
  setError(null)
  setPreview(null)
  if (!operators) {
    setError('请先上传 operators.json 或 .txt。')
    return
  }
  if (!configValidation.ok) {
    setError(configValidation.message)
    return
  }
  const payload: FreePreviewRequest = {
    operators,
    config: normalizedConfig,
  }
  setLoading(true)
  try {
    const resp = await fetch('/api/free-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await resp.json() as FreePreviewResult & { error?: string }
    if (!resp.ok) throw new Error(data.error || `免费预览失败: ${resp.status}`)
    setPreview(data)
  } catch (caught) {
    setError((caught as Error).message)
  } finally {
    setLoading(false)
  }
}

const ownedOperatorCount = operators?.filter((operator) => operator.own !== false).length ?? 0

return (
  <div className="mx-auto max-w-4xl space-y-5">
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5 sm:p-6">
      <div>
        <p className="text-sm font-medium text-brand-400">免费预览</p>
        <h2 className="mt-1 text-xl font-semibold text-ink-primary">临时查看账号优化方向</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
          上传 MAA 导出的干员识别文件并选择基建配置，生成限制级排班预览。这里不会创建游戏账号、保存数据或消耗 CDK。
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-5">
        {error && <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
        <div className="space-y-4">
          <section className="rounded-lg border border-surface-3 bg-surface-0 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-primary">干员数据</h3>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">支持 operators.json 或文本格式的干员识别导出。</p>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                {operators && <span className="rounded-md bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">已载入 {ownedOperatorCount} 名干员</span>}
                <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">
                  {operatorFileName ? `已选择：${operatorFileName}` : '选择干员识别文件'}
                  <input
                    type="file"
                    accept=".json,.txt,application/json,text/plain"
                    onChange={handleOperatorsFile}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-surface-3 bg-surface-0 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-primary">基建配置</h3>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">
                  当前：{normalizedConfig.layout || `${normalizedConfig.trading_stations_count}-${normalizedConfig.manufacturing_stations_count}-3`} / {normalizedConfig.desc || '自定义配置'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(CONFIG_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setConfig(normalizeConfig(cloneConfig(preset)))
                      clearPreviewState()
                    }}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 ${
                      normalizedConfig.desc === preset.desc ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'
                    }`}
                  >
                    {key === '243' ? '243 均衡' : key === '243-1' ? '243 搓玉' : '333 搓玉'}
                  </button>
                ))}
              </div>
            </div>
            <details className="mt-4 rounded-lg border border-surface-3 bg-surface-1">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2">
                高级配置
              </summary>
              <div className="border-t border-surface-3 p-4">
                <ConfigEditor
                  config={normalizedConfig}
                  canEdit
                  canEditIntermediateInventory
                  validation={configValidation}
                  onUpdate={updateConfig}
                  embedded
                  hideHeader
                  hidePresetActions
                />
              </div>
            </details>
          </section>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-secondary">免费预览仅展示前 3 个房间，不提供完整排班、练度建议或 MAA JSON。</p>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
        >
          {loading ? '生成预览中...' : '生成免费预览'}
        </button>
        </div>
      </form>
    </section>

    {preview && <FreePreviewResultCard preview={preview} onUseCdk={onUseCdk} />}
  </div>
)
}

function FreePreviewResultCard({ preview, onUseCdk }: { preview: FreePreviewResult; onUseCdk: () => void }) {
const schedule = preview.limited_schedule
return (
  <section className="mt-6 rounded-xl border border-brand-600/25 bg-surface-0 p-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-sm font-medium text-brand-400">免费预览已生成</p>
        <h3 className="mt-1 text-xl font-semibold text-ink-primary">限制级排班预览</h3>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          已按当前表单数据生成排班摘要。完整房间、练度建议和可导入 MAA 的 JSON 需要使用 CDK 添加正式游戏账号。
        </p>
      </div>
      <button
        type="button"
        onClick={onUseCdk}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
      >
        使用 CDK 添加游戏账号
      </button>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <PreviewMetric label="识别干员" value={`${preview.operator_count} 名`} />
      <PreviewMetric label="布局支持" value={preview.support.label} />
      <PreviewMetric label="可能提升" value={preview.potential_range.label} />
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.15fr]">
      <div className="rounded-lg bg-surface-1 p-4">
        <h4 className="text-sm font-semibold text-ink-primary">当前基建布局</h4>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{preview.support.reason}</p>
        <h4 className="mt-5 text-sm font-semibold text-ink-primary">预计可优化方向</h4>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-secondary">
          {preview.directions.map((direction) => <li key={direction}>- {direction}</li>)}
        </ul>
        <p className="mt-4 text-sm leading-6 text-ink-secondary">{preview.potential_range.note}</p>
      </div>

      <div className="rounded-lg bg-surface-1 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h4 className="text-sm font-semibold text-ink-primary">{schedule.plan_name}</h4>
          <span className="text-xs font-medium text-ink-muted">共 {schedule.plan_count} 个方案</span>
        </div>
        <div className="mt-3 divide-y divide-surface-3/70 overflow-hidden rounded-lg border border-surface-3">
          {schedule.rooms.map((room) => (
            <div key={room.key} className="grid gap-2 bg-surface-0 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-primary">{room.label} · {room.index_label}</p>
                <p className="mt-1 truncate text-sm text-ink-secondary">{room.product} / {room.operators.join('、') || '无干员'}</p>
              </div>
              <p className="text-sm font-semibold text-brand-300">{formatPreviewEfficiency(room.efficiency)}</p>
            </div>
          ))}
          {schedule.rooms.length === 0 && <p className="px-4 py-3 text-sm text-ink-secondary">当前配置暂未生成可展示房间。</p>}
        </div>
        {schedule.hidden_room_count > 0 && (
          <p className="mt-3 text-sm text-ink-muted">另有 {schedule.hidden_room_count} 个房间已隐藏。</p>
        )}
      </div>
    </div>

    {preview.notices.length > 0 && (
      <ul className="mt-5 space-y-2 rounded-lg bg-warning/10 px-4 py-3 text-sm leading-6 text-warning">
        {preview.notices.map((notice) => <li key={notice}>- {notice}</li>)}
      </ul>
    )}
  </section>
)
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
return (
  <div className="rounded-lg bg-surface-1 p-4">
    <p className="text-xs font-medium text-ink-muted">{label}</p>
    <p className="mt-1 text-lg font-semibold text-ink-primary">{value}</p>
  </div>
)
}

function AccountDashboard({
  user,
  profiles,
  activeProfile,
  announcementUnreadCount,
  openingProfileId,
  workspaceLoadError,
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
  onLogout: () => void
  onPayload: (payload: AuthSuccessResponse) => void
  onOpenProfile: (profile: UserGameAccount) => void
}) {
  const [section, setSection] = useState<DashboardSection>('profiles')
const labels: Record<DashboardSection, string> = {
profiles: '游戏账号',
preview: '免费预览',
tools: '工具',
redeem: '兑换 CDK',
announcements: `公告${announcementUnreadCount > 0 ? ` (${announcementUnreadCount})` : ''}`,
    settings: '账号设置',
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-surface-3 bg-surface-1 px-4 py-5 lg:block">
        <div className="flex items-center gap-3 px-2">
          <BrandLogo size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-500">MAA Workspace</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
          </div>
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
              <button key={key} type="button" onClick={() => setSection(key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${section === key ? 'bg-brand-600 text-white' : 'bg-surface-1 text-ink-secondary'}`}>{labels[key]}</button>
            ))}
          </div>
        </header>
        <div className="px-5 py-6 sm:px-8">
        {workspaceLoadError && (
          <div className="mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
            {workspaceLoadError}
          </div>
        )}
{section === 'profiles' && <ProfileList profiles={profiles} openingProfileId={openingProfileId} onOpen={onOpenProfile} onEdit={onPayload} />}
{section === 'preview' && <FreePreviewPage onUseCdk={() => setSection('redeem')} />}
{section === 'tools' && <DashboardTools />}
{section === 'redeem' && <RedeemPanel onRedeemed={(payload) => { onPayload(payload); setSection('profiles') }} />}
          {section === 'announcements' && <AnnouncementCenter />}
          {section === 'settings' && <SettingsPanel />}
        </div>
      </main>
    </div>
  )
}

function DashboardTools() {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-surface-3 bg-surface-1 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">仓库价值分析器</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              粘贴 MAA 仓库识别导出的 JSON，生成仓库资产估值和可下载截图；不会读取或覆盖当前账号保存的数据。
            </p>
          </div>
          <a
            href="/tools/depot-value"
            className="inline-flex w-fit items-center justify-center rounded-lg border border-surface-3 bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:border-surface-4 hover:bg-surface-2 hover:text-ink-primary"
          >
            打开独立页面
          </a>
        </div>
      </section>
      <section className="rounded-lg border border-surface-3 bg-surface-1 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">排班表分析</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              这里和公开工具页使用同一套分析能力；不会读取或覆盖当前账号保存的干员数据。
            </p>
          </div>
          <a
            href="/tools/schedule-analysis"
            className="inline-flex w-fit items-center justify-center rounded-lg border border-surface-3 bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:border-surface-4 hover:bg-surface-2 hover:text-ink-primary"
          >
            打开独立页面
          </a>
        </div>
      </section>
      <ScheduleAnalysisTool compact />
    </div>
  )
}

function ProfileList({
  profiles,
  openingProfileId,
  onOpen,
  onEdit,
}: {
  profiles: UserGameAccount[]
  openingProfileId: string | null
  onOpen: (profile: UserGameAccount) => void
  onEdit: (payload: AuthSuccessResponse) => void
}) {
  if (profiles.length === 0) {
    return (
<section className="rounded-xl border border-surface-3 bg-surface-1 p-6">
<h2 className="text-lg font-semibold text-ink-primary">还没有添加游戏账号</h2>
<p className="mt-2 text-sm leading-6 text-ink-secondary">可以先进入“免费预览”查看账号优化方向；正式添加游戏账号仍需要未使用的 CDK。</p>
</section>
    )
  }
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      {profiles.map((profile, index) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          fallbackName={`账号 ${index + 1}`}
          opening={openingProfileId === profile.id}
          onOpen={() => onOpen(profile)}
          onSaved={onEdit}
        />
      ))}
    </section>
  )
}

function ProfileCard({
  profile,
  fallbackName,
  opening,
  onOpen,
  onSaved,
}: {
  profile: UserGameAccount
  fallbackName: string
  opening: boolean
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
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:cursor-wait disabled:bg-surface-3 disabled:text-ink-muted"
        >
          {opening ? '正在准备...' : '准备这个账号'}
        </button>
      </div>
      <button type="button" onClick={() => setEditing((value) => !value)} className="mt-4 text-sm font-semibold text-brand-400 hover:text-brand-300">修改名称和备注</button>
      {editing && (
        <div className="mt-4 space-y-3 rounded-lg bg-surface-2 p-4">
          {error && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}
          <input value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" />
          <textarea value={note} maxLength={500} rows={3} onChange={(event) => setNote(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="给这个账号写点备注" />
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
      <h2 className="text-lg font-semibold text-ink-primary">添加新的游戏账号</h2>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">输入未使用的 CDK。添加后，这个游戏账号会单独保存干员数据和排班设置。</p>
      {error && <div className="mt-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
      <label className="mt-5 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK</span>
        <input value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink-primary" required />
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">账号名称</span>
        <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="例如：主号" />
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">备注</span>
        <textarea value={note} onChange={(event) => setNote(event.currentTarget.value)} rows={4} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="可以写区服、用途等说明。请不要填写游戏密码。" />
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
        <p className="text-sm text-ink-secondary">这里会显示近期通知，读过的内容会自动留在公告列表中方便回看。</p>
        <button type="button" onClick={() => void markRead()} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">全部设为已读</button>
      </div>
      {loading && <p className="text-sm text-ink-secondary">正在加载公告...</p>}
      {error && <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
      {!loading && items.length === 0 && <div className="rounded-xl border border-surface-3 bg-surface-1 p-6 text-sm text-ink-secondary">暂时没有新的公告。</div>}
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
            {!read_at && <button type="button" onClick={() => void markRead(announcement.id)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">我知道了</button>}
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    const oldPasswordError = validatePasswordInput(oldPassword)
    const newPasswordError = validatePasswordInput(newPassword)
    if (oldPasswordError) nextErrors.oldPassword = oldPasswordError
    if (newPasswordError) nextErrors.newPassword = newPasswordError
    if (!confirmPassword) nextErrors.confirmPassword = '请再次输入新密码'
    else if (newPassword && newPassword !== confirmPassword) nextErrors.confirmPassword = '两次输入的新密码不一致'
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
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

  const clearFieldError = (field: string) => {
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-xl rounded-xl border border-surface-3 bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-ink-primary">修改登录密码</h2>
      {error && <div className="mt-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
      {status && <div className="mt-5 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{status}</div>}
      <label className="mt-5 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">当前密码</span>
        <input
          id="settings-old-password"
          type="password"
          value={oldPassword}
          onChange={(event) => {
            setOldPassword(event.currentTarget.value)
            clearFieldError('oldPassword')
          }}
          onFocus={() => clearFieldError('oldPassword')}
          className={inputClassName(Boolean(fieldErrors.oldPassword))}
          aria-invalid={Boolean(fieldErrors.oldPassword)}
          aria-describedby={fieldErrors.oldPassword ? 'settings-old-password-error' : undefined}
        />
        {fieldErrors.oldPassword && <p id="settings-old-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.oldPassword}</p>}
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">新密码</span>
        <input
          id="settings-new-password"
          type="password"
          value={newPassword}
          onChange={(event) => {
            setNewPassword(event.currentTarget.value)
            clearFieldError('newPassword')
            clearFieldError('confirmPassword')
          }}
          onFocus={() => clearFieldError('newPassword')}
          className={inputClassName(Boolean(fieldErrors.newPassword))}
          aria-invalid={Boolean(fieldErrors.newPassword)}
          aria-describedby={fieldErrors.newPassword ? 'settings-new-password-error' : undefined}
        />
        {fieldErrors.newPassword && <p id="settings-new-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.newPassword}</p>}
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">确认新密码</span>
        <input
          id="settings-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => {
            setConfirmPassword(event.currentTarget.value)
            clearFieldError('confirmPassword')
          }}
          onFocus={() => clearFieldError('confirmPassword')}
          className={inputClassName(Boolean(fieldErrors.confirmPassword))}
          aria-invalid={Boolean(fieldErrors.confirmPassword)}
          aria-describedby={fieldErrors.confirmPassword ? 'settings-confirm-password-error' : undefined}
        />
        {fieldErrors.confirmPassword && <p id="settings-confirm-password-error" className="mt-1.5 text-sm text-error">{fieldErrors.confirmPassword}</p>}
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
  onSynced,
  onBack,
  onLogout,
}: {
  user: AuthUser
  profile: UserGameAccount
  workspace: UserWorkspace | null
  announcement: Announcement | null
  onSaved: (payload: AuthSuccessResponse) => void
  onSynced: (payload: AuthSuccessResponse) => void
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
  const [sklandLogin, setSklandLogin] = useState<SklandLoginState>({
    open: false,
    mode: 'scan',
    scanId: null,
    qrDataUrl: null,
    expiresAt: null,
    confirmationId: null,
    preview: null,
    status: 'idle',
    message: null,
  })
  const [sklandBusy, setSklandBusy] = useState(false)
  const sklandPollCountRef = useRef(0)
  const sklandStartRequestRef = useRef(0)
  const sklandCredentialInputRef = useRef<HTMLTextAreaElement | null>(null)

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
  const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])
  const canEditConfig = profile.permission === 'advanced' || profile.permission === 'ultimate' || profile.permission === 'admin'
  const canEditLimitedConfig = profile.permission === 'recommended' || profile.permission === 'growth'
  const ownedOperatorCount = useMemo(() => countOwnedOperators(operators), [operators])
  const configChanged = workspace?.config ? canonicalJson(normalizedConfig) !== canonicalJson(workspace.config) : true
  const filteredOperators = useMemo(() => {
    const keyword = operatorSearch.trim().toLowerCase()
    const source = sortOperatorsForPreview((operators ?? []).filter((operator) => operator.own !== false))
    return keyword ? source.filter((operator) => operator.name.toLowerCase().includes(keyword)) : source
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

  const applySklandPayload = useCallback((data: SklandPayload) => {
    if (!data.user) return
    const nextOperators = data.workspace?.operators ?? null
    setOperators(nextOperators)
    setOperatorFileName(null)
    setError(null)
    onSynced(data)
  }, [onSynced])

  const completeSklandLogin = useCallback(async (scanId: string) => {
    if (sklandBusy) return
    setSklandBusy(true)
    setSklandLogin((current) => ({
      ...current,
      status: 'waiting',
      message: '正在检查扫码状态，请在森空岛 App 中确认扫码...',
    }))
    try {
      const resp = await fetch('/api/user/skland/login/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id, scan_id: scanId }),
      })
      const data = await resp.json() as SklandPayload
      if (resp.status === 202 || data.status === 'pending') {
        setSklandLogin((current) => ({ ...current, status: 'waiting', message: '等待森空岛 App 确认扫码...' }))
        return
      }
      if (!resp.ok) throw new Error(data.error || `森空岛导入失败: ${resp.status}`)
      if (data.status === 'confirm_required' && data.confirmation_id && data.skland_preview) {
        setSklandLogin((current) => ({
          ...current,
          qrDataUrl: null,
          confirmationId: data.confirmation_id ?? null,
          preview: data.skland_preview ?? null,
          status: 'confirm_required',
          message: data.warning || '请确认森空岛账号信息，确认后将导入干员数据。',
        }))
        return
      }
      if (data.status === 'account_mismatch' && data.skland_preview) {
        setSklandLogin((current) => ({
          ...current,
          qrDataUrl: null,
          confirmationId: null,
          preview: data.skland_preview ?? null,
          status: 'account_mismatch',
          message: data.warning || '该账号与当前绑定账号不一致，请确认是否扫错账号。',
        }))
        return
      }
      if (data.status === 'frozen') {
        if (data.user) onSynced(data)
        setSklandLogin((current) => ({
          ...current,
          qrDataUrl: null,
          confirmationId: null,
          preview: null,
          status: 'frozen',
          message: data.warning || '当前游戏账号档案已冻结。',
        }))
        return
      }
      if (!data.user) throw new Error(data.error || `森空岛导入失败: ${resp.status}`)
      setSklandLogin((current) => ({
        ...current,
        status: 'importing',
        message: '扫码已确认，正在导入森空岛干员数据...',
      }))
      applySklandPayload(data)
      setSklandLogin((current) => ({
        ...current,
        status: 'imported',
        message: data.skland_import
          ? `已导入 ${data.skland_import.operator_count} 名干员：${data.skland_import.nickname}`
          : '森空岛干员数据已导入。',
      }))
    } catch (caught) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: (caught as Error).message }))
    } finally {
      setSklandBusy(false)
    }
  }, [applySklandPayload, onSynced, profile.id, sklandBusy])

  const handleStartSklandLogin = useCallback(async () => {
    const requestId = sklandStartRequestRef.current + 1
    sklandStartRequestRef.current = requestId
    setSklandBusy(true)
    setError(null)
    setSklandLogin({
      open: true,
      mode: 'scan',
      scanId: null,
      qrDataUrl: null,
      expiresAt: null,
      confirmationId: null,
      preview: null,
      status: 'starting',
      message: '正在生成鹰角扫码登录二维码...',
    })
    try {
      const resp = await fetch('/api/user/skland/login/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id }),
      })
      const data = await resp.json() as { scan_id?: string; qr_data_url?: string; expires_at?: string; error?: string }
      if (!resp.ok || !data.scan_id || !data.qr_data_url) throw new Error(data.error || `生成森空岛二维码失败: ${resp.status}`)
      if (sklandStartRequestRef.current !== requestId) return
      setSklandLogin({
        open: true,
        mode: 'scan',
        scanId: data.scan_id,
        qrDataUrl: data.qr_data_url,
        expiresAt: data.expires_at ?? null,
        confirmationId: null,
        preview: null,
        status: 'waiting',
        message: '请使用森空岛 App 扫码确认，二维码约 2 分钟内有效。',
      })
      sklandPollCountRef.current = 0
    } catch (caught) {
      if (sklandStartRequestRef.current !== requestId) return
      setSklandLogin((current) => ({ ...current, status: 'error', message: (caught as Error).message }))
    } finally {
      if (sklandStartRequestRef.current === requestId) setSklandBusy(false)
    }
  }, [profile.id])

  const handlePreviewSklandCredential = useCallback(async (source: 'manual' | 'bookmarklet') => {
    const credentialText = sklandCredentialInputRef.current?.value.trim() ?? ''
    if (!credentialText) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: '请先粘贴森空岛凭据。' }))
      return
    }
    setSklandBusy(true)
    setError(null)
    setSklandLogin((current) => ({ ...current, status: 'starting', message: '正在读取森空岛账号信息...' }))
    try {
      const resp = await fetch('/api/user/skland/credential/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id, credential_text: credentialText, source }),
      })
      const data = await resp.json() as SklandPayload
      if (!resp.ok) throw new Error(data.error || `森空岛凭据读取失败: ${resp.status}`)
      if (sklandCredentialInputRef.current) sklandCredentialInputRef.current.value = ''
      if (data.status === 'account_mismatch') {
        setSklandLogin((current) => ({
          ...current,
          confirmationId: null,
          preview: data.skland_preview ?? null,
          status: 'account_mismatch',
          message: data.warning || '该账号与当前绑定账号不一致，请确认是否登录错账号。',
        }))
        return
      }
      if (data.status === 'frozen') {
        if (data.user) onSynced(data)
        setSklandLogin((current) => ({
          ...current,
          confirmationId: null,
          preview: data.skland_preview ?? null,
          status: 'frozen',
          message: data.warning || '当前游戏账号档案已冻结。',
        }))
        return
      }
      if (data.status !== 'confirm_required' || !data.confirmation_id || !data.skland_preview) {
        throw new Error(data.error || '森空岛凭据已读取，但未返回可确认账号。')
      }
      setSklandLogin((current) => ({
        ...current,
        confirmationId: data.confirmation_id ?? null,
        preview: data.skland_preview ?? null,
        status: 'confirm_required',
        message: data.warning || '请确认森空岛账号信息，确认后将导入干员数据。',
      }))
    } catch (caught) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: (caught as Error).message }))
    } finally {
      setSklandBusy(false)
    }
  }, [onSynced, profile.id])

  const handleRefreshSkland = useCallback(async () => {
    setSklandBusy(true)
    setError(null)
    try {
      const resp = await fetch('/api/user/skland/import/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id }),
      })
      const data = await resp.json() as SklandPayload
      if (!resp.ok || !data.user) throw new Error(data.error || `森空岛刷新失败: ${resp.status}`)
      applySklandPayload(data)
      setSklandLogin({
        open: true,
        mode: 'scan',
        scanId: null,
        qrDataUrl: null,
        expiresAt: null,
        confirmationId: null,
        preview: null,
        status: 'imported',
        message: data.skland_import
          ? `已刷新 ${data.skland_import.operator_count} 名干员：${data.skland_import.nickname}`
          : '森空岛干员数据已刷新。',
      })
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSklandBusy(false)
    }
  }, [applySklandPayload, profile.id])

  const handleConfirmSklandLogin = useCallback(async () => {
    if (!sklandLogin.confirmationId) return
    setSklandBusy(true)
    setSklandLogin((current) => ({ ...current, status: 'importing', message: '正在导入森空岛干员数据...' }))
    try {
      const resp = await fetch('/api/user/skland/login/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id, confirmation_id: sklandLogin.confirmationId }),
      })
      const data = await resp.json() as SklandPayload
      if (!resp.ok || !data.user) throw new Error(data.error || `森空岛导入失败: ${resp.status}`)
      applySklandPayload(data)
      setSklandLogin((current) => ({
        ...current,
        confirmationId: null,
        preview: null,
        status: 'imported',
        message: data.skland_import
          ? `已导入 ${data.skland_import.operator_count} 名干员：${data.skland_import.nickname}`
          : '森空岛干员数据已导入。',
      }))
    } catch (caught) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: (caught as Error).message }))
    } finally {
      setSklandBusy(false)
    }
  }, [applySklandPayload, profile.id, sklandLogin.confirmationId])

  const handleCloseSklandLogin = useCallback(() => {
    sklandStartRequestRef.current += 1
    setSklandBusy(false)
    setSklandLogin((current) => ({ ...current, open: false }))
  }, [])

  const handleSelectSklandLoginMode = useCallback((mode: SklandLoginState['mode']) => {
    if (mode === 'password') return
    sklandStartRequestRef.current += 1
    setSklandBusy(false)
    setSklandLogin((current) => {
      const keepWaitingScan = mode === 'scan' && current.status === 'waiting' && Boolean(current.scanId && current.qrDataUrl)
      return {
        ...current,
        mode,
        scanId: keepWaitingScan ? current.scanId : null,
        qrDataUrl: keepWaitingScan ? current.qrDataUrl : null,
        expiresAt: keepWaitingScan ? current.expiresAt : null,
        confirmationId: null,
        preview: null,
        status: keepWaitingScan ? 'waiting' : 'idle',
        message: mode === 'scan'
          ? keepWaitingScan
            ? current.message
            : '点击生成二维码后，使用森空岛 App 扫码确认。'
          : mode === 'manual'
            ? '粘贴森空岛凭据后读取账号信息。'
            : '复制书签脚本，在森空岛网页点击后回到这里粘贴。',
      }
    })
  }, [])

  useEffect(() => {
    if (!sklandLogin.open || sklandLogin.mode !== 'scan' || !sklandLogin.scanId || sklandLogin.status !== 'waiting') return
    if (sklandLogin.expiresAt && Date.now() > Date.parse(sklandLogin.expiresAt)) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: '二维码已过期，请重新生成。' }))
      return
    }
    if (sklandPollCountRef.current >= SKLAND_SCAN_MAX_POLLS) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: '扫码等待超时，请重新生成二维码后再试。',
      }))
      return
    }
    const timer = window.setTimeout(() => {
      if (!sklandLogin.scanId) return
      sklandPollCountRef.current += 1
      void completeSklandLogin(sklandLogin.scanId)
    }, SKLAND_SCAN_POLL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [completeSklandLogin, sklandLogin.expiresAt, sklandLogin.mode, sklandLogin.open, sklandLogin.scanId, sklandLogin.status])

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!operators) {
      setError('请先上传干员识别文件。')
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
        <div className="flex items-start gap-3 px-2">
          <BrandLogo size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-500">MAA Workspace</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
            <p className="mt-3 truncate text-sm font-medium text-ink-primary">{profile.display_name}</p>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          {setupSections.map((section) => (
            <button key={section.id} type="button" onClick={() => setActiveSection(section.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${activeSection === section.id ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}>
              <span>{section.label}</span>
              <span className={`h-2 w-2 rounded-full ${section.ready ? 'bg-success' : 'bg-surface-4'}`} />
            </button>
          ))}
        </nav>
        <button type="button" onClick={onBack} className="absolute bottom-16 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">返回账号列表</button>
        <button type="button" onClick={onLogout} className="absolute bottom-5 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">退出登录</button>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-surface-3 bg-surface-0/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <BrandLogo size="sm" className="lg:hidden" />
            <div className="min-w-0">
            <p className="text-sm font-medium text-brand-400">{profile.display_name}</p>
            <h1 className="mt-1 text-xl font-semibold text-ink-primary">准备账号工作区</h1>
            <p className="mt-1 text-sm text-ink-muted">上传干员识别文件并确认基建配置，保存后进入排班优化。</p>
            </div>
          </div>
            <div className="flex gap-2">
              <button type="button" onClick={onBack} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">返回账号列表</button>
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
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">上传 MAA 导出的干员识别文件，并在保存前预览头像、精英化和等级。</p>
                    </div>
                    {operators && <span className="rounded-md bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">已就绪</span>}
                  </div>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">
                    {operatorFileName ? `已选择：${operatorFileName}` : operators ? `已载入 ${ownedOperatorCount} 名拥有干员` : '选择干员识别文件'}
                      <input type="file" accept=".json,.txt,application/json,text/plain" onChange={handleOperatorsFile} className="hidden" />
                    </label>
                    {operators && <span className="text-sm text-brand-400">拥有干员 {ownedOperatorCount} 名</span>}
                  </div>
                  <div className="mt-4 rounded-lg border border-surface-3 bg-surface-0 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-primary">森空岛扫码导入</p>
                        <p className="mt-1 text-sm leading-6 text-ink-secondary">
                          {profile.skland_binding
                            ? `已绑定 ${profile.skland_binding.nickname} (${profile.skland_binding.uid})，最近导入 ${formatDate(profile.skland_binding.last_imported_at)}。`
                    : '使用森空岛 App 扫码后先确认游戏昵称和 UID，确认绑定后不可解绑。'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={handleStartSklandLogin} disabled={sklandBusy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                          森空岛扫码导入
                        </button>
                        <button type="button" onClick={handleRefreshSkland} disabled={sklandBusy || !profile.skland_binding} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:bg-surface-2 disabled:text-ink-muted">
                          刷新森空岛数据
                        </button>
                      </div>
                    </div>
                  </div>
                  {operators && (
                    <div className="mt-5">
                      <input value={operatorSearch} onChange={(event) => setOperatorSearch(event.currentTarget.value)} className="mb-4 w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="搜索干员名称" />
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
                  canSelectPreset
                  changed={configChanged}
                  permission={profile.permission}
                  validation={configValidation}
                  onUpdate={updateConfig}
                  note="保存后，下次打开这个账号会自动带上这套配置。"
                />
              )}
            </div>

            <aside className="space-y-5">
              <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                <h2 className="text-base font-semibold text-ink-primary">准备情况</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <InfoRow label="套餐" value={PERMISSION_LABELS[profile.permission]} />
              <InfoRow label="干员" value={operators ? `${ownedOperatorCount} 名` : '还未上传'} />
                  <InfoRow label="已拥有" value={operators ? `${ownedOperatorCount} 名` : '-'} />
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-ink-muted">基建配置</dt>
                    <dd className={`font-medium ${configValidation.ok ? 'text-success' : 'text-error'}`}>{configValidation.ok ? (configChanged ? '已修改' : '已保存') : '请检查'}</dd>
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
 {sklandLogin.open && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6">
 <section className="w-full max-w-2xl rounded-xl border border-surface-3 bg-surface-1 p-5 shadow-2xl">
 <div className="flex items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-ink-primary">森空岛导入</h2>
 <p className="mt-1 text-sm leading-6 text-ink-secondary">先展示游戏昵称和 UID，确认无误后才会导入。</p>
 </div>
              <button type="button" onClick={handleCloseSklandLogin} className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
                关闭
              </button>
 </div>
 <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
 {(['scan', 'manual', 'bookmarklet', 'password'] as const).map((mode) => (
 <button
 key={mode}
 type="button"
                    onClick={() => handleSelectSklandLoginMode(mode)}
 disabled={mode === 'password'}
 className={'rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ' + (sklandLogin.mode === mode ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3')}
 >
 {mode === 'scan' ? '扫码登录' : mode === 'manual' ? '手动凭据' : mode === 'bookmarklet' ? '书签脚本' : '模拟登录'}
 </button>
 ))}
 </div>
<p className="mt-2 text-xs text-ink-muted">推荐使用扫码登录，无法扫码时可更换其他方式。</p>
 {sklandLogin.mode === 'manual' && (
 <div className="mt-5 space-y-3 rounded-lg border border-surface-3 bg-surface-0 p-4">
 <ol className="space-y-3 text-sm leading-6 text-ink-secondary">
 <li><span className="font-semibold text-ink-primary">1. 登录森空岛网页：</span>点击下方按钮打开森空岛官网，在网页中完成登录。</li>
 <li><span className="font-semibold text-ink-primary">2. 复制凭据：</span>登录后按 F12 打开开发者工具，切到 Console/控制台，执行下方一图流命令。</li>
 <li><span className="font-semibold text-ink-primary">3. 粘贴导入：</span>把剪贴板中的凭据粘贴到输入框，读取账号信息后再确认导入。</li>
 </ol>
 <div className="flex flex-wrap gap-2">
 <button type="button" onClick={() => window.open('https://www.skland.com/index', '_blank', 'noopener,noreferrer')} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
 打开森空岛官网
 </button>
 <button type="button" onClick={() => void navigator.clipboard?.writeText(SKLAND_CONSOLE_CODE)} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
 复制一图流命令
 </button>
 </div>
 <textarea
 readOnly
 value={SKLAND_CONSOLE_CODE}
 rows={3}
 className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-xs text-ink-secondary outline-none"
 />
 <textarea
 ref={sklandCredentialInputRef}
 rows={4}
 className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-sm text-ink-primary outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
 placeholder="粘贴森空岛凭据"
 />
 <button type="button" onClick={() => void handlePreviewSklandCredential('manual')} disabled={sklandBusy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
 读取账号信息
 </button>
 </div>
 )}
 {sklandLogin.mode === 'bookmarklet' && (
 <div className="mt-5 space-y-3 rounded-lg border border-surface-3 bg-surface-0 p-4">
 <p className="text-sm leading-6 text-ink-secondary">复制书签脚本保存为浏览器书签，在森空岛登录后点击书签，脚本会把经过编码的 SK_OAUTH_CRED_KEY 复制到剪贴板。</p>
 <textarea readOnly value={SKLAND_BOOKMARKLET} rows={4} className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-xs text-ink-secondary outline-none" />
 <div className="flex flex-wrap gap-2">
 <button type="button" onClick={() => void navigator.clipboard?.writeText(SKLAND_BOOKMARKLET)} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
 复制书签脚本
 </button>
 <button type="button" onClick={() => window.open('https://www.skland.com/index', '_blank', 'noopener,noreferrer')} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
 打开森空岛
 </button>
 </div>
 <textarea
 ref={sklandCredentialInputRef}
 rows={4}
 className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-sm text-ink-primary outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
 placeholder="粘贴书签脚本复制出的凭据"
 />
 <button type="button" onClick={() => void handlePreviewSklandCredential('bookmarklet')} disabled={sklandBusy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
 读取账号信息
 </button>
 </div>
 )}
 {sklandLogin.mode === 'password' && (
 <div className="mt-5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning">
推荐使用扫码登录，无法扫码时可更换其他方式。
 </div>
 )}
 <div className="mt-5 flex min-h-[260px] items-center justify-center rounded-lg border border-surface-3 bg-surface-0 p-4">
 {sklandLogin.mode === 'scan' && sklandLogin.qrDataUrl && sklandLogin.status === 'waiting' ? (
 <img src={sklandLogin.qrDataUrl} alt="森空岛扫码登录二维码" className="h-[240px] w-[240px] rounded-lg bg-white p-2" />
 ) : (sklandLogin.status === 'confirm_required' || sklandLogin.status === 'account_mismatch') && sklandLogin.preview ? (
 <div className="w-full space-y-3 text-sm">
 <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
 <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">待确认账号</p>
 <p className="mt-2 text-lg font-semibold text-ink-primary">{sklandLogin.preview.nickname}</p>
 <p className="mt-1 text-ink-secondary">UID {sklandLogin.preview.uid} · {sklandLogin.preview.channel_name}</p>
 <p className="mt-1 text-ink-secondary">可导入 {sklandLogin.preview.operator_count} 名干员</p>
 </div>
 {sklandLogin.status === 'confirm_required' ? (
 <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-warning">绑定后不可解绑，请确认账号无误。</p>
 ) : (
 <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-error">该账号与当前绑定账号不一致，请重新选择正确账号。</p>
 )}
 </div>
 ) : (
 <div className="space-y-3 text-center text-sm text-ink-secondary">
 <p>{sklandLogin.message || '请选择一种森空岛登录方式。'}</p>
 {sklandLogin.mode === 'scan' && sklandLogin.status !== 'waiting' && (
 <button type="button" onClick={handleStartSklandLogin} disabled={sklandBusy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
 生成扫码二维码
 </button>
 )}
 </div>
 )}
 </div>
 {sklandLogin.message && sklandLogin.status !== 'confirm_required' && (
 <p className={'mt-3 text-sm ' + (sklandLogin.status === 'error' || sklandLogin.status === 'account_mismatch' || sklandLogin.status === 'frozen' ? 'text-error' : 'text-ink-secondary')}>{sklandLogin.message}</p>
 )}
 <div className="mt-5 flex flex-wrap justify-end gap-2">
 {(sklandLogin.status === 'error' || sklandLogin.status === 'account_mismatch') && sklandLogin.mode === 'scan' && (
 <button type="button" onClick={handleStartSklandLogin} disabled={sklandBusy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
 重新生成
 </button>
 )}
 {sklandLogin.status === 'confirm_required' && (
 <button type="button" onClick={handleConfirmSklandLogin} disabled={sklandBusy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
 确认绑定并导入
 </button>
 )}
 {sklandLogin.status === 'waiting' && sklandLogin.scanId && (
 <button type="button" onClick={() => void completeSklandLogin(sklandLogin.scanId!)} disabled={sklandBusy} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3 disabled:text-ink-muted">
 立即检查
 </button>
 )}
            </div>
          </section>
        </div>
      )}
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

function countOwnedOperators(operators: LicenseOperator[] | null | undefined): number {
  return operators?.filter((operator) => operator.own !== false).length ?? 0
}

function sortOperatorsForPreview(operators: LicenseOperator[]): LicenseOperator[] {
  return [...operators].sort((left, right) => (
    numberValue(right.elite) - numberValue(left.elite)
    || numberValue(right.level) - numberValue(left.level)
    || left.name.localeCompare(right.name, 'zh-CN')
    || left.id.localeCompare(right.id)
  ))
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function normalizePermission(permission: PermissionMode): PermissionMode {
if (permission === 'recommended' || permission === 'growth' || permission === 'advanced' || permission === 'ultimate' || permission === 'admin') return permission
return 'growth'
}

function formatPreviewEfficiency(value: number): string {
if (!Number.isFinite(value)) return '-'
return `${value.toFixed(1)}%`
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

function validateEmailInput(value: string): string | null {
  const email = value.trim()
  if (!email) return '请输入邮箱'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '请输入正确的邮箱地址'
  return null
}

function validatePasswordInput(value: string): string | null {
  if (!value) return '请输入密码'
  if (value.length < 8) return '密码至少需要 8 位'
  return null
}

function inputClassName(hasError: boolean, extra = ''): string {
  const base = 'w-full rounded-lg border px-3 py-2 text-sm text-ink-primary outline-none transition-colors duration-150 focus:ring-2'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : 'border-surface-4 bg-surface-0 focus:border-brand-500 focus:ring-brand-500/20'
  return `${base} ${state} ${extra}`.trim()
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
