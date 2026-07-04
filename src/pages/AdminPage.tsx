import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Announcement, AnnouncementAdminResponse, AnnouncementKind, ProductPermissionMode, RawPermissionMode } from '../lib/types'

type Permission = RawPermissionMode
type GeneratedPermission = ProductPermissionMode
type CdkStatus = 'unused' | 'used' | 'frozen' | 'revoked'
type AppUserStatus = 'active' | 'frozen' | 'revoked'
type StatusFilter = CdkStatus | 'all'
type AdminSection = 'overview' | 'cdk' | 'risk' | 'announcement' | 'users'
type FieldErrors = Record<string, string>

interface AdminCdkRecord {
  code_hash: string;
  cdk_id: string;
  permission: Permission;
  status: CdkStatus;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
  frozen_at?: string | null;
  freeze_reason?: string | null;
  schedule_generate_count?: number;
  order_note: string | null;
  license_order_hash: string | null;
  operator_count: number | null;
  config_desc: string | null;
  operator_update_grant_count?: number;
  operator_update_used_count?: number;
  operator_update_grant_remaining?: number;
  operator_update_event_count?: number;
  activation_bound?: boolean;
  user_agent_count?: number;
  ip_prefix_count?: number;
  risk_event_count?: number;
  latest_risk_event?: { at: string; type: string; reason: string } | null;
}

interface UsageTotals {
  unique_visitors: number;
  visits: number;
  schedule_generates: number;
  cdk_redeems: number;
}

interface UsageDay extends UsageTotals {
  date: string;
}

interface AdminUserSummary {
  username: string;
  created_at: string;
  updated_at: string;
}

interface AppUserSummary {
  id: string;
  email: string;
  status: AppUserStatus;
  profile_count: number;
  created_at: string;
  updated_at: string;
}

const EMPTY_ANNOUNCEMENTS: Announcement[] = []

const permissionLabels: Record<Permission, string> = {
recommended: '单次重置卡',
growth: '练度提升卡',
advanced: '单账号终身卡',
ultimate: 'Admin卡',
basic: '练度提升卡',
premium: '单账号终身卡',
admin: 'Admin卡',
}

const statusLabels: Record<CdkStatus, string> = {
  unused: '未使用',
  used: '已使用',
  frozen: '已冻结',
  revoked: '已撤销',
}

const appUserStatusLabels: Record<AppUserStatus, string> = {
  active: '正常',
  frozen: '已冻结',
  revoked: '已撤销',
}

const sectionLabels: Record<AdminSection, string> = {
  overview: '总览',
  cdk: 'CDK',
  risk: '风控',
  announcement: '公告管理',
  users: '用户维护',
}

const cdkProductPermissions: GeneratedPermission[] = ['recommended', 'growth', 'advanced', 'ultimate']
const cdkProductPermissionRank: Record<GeneratedPermission, number> = {
  recommended: 0,
  growth: 1,
  advanced: 2,
  ultimate: 3,
}

