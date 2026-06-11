import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

type Permission = 'basic' | 'premium' | 'admin'
type CdkStatus = 'unused' | 'used'
type StatusFilter = CdkStatus | 'all'

interface AdminCdkRecord {
  code_hash: string;
  cdk_id: string;
  permission: Permission;
  status: CdkStatus;
  created_at: string;
  used_at: string | null;
  order_note: string | null;
  license_order_hash: string | null;
  operator_count: number | null;
  config_desc: string | null;
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
  permission?: Permission;
  created_at?: string;
}

const permissionLabels: Record<Permission, string> = {
  basic: 'Basic',
  premium: 'Premium',
  admin: 'Admin',
}

const statusLabels: Record<CdkStatus, string> = {
  unused: '未使用',
  used: '已使用',
}

const statusFilterLabels: Record<StatusFilter, string> = {
  unused: '未使用',
  used: '已使用',
  all: '全部',
}

export default function AdminPage() {
  const [adminPassword, setAdminPassword] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [permission, setPermission] = useState<Permission>('basic')
  const [orderNote, setOrderNote] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('unused')
  const [records, setRecords] = useState<AdminCdkRecord[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [result, setResult] = useState<{ code: string; permission: Permission; created_at: string } | null>(null)

  const summary = useMemo(() => {
    const unused = records.filter((record) => record.status === 'unused').length
    const used = records.filter((record) => record.status === 'used').length
    return { unused, used, total: records.length }
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

  useEffect(() => {
    if (!authenticated) return
    loadCdkRecords(adminPassword, statusFilter).catch((e) => {
      setError((e as Error).message)
      if ((e as Error).message.includes('口令')) {
        setAuthenticated(false)
      }
    })
  }, [authenticated, adminPassword, statusFilter, loadCdkRecords])

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

  const handleLogout = () => {
    setAuthenticated(false)
    setAdminPassword('')
    setRecords([])
    setResult(null)
    setError(null)
    setCopyStatus(null)
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
      <main className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink-primary">CDK 管理后台</h1>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              默认展示全部未使用 CDK 记录，可切换筛选查看已使用记录；明文 CDK 只在生成成功后展示一次。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => loadCdkRecords(adminPassword, statusFilter).catch((e) => setError((e as Error).message))}
              disabled={listLoading}
              className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:text-ink-muted"
            >
              {listLoading ? '刷新中...' : '刷新列表'}
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

        <section className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <aside className="space-y-5">
            <form onSubmit={handleGenerate} className="rounded-xl bg-surface-1 p-5 sm:p-6">
              <h2 className="text-base font-semibold text-ink-primary">生成 CDK</h2>
              <div className="mt-5 grid gap-5">
                <div>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK 类型</span>
                  <div className="inline-flex rounded-lg bg-surface-2 p-1">
                    {(['basic', 'premium', 'admin'] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setPermission(item)}
                        className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors duration-150 ${
                          permission === item
                            ? 'bg-brand-600 text-white'
                            : 'text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'
                        }`}
                      >
                        {permissionLabels[item]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ink-muted">
                    Admin 允许用户重新上传干员数据，并继续修改基建配置。
                  </p>
                </div>

                <label className="block">
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

              <button
                type="submit"
                disabled={generateLoading}
                className="mt-6 w-full rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
              >
                {generateLoading ? '正在生成...' : '生成 CDK'}
              </button>
            </form>

            {result && (
              <section className="rounded-xl border border-warning/30 bg-warning/10 p-5 sm:p-6">
                <h2 className="text-sm font-semibold text-warning">请立即复制保存</h2>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">
                  刷新或退出后不会再次展示明文 CDK。
                </p>
                <div className="mt-4 rounded-lg bg-surface-0 p-3">
                  <div className="break-all font-mono text-lg font-semibold tracking-wide text-ink-primary">
                    {result.code}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="mt-3 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
                  >
                    复制 CDK
                  </button>
                </div>
                {copyStatus && (
                  <p className="mt-2 text-sm text-ink-secondary">{copyStatus}</p>
                )}
                <dl className="mt-4 grid gap-3 text-sm">
                  <div>
                    <dt className="text-ink-muted">类型</dt>
                    <dd className="mt-1 text-ink-primary">{permissionLabels[result.permission]}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">生成时间</dt>
                    <dd className="mt-1 text-ink-primary">{formatDate(result.created_at)}</dd>
                  </div>
                </dl>
              </section>
            )}
          </aside>

          <section className="min-w-0 rounded-xl bg-surface-1">
            <div className="flex flex-col gap-4 border-b border-surface-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <h2 className="text-base font-semibold text-ink-primary">CDK 记录</h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  当前筛选 {statusFilterLabels[statusFilter]}，共 {summary.total} 条
                </p>
              </div>
              <div className="inline-flex self-start rounded-lg bg-surface-2 p-1 sm:self-auto">
                {(['unused', 'used', 'all'] as const).map((item) => (
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

            <div className="grid grid-cols-3 border-b border-surface-3 text-sm">
              <SummaryCell label="未使用" value={summary.unused} />
              <SummaryCell label="已使用" value={summary.used} />
              <SummaryCell label="当前列表" value={summary.total} />
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-surface-3 text-left text-sm">
                <thead className="bg-surface-2 text-xs font-semibold text-ink-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3">CDK 标识</th>
                    <th className="whitespace-nowrap px-4 py-3">权限</th>
                    <th className="whitespace-nowrap px-4 py-3">状态</th>
                    <th className="whitespace-nowrap px-4 py-3">生成时间</th>
                    <th className="whitespace-nowrap px-4 py-3">使用时间</th>
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
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-ink-primary">{record.cdk_id}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">{permissionLabels[record.permission]}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            record.status === 'unused'
                              ? 'bg-success/10 text-success'
                              : 'bg-surface-3 text-ink-secondary'
                          }`}
                          >
                            {statusLabels[record.status]}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">{formatDate(record.created_at)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">{formatDate(record.used_at)}</td>
                        <td className="min-w-[160px] px-4 py-3 text-ink-secondary">{record.order_note || '-'}</td>
                        <td className="min-w-[200px] px-4 py-3 text-ink-secondary">
                          {formatUsage(record)}
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

function formatDate(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatUsage(record: AdminCdkRecord): string {
  if (record.status === 'unused') return '-'
  const parts = [
    record.operator_count !== null ? `${record.operator_count} 干员` : null,
    record.config_desc,
    record.license_order_hash ? `订单 ${record.license_order_hash}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : '-'
}
