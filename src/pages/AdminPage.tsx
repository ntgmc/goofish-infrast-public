import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Announcement, ProductPermissionMode, RawPermissionMode } from '../lib/types'

type Permission = RawPermissionMode
type GeneratedPermission = ProductPermissionMode
type CdkStatus = 'unused' | 'used' | 'revoked'
type StatusFilter = CdkStatus | 'all'
type AdminSection = 'overview' | 'cdk' | 'announcement'

interface AdminCdkRecord {
  code_hash: string;
  cdk_id: string;
  permission: Permission;
  status: CdkStatus;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
  schedule_generate_count?: number;
  order_note: string | null;
  license_order_hash: string | null;
  operator_count: number | null;
  config_desc: string | null;
  operator_update_grant_count?: number;
  operator_update_used_count?: number;
  operator_update_grant_remaining?: number;
  operator_update_granted_at?: string | null;
  operator_update_consumed_at?: string | null;
}

interface CdkListResponse {
  error?: string;
  status?: StatusFilter;
  total?: number;
  cdks?: AdminCdkRecord[];
}

interface GenerateCdkResponse {
  error?: string;
  code?: string;
  permission?: GeneratedPermission;
  created_at?: string;
}

interface DeleteCdkResponse {
  error?: string;
  deleted?: boolean;
}

interface RevokeCdkResponse {
  error?: string;
  revoked?: boolean;
  already_revoked?: boolean;
}

interface UpgradeCdkResponse {
  error?: string;
  upgraded?: boolean;
  previous_permission?: GeneratedPermission;
  permission?: GeneratedPermission;
}

interface GrantOperatorUpdateResponse {
  error?: string;
  granted?: boolean;
  already_granted?: boolean;
  operator_update_grant_remaining?: number;
}