export default function AdminPage() {
  const [credentials, setCredentials] = useState(() => readStoredCredentials())
  const [loginUser, setLoginUser] = useState(credentials?.user ?? '')
  const [loginPassword, setLoginPassword] = useState(credentials?.password ?? '')
  const [authenticated, setAuthenticated] = useState(Boolean(credentials))
  const [activeSection, setActiveSection] = useState<AdminSection>('overview')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [records, setRecords] = useState<AdminCdkRecord[]>([])
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [appUsers, setAppUsers] = useState<AppUserSummary[]>([])
  const [usageStats, setUsageStats] = useState<{ totals: UsageTotals; days: UsageDay[] } | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>(EMPTY_ANNOUNCEMENTS)
  const [permission, setPermission] = useState<GeneratedPermission>('growth')
  const [orderNote, setOrderNote] = useState('')
  const [generatedCode, setGeneratedCode] = useState<{ code: string; permission: GeneratedPermission; created_at: string } | null>(null)
  const [selectedCdkHashes, setSelectedCdkHashes] = useState<string[]>([])
  const [resetUserEmail, setResetUserEmail] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [loginFieldErrors, setLoginFieldErrors] = useState<FieldErrors>({})
  const [resetFieldErrors, setResetFieldErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const authHeaders = useMemo<Record<string, string>>(() => {
    if (!credentials) return {} as Record<string, string>
    return {
      'X-Admin-User': credentials.user,
      'X-Admin-Password': credentials.password,
    }
  }, [credentials])

const summary = useMemo(
() => buildSummary(records, usageStats?.totals, usageStats?.days ?? [], users.length),
[records, usageStats, users.length],
)
  const visibleRecords = useMemo(
    () => records.filter((record) => statusFilter === 'all' || record.status === statusFilter),
    [records, statusFilter],
  )
  const riskRecords = useMemo(
    () => records.filter((record) => record.status === 'frozen' || (record.risk_event_count ?? 0) > 0),
    [records],
  )
  const selectedRecords = useMemo(() => {
    const selected = new Set(selectedCdkHashes)
    return records.filter((record) => selected.has(record.code_hash))
  }, [records, selectedCdkHashes])

  const loadDashboard = useCallback(async (nextCredentials = credentials) => {
    if (!nextCredentials) return
    setLoading(true)
    setError(null)
    try {
      const headers = {
        'X-Admin-User': nextCredentials.user,
        'X-Admin-Password': nextCredentials.password,
      }
      const [cdkResp, usageResp, announcementResp, usersResp] = await Promise.all([
        fetch('/api/admin/cdk?status=all', { headers }),
        fetch('/api/admin/usage-stats', { headers }),
        fetch('/api/admin/announcement', { headers }),
        fetch('/api/admin/users', { headers }),
      ])
      const cdkData = await readJson<{ error?: string; cdks?: AdminCdkRecord[] }>(cdkResp)
      const usageData = await readJson<{ error?: string; totals?: UsageTotals; days?: UsageDay[] }>(usageResp)
      const announcementData = await readJson<Partial<AnnouncementAdminResponse> & { error?: string }>(announcementResp)
      const usersData = await readJson<{ error?: string; users?: AdminUserSummary[]; app_users?: AppUserSummary[] }>(usersResp)
      if (!cdkResp.ok) throw new Error(cdkData.error || `加载 CDK 失败: ${cdkResp.status}`)
      if (!usageResp.ok) throw new Error(usageData.error || `加载统计失败: ${usageResp.status}`)
      if (!announcementResp.ok) throw new Error(announcementData.error || `加载公告失败: ${announcementResp.status}`)
      if (!usersResp.ok) throw new Error(usersData.error || `加载账号失败: ${usersResp.status}`)
      setRecords(cdkData.cdks ?? [])
      setUsageStats({
        totals: normalizeUsageTotals(usageData.totals),
        days: Array.isArray(usageData.days) ? usageData.days.map(normalizeUsageDay) : [],
      })
      setAnnouncements(normalizeAnnouncementList(announcementData.announcements))
      setUsers(usersData.users ?? [])
      setAppUsers(usersData.app_users ?? [])
      setAuthenticated(true)
    } catch (caught) {
      setError((caught as Error).message)
      setAuthenticated(false)
      clearStoredCredentials()
      setCredentials(null)
    } finally {
      setLoading(false)
    }
  }, [credentials])

  useEffect(() => {
    if (credentials) void loadDashboard(credentials)
  }, [])

  useEffect(() => {
    const available = new Set(records.map((record) => record.code_hash))
    setSelectedCdkHashes((current) => current.filter((hash) => available.has(hash)))
  }, [records])

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    if (!loginUser.trim()) nextErrors.loginUser = '请输入账号'
    if (!loginPassword) nextErrors.loginPassword = '请输入密码'
    setLoginFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    const next = { user: loginUser.trim(), password: loginPassword }
    setCredentials(next)
    storeCredentials(next)
    await loadDashboard(next)
  }

  const handleLogout = () => {
    clearStoredCredentials()
    setCredentials(null)
    setAuthenticated(false)
    setRecords([])
    setUsers([])
    setUsageStats(null)
  }

  const handleGenerateCdk = async (event: FormEvent) => {
    event.preventDefault()
    setBusyAction('generate')
    setError(null)
    setNotice(null)
    try {
      const resp = await fetch('/api/admin/cdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ admin_user: credentials?.user, admin_password: credentials?.password, permission, order_note: orderNote }),
      })
      const data = await readJson<{ error?: string; code?: string; permission?: GeneratedPermission; created_at?: string }>(resp)
      if (!resp.ok || !data.code || !data.permission || !data.created_at) {
        throw new Error(data.error || `生成失败: ${resp.status}`)
      }
      setGeneratedCode({ code: data.code, permission: data.permission, created_at: data.created_at })
      setOrderNote('')
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleSaveAnnouncement = async (event: FormEvent) => {
    event.preventDefault()
    setBusyAction('announcement')
    setError(null)
    setNotice(null)
    try {
      const resp = await fetch('/api/admin/announcement', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          admin_user: credentials?.user,
          admin_password: credentials?.password,
          announcements,
        }),
      })
      const data = await readJson<Partial<AnnouncementAdminResponse> & { error?: string }>(resp)
      if (!resp.ok) throw new Error(data.error || `保存公告失败: ${resp.status}`)
      setAnnouncements(normalizeAnnouncementList(data.announcements))
      setNotice('公告已保存')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const addAnnouncement = (kind: AnnouncementKind) => {
    setAnnouncements((current) => [createDraftAnnouncement(kind), ...current])
  }

  const updateAnnouncement = (id: string, patch: Partial<Pick<Announcement, 'kind' | 'active' | 'title' | 'body'>>) => {
    setAnnouncements((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const deleteAnnouncement = (id: string) => {
    setAnnouncements((current) => current.filter((item) => item.id !== id))
  }

  const patchCdk = async (record: AdminCdkRecord, action: string, nextPermission?: GeneratedPermission) => {
    setBusyAction(`${action}:${record.code_hash}`)
    setError(null)
    try {
      const resp = await fetch('/api/admin/cdk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          admin_user: credentials?.user,
          admin_password: credentials?.password,
          code_hash: record.code_hash,
          action,
          ...(nextPermission ? { permission: nextPermission } : {}),
        }),
      })
      const data = await readJson<{ error?: string }>(resp)
      if (!resp.ok) throw new Error(data.error || `操作失败: ${resp.status}`)
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const deleteCdk = async (record: AdminCdkRecord) => {
    if (record.status !== 'unused') return
    if (!window.confirm(`确认删除未使用 CDK ${record.cdk_id}？`)) return
    setBusyAction(`delete:${record.code_hash}`)
    setError(null)
    try {
      const resp = await fetch('/api/admin/cdk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ admin_user: credentials?.user, admin_password: credentials?.password, code_hash: record.code_hash }),
      })
      const data = await readJson<{ error?: string }>(resp)
      if (!resp.ok) throw new Error(data.error || `删除失败: ${resp.status}`)
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleBulkRevoke = async () => {
    const targets = selectedRecords.filter((record) => record.status === 'used' || record.status === 'frozen')
    if (targets.length === 0 || !window.confirm(`确认撤销 ${targets.length} 个授权？`)) return
    for (const record of targets) await patchCdk(record, 'revoke')
    setSelectedCdkHashes([])
  }

  const handleResetUserPassword = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    const emailError = validateEmailInput(resetUserEmail)
    const passwordError = validatePasswordInput(resetPassword)
    if (emailError) nextErrors.resetUserEmail = emailError
    if (passwordError) nextErrors.resetPassword = passwordError
    setResetFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setBusyAction('reset-password')
    setError(null)
    setNotice(null)
    try {
      const resp = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          admin_user: credentials?.user,
          admin_password: credentials?.password,
          action: 'reset_password',
          email: resetUserEmail,
          new_password: resetPassword,
        }),
      })
      const data = await readJson<{ error?: string; user?: { email: string } }>(resp)
      if (!resp.ok) throw new Error(data.error || `重置密码失败: ${resp.status}`)
      setNotice(`已重置 ${data.user?.email ?? resetUserEmail} 的密码`)
      setResetUserEmail('')
      setResetPassword('')
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const patchAppUser = async (
    user: AppUserSummary,
    action: 'freeze_account' | 'unfreeze_account' | 'delete_account',
    successMessage: string,
    extraBody: Record<string, unknown> = {},
  ) => {
    const busyKey = `app-user:${action}:${user.id}`
    setBusyAction(busyKey)
    setError(null)
    setNotice(null)
    try {
      const resp = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          admin_user: credentials?.user,
          admin_password: credentials?.password,
          action,
          user_id: user.id,
          ...extraBody,
        }),
      })
      const data = await readJson<{ error?: string }>(resp)
      if (!resp.ok) throw new Error(data.error || `${successMessage}失败: ${resp.status}`)
      setNotice(`${successMessage}：${user.email}`)
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleFreezeAppUser = async (user: AppUserSummary) => {
    if (!window.confirm(`确认冻结账号 ${user.email}？`)) return
    await patchAppUser(user, 'freeze_account', '已冻结账号')
  }

  const handleUnfreezeAppUser = async (user: AppUserSummary) => {
    await patchAppUser(user, 'unfreeze_account', '已解冻账号')
  }

  const handleDeleteAppUser = async (user: AppUserSummary) => {
    const confirmedEmail = window.prompt(`删除账号会清空 ${user.email} 的用户数据。请输入该邮箱确认删除。`)
    if (confirmedEmail === null) return
    if (confirmedEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      setNotice(null)
      setError('确认邮箱不匹配，已取消删除。')
      return
    }
    await patchAppUser(user, 'delete_account', '已删除账号', { confirm_email: confirmedEmail.trim() })
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-surface-0 px-6 py-10 text-ink-primary">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_380px]">
          <section>
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-brand-500">MAA Infrast Admin</p>
              <h1 className="mt-3 text-3xl font-semibold text-ink-primary sm:text-4xl">管理工作台</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-ink-secondary">
                使用独立管理账号进入后台。Root 口令只用于创建和维护管理账号，日常操作不再需要反复输入。
              </p>
            </div>
          </section>
        <form onSubmit={handleLogin} noValidate className="rounded-xl border border-surface-3 bg-surface-1 p-6">
          <h2 className="text-lg font-semibold text-ink-primary">账号登录</h2>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">账号</span>
            <input
              id="admin-login-user"
              value={loginUser}
              onChange={(event) => {
                setLoginUser(event.currentTarget.value)
                setLoginFieldErrors((current) => omitFieldError(current, 'loginUser'))
              }}
              onFocus={() => setLoginFieldErrors((current) => omitFieldError(current, 'loginUser'))}
              className={inputClassName(Boolean(loginFieldErrors.loginUser))}
              autoComplete="username"
              aria-invalid={Boolean(loginFieldErrors.loginUser)}
              aria-describedby={loginFieldErrors.loginUser ? 'admin-login-user-error' : undefined}
            />
            {loginFieldErrors.loginUser && <p id="admin-login-user-error" className="mt-1.5 text-sm text-error">{loginFieldErrors.loginUser}</p>}
          </label>
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">密码</span>
            <input
              id="admin-login-password"
              type="password"
              value={loginPassword}
              onChange={(event) => {
                setLoginPassword(event.currentTarget.value)
                setLoginFieldErrors((current) => omitFieldError(current, 'loginPassword'))
              }}
              onFocus={() => setLoginFieldErrors((current) => omitFieldError(current, 'loginPassword'))}
              className={inputClassName(Boolean(loginFieldErrors.loginPassword))}
              autoComplete="current-password"
              aria-invalid={Boolean(loginFieldErrors.loginPassword)}
              aria-describedby={loginFieldErrors.loginPassword ? 'admin-login-password-error' : undefined}
            />
            {loginFieldErrors.loginPassword && <p id="admin-login-password-error" className="mt-1.5 text-sm text-error">{loginFieldErrors.loginPassword}</p>}
          </label>
            {error && <div className="mt-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}
          <button type="submit" disabled={loading} className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
              {loading ? '正在登录...' : '进入后台'}
            </button>
            <a href="/admin/setup" className="mt-4 block text-center text-sm font-medium text-brand-500 underline-offset-4 hover:underline">添加管理账号</a>
          </form>
        </div>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-surface-3 bg-surface-1 px-4 py-5 lg:block">
        <div className="px-2">
          <p className="text-sm font-semibold text-brand-500">MAA Admin</p>
          <p className="mt-1 truncate text-xs text-ink-muted">{credentials?.user}</p>
        </div>
        <nav className="mt-8 space-y-1">
          {(Object.keys(sectionLabels) as AdminSection[]).map((section) => (
            <button key={section} type="button" onClick={() => setActiveSection(section)} className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${activeSection === section ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}>
              {sectionLabels[section]}
            </button>
          ))}
        </nav>
        <button type="button" onClick={handleLogout} className="absolute bottom-5 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">退出登录</button>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-surface-3 bg-surface-0/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-ink-primary">{sectionLabels[activeSection]}</h1>
              <p className="mt-1 text-sm text-ink-muted">最近同步 {loading ? '进行中' : formatDate(new Date().toISOString())}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void loadDashboard()} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">刷新数据</button>
              <a href="/admin/setup" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500">账号设置</a>
            </div>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {(Object.keys(sectionLabels) as AdminSection[]).map((section) => (
              <button key={section} type="button" onClick={() => setActiveSection(section)} className={`rounded-lg px-3 py-2 text-sm font-medium ${activeSection === section ? 'bg-brand-600 text-white' : 'bg-surface-1 text-ink-secondary'}`}>
                {sectionLabels[section]}
              </button>
            ))}
          </div>
        </header>

        <div className="px-5 py-6 sm:px-8">
          {error && <div className="mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
          {notice && <div className="mb-5 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{notice}</div>}

          {activeSection === 'overview' && (
            <section className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="CDK 总量" value={summary.totalCdks} />
                <Metric label="已兑换" value={summary.usedCdks} />
                <Metric label="冻结授权" value={summary.frozenCdks} tone={summary.frozenCdks > 0 ? 'warning' : 'default'} />
                <Metric label="7 日生成" value={summary.scheduleGenerates} />
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-ink-primary">7 日趋势</h2>
                    <span className="text-xs text-ink-muted">访问 / 生成 / 兑换</span>
                  </div>
<div className="mt-5 flex h-52 items-end gap-2 overflow-hidden">
{(usageStats?.days ?? []).length > 0
? (usageStats?.days ?? []).map((day) => <UsageBar key={day.date} day={day} max={summary.maxDailyActivity} />)
: <div className="flex h-full w-full items-center justify-center rounded-lg bg-surface-2 text-sm text-ink-muted">暂无趋势数据</div>}
</div>
                </section>
                <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                  <h2 className="text-base font-semibold text-ink-primary">运营摘要</h2>
                  <dl className="mt-4 space-y-3 text-sm">
                    <InfoRow label="独立访客" value={String(summary.uniqueVisitors)} />
                    <InfoRow label="访问次数" value={String(summary.visits)} />
                    <InfoRow label="兑换次数" value={String(summary.cdkRedeems)} />
                    <InfoRow label="管理账号" value={String(summary.adminUsers)} />
                    <InfoRow label="转化率" value={`${summary.redeemRate}%`} />
                  </dl>
                </section>
              </div>
            </section>
          )}

          {activeSection === 'cdk' && (
            <section className="space-y-5">
              <form onSubmit={handleGenerateCdk} className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                <div className="grid gap-4 lg:grid-cols-[220px_1fr_auto] lg:items-end">
                  <label>
                    <span className="mb-2 block text-sm font-medium text-ink-secondary">授权类型</span>
                    <select value={permission} onChange={(event) => setPermission(event.currentTarget.value as GeneratedPermission)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary">
                      {cdkProductPermissions.map((item) => <option key={item} value={item}>{permissionLabels[item]}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="mb-2 block text-sm font-medium text-ink-secondary">订单备注</span>
                    <input value={orderNote} maxLength={120} onChange={(event) => setOrderNote(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="闲鱼订单号、用户昵称或售后备注" />
                  </label>
                  <button type="submit" disabled={busyAction === 'generate'} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">{busyAction === 'generate' ? '生成中...' : '生成 CDK'}</button>
                </div>
                {generatedCode && (
                  <div className="mt-4 flex flex-col gap-3 rounded-lg bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-mono text-base font-semibold text-ink-primary">{generatedCode.code}</div>
                      <div className="mt-1 text-xs text-ink-muted">{permissionLabels[generatedCode.permission]} · {formatDate(generatedCode.created_at)}</div>
                    </div>
                    <button type="button" onClick={() => navigator.clipboard.writeText(generatedCode.code)} className="rounded-lg bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">复制 CDK</button>
                  </div>
                )}
              </form>
              <CdkTable
                records={visibleRecords}
                selected={selectedCdkHashes}
                filter={statusFilter}
                busyAction={busyAction}
                onFilter={setStatusFilter}
                onSelect={setSelectedCdkHashes}
                onBulkRevoke={handleBulkRevoke}
                onPatch={patchCdk}
                onDelete={deleteCdk}
              />
            </section>
          )}

          {activeSection === 'risk' && (
            <section className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="冻结授权" value={summary.frozenCdks} tone="warning" />
                <Metric label="风险记录" value={summary.riskEvents} />
                <Metric label="设备绑定" value={summary.boundDevices} />
              </div>
              <RiskTable records={riskRecords} busyAction={busyAction} onPatch={patchCdk} />
            </section>
          )}

        {activeSection === 'announcement' && (
          <form onSubmit={handleSaveAnnouncement} className="space-y-5">
            <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-ink-primary">横幅和弹出式公告</h2>
                  <p className="mt-1 text-sm text-ink-secondary">横幅显示在工具页内，弹出式公告会在用户首次未读时弹出。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => addAnnouncement('banner')} className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">新增横幅</button>
                  <button type="button" onClick={() => addAnnouncement('popup')} className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">新增弹出式公告</button>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {announcements.length === 0 && (
                  <div className="rounded-lg border border-dashed border-surface-4 bg-surface-0 px-4 py-6 text-sm text-ink-muted">
                    还没有公告。新增横幅或弹出式公告后保存即可生效。
                  </div>
                )}
                {announcements.map((item) => (
                  <article key={item.id} className="rounded-lg border border-surface-3 bg-surface-0 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={item.kind}
                          onChange={(event) => updateAnnouncement(item.id, { kind: event.currentTarget.value as AnnouncementKind })}
                          className="rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary"
                        >
                          <option value="banner">横幅</option>
                          <option value="popup">弹出式公告</option>
                        </select>
                        <label className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-secondary">
                          <input
                            type="checkbox"
                            checked={item.active}
                            onChange={(event) => updateAnnouncement(item.id, { active: event.currentTarget.checked })}
                            className="h-4 w-4 accent-brand-600"
                          />
                          启用
                        </label>
                      </div>
                      <button type="button" onClick={() => deleteAnnouncement(item.id)} className="rounded-lg bg-error/10 px-3 py-2 text-sm font-semibold text-error hover:bg-error/20">
                        删除
                      </button>
                    </div>

                    <label className="mt-4 block">
                      <span className="mb-2 block text-sm font-medium text-ink-secondary">标题</span>
                      <input
                        value={item.title}
                        maxLength={80}
                        onChange={(event) => updateAnnouncement(item.id, { title: event.currentTarget.value })}
                        className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary"
                      />
                    </label>
                    <label className="mt-4 block">
                      <span className="mb-2 block text-sm font-medium text-ink-secondary">正文</span>
                      <textarea
                        value={item.body}
                        maxLength={600}
                        rows={5}
                        onChange={(event) => updateAnnouncement(item.id, { body: event.currentTarget.value })}
                        className="w-full resize-y rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm leading-6 text-ink-primary"
                      />
                    </label>
                    <p className="mt-3 text-xs text-ink-muted">更新时间：{formatDate(item.updated_at)}</p>
                  </article>
                ))}
              </div>

              <button type="submit" disabled={busyAction === 'announcement'} className="mt-5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                {busyAction === 'announcement' ? '保存中...' : '保存公告'}
              </button>
            </section>
            </form>
          )}

          {activeSection === 'users' && (
            <section className="space-y-5">
            <form onSubmit={handleResetUserPassword} noValidate className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                <h2 className="text-lg font-semibold text-ink-primary">重置用户密码</h2>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">输入用户邮箱和新临时密码。保存后该用户现有登录会话会失效。</p>
                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_240px_auto] lg:items-end">
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">用户邮箱</span>
                  <input
                    id="admin-reset-email"
                    value={resetUserEmail}
                    onChange={(event) => {
                      setResetUserEmail(event.currentTarget.value)
                      setResetFieldErrors((current) => omitFieldError(current, 'resetUserEmail'))
                    }}
                    onFocus={() => setResetFieldErrors((current) => omitFieldError(current, 'resetUserEmail'))}
                    className={inputClassName(Boolean(resetFieldErrors.resetUserEmail))}
                    placeholder="user@example.com"
                    aria-invalid={Boolean(resetFieldErrors.resetUserEmail)}
                    aria-describedby={resetFieldErrors.resetUserEmail ? 'admin-reset-email-error' : undefined}
                  />
                  {resetFieldErrors.resetUserEmail && <p id="admin-reset-email-error" className="mt-1.5 text-sm text-error">{resetFieldErrors.resetUserEmail}</p>}
                </label>
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">新密码</span>
                  <input
                    id="admin-reset-password"
                    type="password"
                    value={resetPassword}
                    onChange={(event) => {
                      setResetPassword(event.currentTarget.value)
                      setResetFieldErrors((current) => omitFieldError(current, 'resetPassword'))
                    }}
                    onFocus={() => setResetFieldErrors((current) => omitFieldError(current, 'resetPassword'))}
                    className={inputClassName(Boolean(resetFieldErrors.resetPassword))}
                    aria-invalid={Boolean(resetFieldErrors.resetPassword)}
                    aria-describedby={resetFieldErrors.resetPassword ? 'admin-reset-password-error' : undefined}
                  />
                  {resetFieldErrors.resetPassword && <p id="admin-reset-password-error" className="mt-1.5 text-sm text-error">{resetFieldErrors.resetPassword}</p>}
                </label>
                <button type="submit" disabled={busyAction === 'reset-password'} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                    {busyAction === 'reset-password' ? '重置中...' : '重置密码'}
                  </button>
                </div>
              </form>

              <section className="rounded-xl border border-surface-3 bg-surface-1">
                <div className="border-b border-surface-3 p-4">
                  <h2 className="text-lg font-semibold text-ink-primary">注册用户</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
                      <tr>
                        <th className="px-4 py-3">邮箱</th>
                        <th className="px-4 py-3">状态</th>
                        <th className="px-4 py-3">档案</th>
                        <th className="px-4 py-3">时间</th>
                        <th className="px-4 py-3">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-3">
                      {appUsers.length === 0 ? (
                        <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-muted">暂无注册用户。</td></tr>
                      ) : appUsers.map((item) => (
                        <tr key={item.id} className="hover:bg-surface-2/50">
                          <td className="px-4 py-4 font-medium text-ink-primary">{item.email}</td>
                          <td className="px-4 py-4"><UserStatusPill status={item.status} /></td>
                          <td className="px-4 py-4 text-ink-secondary">{item.profile_count}</td>
                          <td className="px-4 py-4 text-xs text-ink-muted">{formatDate(item.updated_at)}</td>
                          <td className="px-4 py-4">
                            <div className="flex flex-wrap gap-2">
                              {item.status === 'active' && <SmallButton onClick={() => void handleFreezeAppUser(item)} loading={busyAction === `app-user:freeze_account:${item.id}`}>冻结</SmallButton>}
                              {item.status === 'frozen' && <SmallButton onClick={() => void handleUnfreezeAppUser(item)} loading={busyAction === `app-user:unfreeze_account:${item.id}`} tone="success">解冻</SmallButton>}
                              <SmallButton onClick={() => void handleDeleteAppUser(item)} loading={busyAction === `app-user:delete_account:${item.id}`} tone="danger">删除</SmallButton>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function CdkTable({ records, selected, filter, busyAction, onFilter, onSelect, onBulkRevoke, onPatch, onDelete }: {
  records: AdminCdkRecord[];
  selected: string[];
  filter: StatusFilter;
  busyAction: string | null;
  onFilter: (filter: StatusFilter) => void;
  onSelect: (hashes: string[]) => void;
  onBulkRevoke: () => void;
  onPatch: (record: AdminCdkRecord, action: string, nextPermission?: GeneratedPermission) => Promise<void>;
  onDelete: (record: AdminCdkRecord) => Promise<void>;
}) {
  const allSelected = records.length > 0 && records.every((record) => selected.includes(record.code_hash))
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1">
      <div className="flex flex-col gap-3 border-b border-surface-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {(['all', 'unused', 'used', 'frozen', 'revoked'] as StatusFilter[]).map((item) => (
            <button key={item} type="button" onClick={() => onFilter(item)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === item ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3'}`}>
              {item === 'all' ? '全部' : statusLabels[item]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onBulkRevoke} disabled={selected.length === 0} className="rounded-lg bg-error/10 px-3 py-2 text-sm font-semibold text-error hover:bg-error/20 disabled:bg-surface-2 disabled:text-ink-muted">批量撤销</button>
      </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] table-fixed text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="w-12 px-4 py-3"><input type="checkbox" checked={allSelected} onChange={(event) => onSelect(event.currentTarget.checked ? records.map((record) => record.code_hash) : [])} /></th>
                <th className="w-36 px-4 py-3">CDK</th>
                <th className="w-32 px-4 py-3">状态</th>
                <th className="w-56 px-4 py-3">数据</th>
                <th className="w-44 px-4 py-3">时间</th>
                <th className="w-48 px-4 py-3">备注</th>
                <th className="w-64 px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
            {records.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-muted">当前筛选没有记录。</td></tr>
            ) : records.map((record) => {
              const nextPermission = getNextProductPermission(record.permission)
              return (
                <tr key={record.code_hash} className="hover:bg-surface-2/50">
                    <td className="px-4 py-4 align-top"><input type="checkbox" checked={selected.includes(record.code_hash)} onChange={(event) => onSelect(event.currentTarget.checked ? [...selected, record.code_hash] : selected.filter((hash) => hash !== record.code_hash))} /></td>
                    <td className="px-4 py-4 align-top font-mono text-ink-primary">{record.cdk_id}</td>
                    <td className="px-4 py-4 align-top"><StatusPill status={record.status} /><div className="mt-1 text-xs text-ink-muted">{permissionLabels[record.permission]}</div></td>
                    <td className="px-4 py-4 align-top text-ink-secondary">
                      <div>{record.operator_count ?? '-'} 干员 / 生成 {record.schedule_generate_count ?? 0}</div>
                      <div className="mt-1 text-xs text-ink-muted">终身更新 {record.operator_update_event_count ?? 0} / 风险 {record.risk_event_count ?? 0}</div>
                    </td>
                    <td className="px-4 py-4 align-top text-xs text-ink-secondary"><div>创建 {formatDate(record.created_at)}</div><div className="mt-1">使用 {formatDate(record.used_at)}</div></td>
                    <td className="px-4 py-4 align-top text-ink-secondary"><div className="truncate" title={record.order_note || undefined}>{record.order_note || '-'}</div></td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex min-w-0 flex-wrap gap-2">
                      {nextPermission && record.status !== 'frozen' && record.status !== 'revoked' && <SmallButton onClick={() => onPatch(record, 'upgrade', nextPermission)} loading={busyAction === `upgrade:${record.code_hash}`}>升级</SmallButton>}
                      {record.status === 'frozen' && <SmallButton onClick={() => onPatch(record, 'unfreeze')} loading={busyAction === `unfreeze:${record.code_hash}`} tone="success">解冻</SmallButton>}
                      {(record.status === 'used' || record.status === 'frozen') && <SmallButton onClick={() => onPatch(record, 'revoke')} loading={busyAction === `revoke:${record.code_hash}`} tone="danger">撤销</SmallButton>}
                      {record.status === 'unused' && <SmallButton onClick={() => onDelete(record)} loading={busyAction === `delete:${record.code_hash}`} tone="danger">删除</SmallButton>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RiskTable({ records, busyAction, onPatch }: { records: AdminCdkRecord[]; busyAction: string | null; onPatch: (record: AdminCdkRecord, action: string) => Promise<void> }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1">
      <div className="border-b border-surface-3 p-4">
        <h2 className="text-base font-semibold text-ink-primary">风险记录</h2>
      </div>
      <div className="divide-y divide-surface-3">
        {records.length === 0 ? <div className="p-8 text-center text-sm text-ink-muted">暂无风险记录。</div> : records.map((record) => (
          <div key={record.code_hash} className="grid gap-3 p-4 lg:grid-cols-[180px_1fr_auto] lg:items-center">
            <div><div className="font-mono text-sm text-ink-primary">{record.cdk_id}</div><StatusPill status={record.status} /></div>
            <div className="text-sm text-ink-secondary">
              <div>{record.freeze_reason || record.latest_risk_event?.reason || '记录了风控事件'}</div>
              <div className="mt-1 text-xs text-ink-muted">风险 {record.risk_event_count ?? 0} / UA {record.user_agent_count ?? 0} / IP {record.ip_prefix_count ?? 0} / 冻结 {formatDate(record.frozen_at ?? null)}</div>
            </div>
            {record.status === 'frozen' && <SmallButton onClick={() => onPatch(record, 'unfreeze')} loading={busyAction === `unfreeze:${record.code_hash}`} tone="success">解冻</SmallButton>}
          </div>
        ))}
      </div>
    </section>
  )
}

function Metric({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'warning' }) {
  return <div className={`rounded-xl border p-4 ${tone === 'warning' ? 'border-warning/30 bg-warning/10' : 'border-surface-3 bg-surface-1'}`}>
    <div className="text-2xl font-semibold text-ink-primary">{value}</div>
    <div className="mt-1 text-sm text-ink-muted">{label}</div>
  </div>
}

function UsageBar({ day, max }: { day: UsageDay; max: number }) {
const activity = day.visits + day.schedule_generates + day.cdk_redeems
const percentage = Math.round((activity / Math.max(1, max)) * 100)
const height = Math.min(100, Math.max(activity > 0 ? 8 : 0, percentage))
return <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
<div className="flex h-40 w-full items-end rounded-lg bg-surface-2 px-1">
<div className="w-full rounded-md bg-brand-500" style={{ height: `${height}%` }} title={`${day.date}: ${day.visits} 访问, ${day.schedule_generates} 生成, ${day.cdk_redeems} 兑换`} />
    </div>
    <div className="truncate text-xs text-ink-muted">{day.date.slice(5)}</div>
  </div>
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 border-b border-surface-3 pb-2 last:border-0"><dt className="text-ink-muted">{label}</dt><dd className="font-medium text-ink-primary">{value}</dd></div>
}

function StatusPill({ status }: { status: CdkStatus }) {
  const className = status === 'unused'
    ? 'bg-success/10 text-success'
    : status === 'frozen'
      ? 'bg-warning/10 text-warning'
      : status === 'revoked'
        ? 'bg-error/10 text-error'
        : 'bg-surface-3 text-ink-secondary'
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${className}`}>{statusLabels[status]}</span>
}

function UserStatusPill({ status }: { status: AppUserStatus }) {
  const className = status === 'active'
    ? 'bg-success/10 text-success'
    : status === 'frozen'
      ? 'bg-warning/10 text-warning'
      : 'bg-error/10 text-error'
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${className}`}>{appUserStatusLabels[status]}</span>
}

function SmallButton({ children, onClick, loading, tone = 'default' }: { children: string; onClick: () => void; loading?: boolean; tone?: 'default' | 'success' | 'danger' }) {
  const className = tone === 'danger'
    ? 'bg-error/10 text-error hover:bg-error/20'
    : tone === 'success'
      ? 'bg-success/10 text-success hover:bg-success/20'
      : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'
  return <button type="button" onClick={onClick} disabled={loading} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 disabled:bg-surface-3 disabled:text-ink-muted ${className}`}>{loading ? '处理中' : children}</button>
}

function buildSummary(records: AdminCdkRecord[], usage?: UsageTotals, days: UsageDay[] = [], adminUsers = 0) {
const totalCdks = records.length
const usedCdks = records.filter((record) => record.status === 'used').length
const frozenCdks = records.filter((record) => record.status === 'frozen').length
const riskEvents = records.reduce((sum, record) => sum + (record.risk_event_count ?? 0), 0)
const boundDevices = records.filter((record) => record.activation_bound).length
const maxDailyActivity = Math.max(1, ...days.map((day) => day.visits + day.schedule_generates + day.cdk_redeems))
  return {
    totalCdks,
    usedCdks,
    frozenCdks,
    riskEvents,
    boundDevices,
    adminUsers,
    uniqueVisitors: usage?.unique_visitors ?? 0,
    visits: usage?.visits ?? 0,
    scheduleGenerates: usage?.schedule_generates ?? 0,
    cdkRedeems: usage?.cdk_redeems ?? 0,
    redeemRate: usage?.visits ? Math.round(((usage?.cdk_redeems ?? 0) / usage.visits) * 1000) / 10 : 0,
    maxDailyActivity,
  }
}

function normalizeUsageTotals(value: Partial<UsageTotals> | undefined): UsageTotals {
  return {
    unique_visitors: normalizeCount(value?.unique_visitors),
    visits: normalizeCount(value?.visits),
    schedule_generates: normalizeCount(value?.schedule_generates),
    cdk_redeems: normalizeCount(value?.cdk_redeems),
  }
}

function normalizeUsageDay(day: Partial<UsageDay>): UsageDay {
  return { date: typeof day.date === 'string' ? day.date : '', ...normalizeUsageTotals(day) }
}

function normalizeCount(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function normalizeAnnouncementList(value: Announcement[] | null | undefined): Announcement[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Announcement => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' && item.id ? item.id : createDraftId(),
      kind: item.kind === 'banner' || item.kind === 'popup' ? item.kind : 'popup',
      active: item.active === true,
      title: typeof item.title === 'string' ? item.title : '',
      body: typeof item.body === 'string' ? item.body : '',
      created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString(),
      updated_at: typeof item.updated_at === 'string' ? item.updated_at : new Date().toISOString(),
    }))
}

function createDraftAnnouncement(kind: AnnouncementKind): Announcement {
  const now = new Date().toISOString()
  return {
    id: createDraftId(),
    kind,
    active: false,
    title: '',
    body: '',
    created_at: now,
    updated_at: now,
  }
}

function createDraftId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `draft_${crypto.randomUUID()}`
  return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
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

function omitFieldError(errors: FieldErrors, field: string): FieldErrors {
  if (!errors[field]) return errors
  const next = { ...errors }
  delete next[field]
  return next
}

function inputClassName(hasError: boolean): string {
  const base = 'w-full rounded-lg border px-3 py-2 text-sm text-ink-primary outline-none transition-colors duration-150 focus:ring-2'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : 'border-surface-4 bg-surface-0 focus:border-brand-500 focus:ring-brand-500/20'
  return `${base} ${state}`
}

function getNextProductPermission(permission: Permission): GeneratedPermission | null {
  const current = permission === 'basic' ? 'growth' : permission === 'premium' ? 'advanced' : cdkProductPermissions.includes(permission as GeneratedPermission) ? permission as GeneratedPermission : null
  if (!current) return null
  return cdkProductPermissions.find((item) => cdkProductPermissionRank[item] === cdkProductPermissionRank[current] + 1) ?? null
}

function readStoredCredentials(): { user: string; password: string } | null {
  try {
    const raw = window.sessionStorage.getItem('maa-admin-credentials')
    return raw ? JSON.parse(raw) as { user: string; password: string } : null
  } catch {
    return null
  }
}

function storeCredentials(credentials: { user: string; password: string }): void {
  window.sessionStorage.setItem('maa-admin-credentials', JSON.stringify(credentials))
}

function clearStoredCredentials(): void {
  window.sessionStorage.removeItem('maa-admin-credentials')
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text.trim()) {
    throw new Error(`接口返回为空，请确认后台函数路由已部署: ${response.status}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`接口返回格式异常，请确认后台函数路由已部署: ${response.status}`)
  }
}