interface AnnouncementResponse extends Partial<Announcement> {
  error?: string;
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

interface UsageStatsResponse {
  error?: string;
  totals?: UsageTotals;
  days?: UsageDay[];
}

const EMPTY_ANNOUNCEMENT: Announcement = {
  enabled: false,
  title: '',
  body: '',
  updated_at: null,
}

const permissionLabels: Record<Permission, string> = {
  recommended: '推荐版',
  growth: '成长版',
  advanced: '进阶版',
  ultimate: '尊享版',
  basic: '成长版',
  premium: '进阶版',
  admin: 'Admin',
}
const cdkProductPermissions: GeneratedPermission[] = ['recommended', 'growth', 'advanced', 'ultimate']
const cdkProductPermissionRank: Record<GeneratedPermission, number> = {
  recommended: 0,
  growth: 1,
  advanced: 2,
  ultimate: 3,
}

const statusLabels: Record<CdkStatus, string> = {
  unused: '未使用',
  used: '已使用',
  revoked: '已撤销',
}

const statusFilterLabels: Record<StatusFilter, string> = {
  unused: '未使用',
  used: '已使用',
  revoked: '已撤销',
  all: '全部',
}

const adminSections: Array<{ id: AdminSection; label: string; description: string }> = [
  { id: 'overview', label: '概览统计', description: '访问、生成和兑换趋势' },
  { id: 'cdk', label: 'CDK 管理', description: '生成、筛选和处理授权' },
  { id: 'announcement', label: '公告设置', description: '维护工具页顶部公告' },
]

export default function AdminPage() {
  const [adminPassword, setAdminPassword] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [permission, setPermission] = useState<GeneratedPermission>('growth')
  const [orderNote, setOrderNote] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('unused')
  const [records, setRecords] = useState<AdminCdkRecord[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [deletingCdkHash, setDeletingCdkHash] = useState<string | null>(null)
  const [revokingCdkHash, setRevokingCdkHash] = useState<string | null>(null)
  const [upgradingCdkHash, setUpgradingCdkHash] = useState<string | null>(null)
  const [grantingOperatorUpdateHash, setGrantingOperatorUpdateHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [result, setResult] = useState<{ code: string; permission: GeneratedPermission; created_at: string } | null>(null)
  const [announcement, setAnnouncement] = useState<Announcement>(EMPTY_ANNOUNCEMENT)
  const [announcementLoading, setAnnouncementLoading] = useState(false)
  const [announcementSaving, setAnnouncementSaving] = useState(false)
  const [announcementStatus, setAnnouncementStatus] = useState<string | null>(null)
  const [usageStats, setUsageStats] = useState<{ totals: UsageTotals; days: UsageDay[] } | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [activeSection, setActiveSection] = useState<AdminSection>('overview')

  const summary = useMemo(() => {
    const unused = records.filter((record) => record.status === 'unused').length
    const used = records.filter((record) => record.status === 'used').length
    const revoked = records.filter((record) => record.status === 'revoked').length
    return { unused, used, revoked, total: records.length }
  }, [records])

  const loadCdkRecords = useCallback(async (password: string, filter: StatusFilter) => {
    setListLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/admin/cdk', {
        headers: {
          'X-Admin-Password': password,
          'X-Cdk-Status': filter,
        },
      }).catch(() => {
        throw new Error('无法连接后台接口。请用 npm.cmd run dev 启动本地 Netlify 函数服务，不要只用 vite preview 或直接打开静态页面。')
      })
      const data = await resp.json() as CdkListResponse
      if (!resp.ok) {
        throw new Error(data.error || `加载失败: ${resp.status}`)
      }
      setRecords(data.cdks ?? [])
      setAuthenticated(true)
    } catch (e) {
      setRecords([])
      throw e
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadAnnouncement = useCallback(async (password: string) => {
    setAnnouncementLoading(true)
    setAnnouncementStatus(null)
    try {
      const resp = await fetch('/api/admin/announcement', {
        headers: {
          'X-Admin-Password': password,
        },
      }).catch(() => {
        throw new Error('无法连接公告接口。请用 npm.cmd run dev 启动本地 Netlify 函数服务。')
      })
      const data = await resp.json() as AnnouncementResponse
      if (!resp.ok) {
        throw new Error(data.error || `加载公告失败: ${resp.status}`)
      }
      setAnnouncement(normalizeAnnouncementResponse(data))
    } finally {
      setAnnouncementLoading(false)
    }
  }, [])

  const loadUsageStats = useCallback(async (password: string) => {
    setUsageLoading(true)
    try {
      const resp = await fetch('/api/admin/usage-stats', {
        headers: {
          'X-Admin-Password': password,
        },
      }).catch(() => {
        throw new Error('无法连接统计接口。请用 npm.cmd run dev 启动本地 Netlify 函数服务。')
      })
      const data = await resp.json() as UsageStatsResponse
      if (!resp.ok) {
        throw new Error(data.error || `加载统计失败: ${resp.status}`)
      }
      setUsageStats(normalizeUsageStatsResponse(data))
    } finally {
      setUsageLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authenticated) return
    loadCdkRecords(adminPassword, statusFilter).catch((e) => {
      setError((e as Error).message)
      if ((e as Error).message.includes('口令')) {
        setAuthenticated(false)
      }
    })
  }, [authenticated, adminPassword, statusFilter, loadCdkRecords])

  useEffect(() => {
    if (!authenticated) return
    loadAnnouncement(adminPassword).catch((e) => {
      setError((e as Error).message)
      if ((e as Error).message.includes('口令')) {
        setAuthenticated(false)
      }
    })
  }, [authenticated, adminPassword, loadAnnouncement])

  useEffect(() => {
    if (!authenticated) return
    loadUsageStats(adminPassword).catch((e) => {
      setError((e as Error).message)
      if ((e as Error).message.includes('口令')) {
        setAuthenticated(false)
      }
    })
  }, [authenticated, adminPassword, loadUsageStats])

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setCopyStatus(null)
    setResult(null)
    try {
      await loadCdkRecords(adminPassword, statusFilter)
    } catch (e) {
      setError((e as Error).message)
      setAuthenticated(false)
    }
  }

  const handleGenerate = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setCopyStatus(null)
    setResult(null)
    setGenerateLoading(true)
    try {
      const resp = await fetch('/api/admin/cdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_password: adminPassword,
          permission,
          order_note: orderNote,
        }),
      })
      const data = await resp.json() as GenerateCdkResponse
      if (!resp.ok) {
        throw new Error(data.error || `生成失败: ${resp.status}`)
      }
      setResult({
        code: data.code!,
        permission: data.permission!,
        created_at: data.created_at!,
      })
      setOrderNote('')
      await loadCdkRecords(adminPassword, statusFilter)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerateLoading(false)
    }
  }

  const handleCopyCode = async () => {
    if (!result?.code) return
    setCopyStatus(null)
    try {
      await navigator.clipboard.writeText(result.code)
      setCopyStatus('已复制到剪贴板')
    } catch {
      setCopyStatus('复制失败，请手动选择 CDK')
    }
  }

  const handleSaveAnnouncement = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setAnnouncementStatus(null)
    setAnnouncementSaving(true)
    try {
      const resp = await fetch('/api/admin/announcement', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_password: adminPassword,
          enabled: announcement.enabled,
          title: announcement.title,
          body: announcement.body,
        }),
      })
      const data = await resp.json() as AnnouncementResponse
      if (!resp.ok) {
        throw new Error(data.error || `保存公告失败: ${resp.status}`)
      }
      setAnnouncement(normalizeAnnouncementResponse(data))
      setAnnouncementStatus('公告已保存')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAnnouncementSaving(false)
    }
  }

  const handleRefreshDashboard = async () => {
    setError(null)
    const results = await Promise.allSettled([
      loadCdkRecords(adminPassword, statusFilter),
      loadAnnouncement(adminPassword),
      loadUsageStats(adminPassword),
    ])
    const rejected = results.find((result) => result.status === 'rejected')
    if (rejected?.status === 'rejected') {
      setError((rejected.reason as Error).message)
    }
  }

  const handleDeleteRecord = async (record: AdminCdkRecord) => {
    if (record.status !== 'unused') return
    const confirmed = window.confirm(`确认删除未使用 CDK ${record.cdk_id}？此操作不可恢复。`)
    if (!confirmed) return

    setError(null)
    setCopyStatus(null)
    setDeletingCdkHash(record.code_hash)
    try {
      const resp = await fetch('/api/admin/cdk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_password: adminPassword,
          code_hash: record.code_hash,
        }),
      })
      const data = await resp.json() as DeleteCdkResponse
      if (!resp.ok) {
        throw new Error(data.error || `删除失败: ${resp.status}`)
      }
      await loadCdkRecords(adminPassword, statusFilter)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeletingCdkHash(null)
    }
  }

  const handleRevokeRecord = async (record: AdminCdkRecord) => {
    if (record.status !== 'used') return
    const confirmed = window.confirm(`确认撤销授权 ${record.cdk_id}？撤销后不可恢复，用户将无法继续生成排班。`)
    if (!confirmed) return

    setError(null)
    setCopyStatus(null)
    setRevokingCdkHash(record.code_hash)
    try {
      const resp = await fetch('/api/admin/cdk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_password: adminPassword,
          code_hash: record.code_hash,
          action: 'revoke',
        }),
      })
      const data = await resp.json() as RevokeCdkResponse
      if (!resp.ok) {
        throw new Error(data.error || `撤销失败: ${resp.status}`)
      }
      await loadCdkRecords(adminPassword, statusFilter)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRevokingCdkHash(null)
    }
  }

  const handleUpgradeRecord = async (record: AdminCdkRecord) => {
    const currentPermission = normalizeProductPermission(record.permission)
    const nextPermission = getNextProductPermission(record.permission)
    if (!currentPermission || !nextPermission || record.status === 'revoked') return
    const confirmed = window.confirm(
      `确认将授权 ${record.cdk_id} 从 ${permissionLabels[currentPermission]} 升级到 ${permissionLabels[nextPermission]}？`
    )
    if (!confirmed) return

    setError(null)
    setCopyStatus(null)
    setUpgradingCdkHash(record.code_hash)
    try {
      const resp = await fetch('/api/admin/cdk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_password: adminPassword,
          code_hash: record.code_hash,
          action: 'upgrade',
          permission: nextPermission,
        }),
      })
      const data = await resp.json() as UpgradeCdkResponse
      if (!resp.ok) {
        throw new Error(data.error || `升级失败: ${resp.status}`)
      }
      await loadCdkRecords(adminPassword, statusFilter)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUpgradingCdkHash(null)
    }
  }

  const handleGrantOperatorUpdate = async (record: AdminCdkRecord) => {
    if (record.status !== 'used') return
    const confirmed = window.confirm(`确认给授权 ${record.cdk_id} 发放一次干员数据更新权限？用户同步授权后可替换一次 operators.json。`)
    if (!confirmed) return

    setError(null)
    setCopyStatus(null)
    setGrantingOperatorUpdateHash(record.code_hash)
    try {
      const resp = await fetch('/api/admin/cdk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_password: adminPassword,
          code_hash: record.code_hash,
          action: 'grant_operator_update',
        }),
      })
      const data = await resp.json() as GrantOperatorUpdateResponse
      if (!resp.ok) {
        throw new Error(data.error || `发放失败: ${resp.status}`)
      }
      await loadCdkRecords(adminPassword, statusFilter)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGrantingOperatorUpdateHash(null)
    }
  }

  const handleLogout = () => {
    setAuthenticated(false)
    setAdminPassword('')
    setRecords([])
    setResult(null)
    setError(null)
    setCopyStatus(null)
    setRevokingCdkHash(null)
    setUpgradingCdkHash(null)
    setAnnouncement(EMPTY_ANNOUNCEMENT)
    setAnnouncementStatus(null)
    setUsageStats(null)
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen px-6 py-10">
        <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center">
          <header className="mb-6">
            <a
              href="/"
              className="mb-6 inline-flex rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
            >
              返回首页
            </a>
            <h1 className="text-2xl font-bold text-ink-primary">CDK 管理后台</h1>
          </header>

          <form onSubmit={handleLogin} className="rounded-xl bg-surface-1 p-5 sm:p-6">
            {error && (
              <div className="mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
                {error}
              </div>
            )}
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">管理口令</span>
              <input
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.currentTarget.value)}
                className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
                placeholder="MAA_ADMIN_PASSWORD"
                autoComplete="current-password"
                required
              />
            </label>
            <button
              type="submit"
              disabled={listLoading}
              className="mt-5 w-full rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
            >
              {listLoading ? '正在验权...' : '登录后台'}
            </button>
          </form>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-10">
      <main className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink-primary">管理后台</h1>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              管理 CDK 授权、站内公告和匿名使用统计。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleRefreshDashboard()}
              disabled={listLoading || announcementLoading || usageLoading}
              className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:text-ink-muted"
            >
              {listLoading || announcementLoading || usageLoading ? '刷新中...' : '刷新数据'}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
            >
              退出登录
            </button>
            <a
              href="/"
              className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
            >
              返回首页
            </a>
          </div>
        </header>

        {error && (
          <div className="mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
            {error}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
          <aside className="rounded-xl border border-surface-3 bg-surface-1 p-2 lg:sticky lg:top-6">
            <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="后台分类">
              {adminSections.map((section) => {
                const active = activeSection === section.id
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`min-w-[168px] rounded-lg px-3 py-3 text-left transition-colors duration-150 lg:min-w-0 ${
                      active
                        ? 'bg-brand-600 text-white'
                        : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{section.label}</span>
                    <span className={`mt-1 block text-xs leading-5 ${active ? 'text-white/80' : 'text-ink-muted'}`}>
                      {section.description}
                    </span>
                  </button>
                )
              })}
            </nav>
          </aside>

          <div className="min-w-0">
            {activeSection === 'overview' && (
              <section className="rounded-xl bg-surface-1">
                <div className="flex flex-col gap-4 border-b border-surface-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                  <div>
                    <h2 className="text-base font-semibold text-ink-primary">使用统计</h2>
                    <p className="mt-1 text-sm text-ink-secondary">
                      匿名统计工具页访问、方案生成和 CDK 兑换，近 7 天按 UTC 日期汇总。
                    </p>
                  </div>
                  {usageLoading && (
                    <span className="text-xs text-ink-muted">统计加载中...</span>
                  )}
                </div>

                <div className="grid gap-px bg-surface-3 text-sm sm:grid-cols-4">
                  <UsageMetric label="累计访问人数" value={usageStats?.totals.unique_visitors ?? 0} />
                  <UsageMetric label="累计访问次数" value={usageStats?.totals.visits ?? 0} />
                  <UsageMetric label="累计生成次数" value={usageStats?.totals.schedule_generates ?? 0} />
                  <UsageMetric label="累计 CDK 兑换" value={usageStats?.totals.cdk_redeems ?? 0} />
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-surface-3 text-left text-sm">
                    <thead className="bg-surface-2 text-xs font-semibold text-ink-secondary">
                      <tr>
                        <th className="whitespace-nowrap px-4 py-3">日期</th>
                        <th className="whitespace-nowrap px-4 py-3">访问人数</th>
                        <th className="whitespace-nowrap px-4 py-3">访问次数</th>
                        <th className="whitespace-nowrap px-4 py-3">生成次数</th>
                        <th className="whitespace-nowrap px-4 py-3">CDK 兑换</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-3">
                      {(usageStats?.days ?? []).length > 0 ? (
                        usageStats!.days.map((day) => (
                          <tr key={day.date} className="transition-colors duration-150 hover:bg-surface-2/70">
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-ink-primary">{day.date}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">{day.unique_visitors}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">{day.visits}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">{day.schedule_generates}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">{day.cdk_redeems}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-4 py-8 text-center text-sm text-ink-secondary" colSpan={5}>
                            暂无统计数据。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {activeSection === 'cdk' && (
              <section className="space-y-5">
                <section className="overflow-hidden rounded-xl bg-surface-1">
                  <form onSubmit={handleGenerate} className="p-5 sm:p-6">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-end">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-base font-semibold text-ink-primary">生成 CDK</h2>
                        <p className="mt-1 text-sm leading-6 text-ink-secondary">
                          选择授权类型并写入订单备注，生成后立即复制明文 CDK。
                        </p>
                        <div className="mt-4 flex flex-col gap-4 lg:flex-row">
                          <div className="min-w-[280px] flex-1">
                            <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK 类型</span>
                            <div className="flex rounded-lg bg-surface-2 p-1">
                              {cdkProductPermissions.map((item) => (
                                <button
                                  key={item}
                                  type="button"
                                  onClick={() => setPermission(item)}
                                  className={`min-w-0 flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${
                                    permission === item
                                      ? 'bg-brand-600 text-white'
                                      : 'text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'
                                  }`}
                                >
                                  {permissionLabels[item]}
                                </button>
                              ))}
                            </div>
                          </div>

                          <label className="min-w-[240px] flex-1">
                            <span className="mb-2 block text-sm font-medium text-ink-secondary">订单备注 / 订单号</span>
                            <input
                              type="text"
                              value={orderNote}
                              onChange={(event) => setOrderNote(event.currentTarget.value)}
                              className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
                              placeholder="可选"
                            />
                          </label>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={generateLoading}
                        className="w-full rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted xl:w-40"
                      >
                        {generateLoading ? '生成中...' : '生成 CDK'}
                      </button>
                    </div>
                  </form>

                  {result && (
                    <section className="border-t border-surface-3 bg-warning/10 p-5 sm:p-6">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold text-warning">请立即复制保存</h2>
                          <div className="mt-2 break-all font-mono text-base font-semibold tracking-wide text-ink-primary">
                            {result.code}
                          </div>
                          <p className="mt-2 text-sm text-ink-secondary">
                            {permissionLabels[result.permission]}，{formatDate(result.created_at)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyCode}
                          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 lg:flex-shrink-0"
                        >
                          复制 CDK
                        </button>
                      </div>
                      {copyStatus && (
                        <p className="mt-2 text-sm text-ink-secondary">{copyStatus}</p>
                      )}
                    </section>
                  )}
                </section>

                <section className="min-w-0 overflow-hidden rounded-xl bg-surface-1">
                  <div className="flex flex-col gap-4 border-b border-surface-3 p-5 xl:flex-row xl:items-center xl:justify-between sm:p-6">
                    <div>
                      <h2 className="text-base font-semibold text-ink-primary">CDK 记录</h2>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <CdkStat label="未使用" value={summary.unused} />
                        <CdkStat label="已使用" value={summary.used} />
                        <CdkStat label="已撤销" value={summary.revoked} />
                        <CdkStat label="当前列表" value={summary.total} />
                      </div>
                    </div>
                    <div className="inline-flex self-start rounded-lg bg-surface-2 p-1 xl:self-auto">
                      {(['unused', 'used', 'revoked', 'all'] as const).map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setStatusFilter(item)}
                          className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${
                            statusFilter === item
                              ? 'bg-brand-600 text-white'
                              : 'text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'
                          }`}
                        >
                          {statusFilterLabels[item]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-[1120px] divide-y divide-surface-3 text-left text-sm">
                      <thead className="bg-surface-2 text-xs font-semibold text-ink-secondary">
                        <tr>
                          <th className="whitespace-nowrap px-4 py-3">CDK</th>
                          <th className="whitespace-nowrap px-4 py-3">操作</th>
                          <th className="whitespace-nowrap px-4 py-3">权限</th>
                          <th className="whitespace-nowrap px-4 py-3">时间</th>
                          <th className="whitespace-nowrap px-4 py-3">生成次数</th>
                          <th className="whitespace-nowrap px-4 py-3">备注</th>
                          <th className="whitespace-nowrap px-4 py-3">使用信息</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-3">
                        {listLoading && records.length === 0 ? (
                          Array.from({ length: 4 }).map((_, index) => (
                            <tr key={index}>
                              <td className="px-4 py-4" colSpan={7}>
                                <div className="h-5 rounded bg-surface-2" />
                              </td>
                            </tr>
                          ))
                        ) : records.length > 0 ? (
                          records.map((record) => (
                            <tr key={record.code_hash} className="transition-colors duration-150 hover:bg-surface-2/70">
                              <td className="whitespace-nowrap px-4 py-4 align-top font-mono text-ink-primary">{record.cdk_id}</td>
                              <td className="w-[260px] px-4 py-3 align-top">
                                {record.status === 'unused' ? (
                                  <div className="flex flex-wrap gap-2">
                                    {getNextProductPermission(record.permission) && (
                                      <button
                                        type="button"
                                        onClick={() => handleUpgradeRecord(record)}
                                        disabled={upgradingCdkHash === record.code_hash}
                                        className="rounded-md bg-brand-600/15 px-2.5 py-1.5 text-xs font-semibold text-brand-300 transition-colors duration-150 hover:bg-brand-600/25 disabled:bg-surface-3 disabled:text-ink-muted"
                                      >
                                        {upgradingCdkHash === record.code_hash ? '升级中' : `升到${permissionLabels[getNextProductPermission(record.permission)!]}`}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRecord(record)}
                                      disabled={deletingCdkHash === record.code_hash}
                                      className="rounded-md bg-error/10 px-2.5 py-1.5 text-xs font-semibold text-error transition-colors duration-150 hover:bg-error/20 disabled:bg-surface-3 disabled:text-ink-muted"
                                    >
                                      {deletingCdkHash === record.code_hash ? '删除中' : '删除'}
                                    </button>
                                  </div>
                                ) : record.status === 'used' ? (
                                  <div className="flex flex-wrap gap-2">
                                    {getNextProductPermission(record.permission) && (
                                      <button
                                        type="button"
                                        onClick={() => handleUpgradeRecord(record)}
                                        disabled={upgradingCdkHash === record.code_hash}
                                        className="rounded-md bg-brand-600/15 px-2.5 py-1.5 text-xs font-semibold text-brand-300 transition-colors duration-150 hover:bg-brand-600/25 disabled:bg-surface-3 disabled:text-ink-muted"
                                      >
                                        {upgradingCdkHash === record.code_hash ? '升级中' : `升到${permissionLabels[getNextProductPermission(record.permission)!]}`}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleGrantOperatorUpdate(record)}
                                      disabled={grantingOperatorUpdateHash === record.code_hash || (record.operator_update_grant_remaining ?? 0) > 0}
                                      className="rounded-md bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success transition-colors duration-150 hover:bg-success/20 disabled:bg-surface-3 disabled:text-ink-muted"
                                    >
                                      {grantingOperatorUpdateHash === record.code_hash
                                        ? '发放中'
                                        : (record.operator_update_grant_remaining ?? 0) > 0
                                          ? '待使用'
                                          : '发放更新'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRevokeRecord(record)}
                                      disabled={revokingCdkHash === record.code_hash}
                                      className="rounded-md bg-error/10 px-2.5 py-1.5 text-xs font-semibold text-error transition-colors duration-150 hover:bg-error/20 disabled:bg-surface-3 disabled:text-ink-muted"
                                    >
                                      {revokingCdkHash === record.code_hash ? '撤销中' : '撤销'}
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-ink-muted">-</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-4 py-4 align-top">
                                <div className="flex flex-col items-start gap-2">
                                  <span className="text-ink-primary">{permissionLabels[record.permission]}</span>
                                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    record.status === 'unused'
                                      ? 'bg-success/10 text-success'
                                      : record.status === 'revoked'
                                        ? 'bg-error/10 text-error'
                                        : 'bg-surface-3 text-ink-secondary'
                                  }`}
                                  >
                                    {statusLabels[record.status]}
                                  </span>
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-4 py-4 align-top text-xs text-ink-secondary">
                                <div>生成 {formatDate(record.created_at)}</div>
                                <div className="mt-1 text-ink-muted">使用 {formatDate(record.used_at)}</div>
                              </td>
                              <td className="whitespace-nowrap px-4 py-4 align-top text-ink-secondary">{record.schedule_generate_count ?? 0}</td>
                              <td className="max-w-[180px] px-4 py-4 align-top text-ink-secondary">
                                <div className="truncate" title={record.order_note || undefined}>{record.order_note || '-'}</div>
                              </td>
                              <td className="w-[320px] px-4 py-4 align-top">
                                <UsageInfo record={record} />
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td className="px-4 py-10 text-center text-sm text-ink-secondary" colSpan={7}>
                              当前筛选下没有 CDK 记录。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </section>
            )}

            {activeSection === 'announcement' && (
              <form onSubmit={handleSaveAnnouncement} className="max-w-3xl rounded-xl bg-surface-1 p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-ink-primary">公告设置</h2>
                    <p className="mt-1 text-sm leading-6 text-ink-secondary">
                      公告会显示在工具页顶部，禁用后前台不展示。
                    </p>
                  </div>
                  {announcementLoading && (
                    <span className="shrink-0 text-xs text-ink-muted">加载中...</span>
                  )}
                </div>

                <label className="mt-5 flex items-center justify-between gap-4 rounded-lg bg-surface-2 px-3 py-2">
                  <span className="text-sm font-medium text-ink-secondary">启用公告</span>
                  <input
                    type="checkbox"
                    checked={announcement.enabled}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked
                      setAnnouncement((current) => ({ ...current, enabled }))
                    }}
                    className="h-4 w-4 accent-brand-600"
                  />
                </label>

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">标题</span>
                  <input
                    type="text"
                    value={announcement.title}
                    maxLength={80}
                    onChange={(event) => {
                      const title = event.currentTarget.value
                      setAnnouncement((current) => ({ ...current, title }))
                    }}
                    className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted"
                    placeholder="例如：维护通知"
                  />
                  <span className="mt-1 block text-xs text-ink-muted">{announcement.title.length}/80</span>
                </label>

                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">正文</span>
                  <textarea
                    value={announcement.body}
                    maxLength={600}
                    rows={7}
                    onChange={(event) => {
                      const body = event.currentTarget.value
                      setAnnouncement((current) => ({ ...current, body }))
                    }}
                    className="w-full resize-y rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm leading-6 text-ink-primary placeholder:text-ink-muted"
                    placeholder="公告内容会按纯文本展示，换行会保留。"
                  />
                  <span className="mt-1 block text-xs text-ink-muted">{announcement.body.length}/600</span>
                </label>

                <div className="mt-4 rounded-lg border border-surface-3 bg-surface-0 p-3">
                  <div className="text-xs font-medium text-ink-muted">预览</div>
                  {announcement.enabled && announcement.title.trim() && announcement.body.trim() ? (
                    <div className="mt-2">
                      <div className="text-sm font-semibold text-ink-primary">{announcement.title.trim()}</div>
                      <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">
                        {announcement.body.trim()}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-ink-secondary">当前公告不会在前台展示。</p>
                  )}
                </div>

                {announcementStatus && (
                  <p className="mt-3 text-sm text-success">{announcementStatus}</p>
                )}

                <button
                  type="submit"
                  disabled={announcementSaving}
                  className="mt-5 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
                >
                  {announcementSaving ? '保存中...' : '保存公告'}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function SummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-5 py-4">
      <div className="text-lg font-semibold text-ink-primary">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
    </div>
  )
}

function CdkStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm">
      <span className="font-semibold text-ink-primary">{value}</span>
      <span className="text-xs text-ink-muted">{label}</span>
    </span>
  )
}

function UsageInfo({ record }: { record: AdminCdkRecord }) {
  if (record.status === 'unused') {
    return <span className="text-ink-muted">-</span>
  }

  const grantCount = record.operator_update_grant_count ?? 0
  const usedCount = record.operator_update_used_count ?? 0
  const remaining = record.operator_update_grant_remaining ?? Math.max(0, grantCount - usedCount)
  const primary = [
    record.operator_count !== null ? `${record.operator_count} 干员` : null,
    record.config_desc,
  ].filter(Boolean).join(' / ')

  return (
    <div className="space-y-1.5 text-sm">
      <div className="text-ink-secondary">{primary || '-'}</div>
      {record.license_order_hash && (
        <div className="break-all font-mono text-xs text-ink-muted">订单 {record.license_order_hash}</div>
      )}
      {remaining > 0 ? (
        <div className="inline-flex rounded-md bg-success/10 px-2 py-1 text-xs font-semibold text-success">
          干员更新待使用 {remaining} 次
        </div>
      ) : grantCount > 0 ? (
        <div className="text-xs text-ink-muted">干员更新已用 {usedCount}/{grantCount}</div>
      ) : null}
      {record.status === 'revoked' && record.revoked_at && (
        <div className="text-xs text-error">撤销 {formatDate(record.revoked_at)}</div>
      )}
    </div>
  )
}

function UsageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-1 px-5 py-4">
      <div className="text-xl font-semibold text-ink-primary">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
    </div>
  )
}

function normalizeAnnouncementResponse(data: AnnouncementResponse): Announcement {
  return {
    enabled: data.enabled === true,
    title: typeof data.title === 'string' ? data.title : '',
    body: typeof data.body === 'string' ? data.body : '',
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
  }
}

function normalizeUsageStatsResponse(data: UsageStatsResponse): { totals: UsageTotals; days: UsageDay[] } {
  return {
    totals: normalizeUsageTotals(data.totals),
    days: Array.isArray(data.days) ? data.days.map(normalizeUsageDay) : [],
  }
}

function normalizeUsageDay(day: Partial<UsageDay>): UsageDay {
  return {
    date: typeof day.date === 'string' ? day.date : '',
    ...normalizeUsageTotals(day),
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

function normalizeCount(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatUsage(record: AdminCdkRecord): string {
  if (record.status === 'unused') return '-'
  const grantCount = record.operator_update_grant_count ?? 0
  const usedCount = record.operator_update_used_count ?? 0
  const remaining = record.operator_update_grant_remaining ?? Math.max(0, grantCount - usedCount)
  const parts = [
    record.operator_count !== null ? `${record.operator_count} 干员` : null,
    record.config_desc,
    record.license_order_hash ? `订单 ${record.license_order_hash}` : null,
    remaining > 0
      ? `干员更新待使用 ${remaining} 次`
      : grantCount > 0
        ? `干员更新已用 ${usedCount}/${grantCount}`
        : null,
    record.status === 'revoked' && record.revoked_at ? `撤销 ${formatDate(record.revoked_at)}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : '-'
}

function normalizeProductPermission(permission: Permission): GeneratedPermission | null {
  if (permission === 'basic') return 'growth'
  if (permission === 'premium') return 'advanced'
  if (cdkProductPermissions.includes(permission as GeneratedPermission)) return permission as GeneratedPermission
  return null
}

function getNextProductPermission(permission: Permission): GeneratedPermission | null {
  const current = normalizeProductPermission(permission)
  if (!current) return null
  const next = cdkProductPermissions.find((item) => cdkProductPermissionRank[item] === cdkProductPermissionRank[current] + 1)
  return next ?? null
}
