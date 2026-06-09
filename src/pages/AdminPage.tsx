import { useState } from 'react'

type Permission = 'basic' | 'premium'

export default function AdminPage() {
  const [adminPassword, setAdminPassword] = useState('')
  const [permission, setPermission] = useState<Permission>('basic')
  const [orderNote, setOrderNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [result, setResult] = useState<{ code: string; permission: Permission; created_at: string } | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setCopyStatus(null)
    setResult(null)
    setLoading(true)
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
      const data = await resp.json() as { error?: string; code?: string; permission?: Permission; created_at?: string }
      if (!resp.ok) {
        throw new Error(data.error || `生成失败: ${resp.status}`)
      }
      setResult({
        code: data.code!,
        permission: data.permission!,
        created_at: data.created_at!,
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
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

  return (
    <div className="min-h-screen px-6 py-10">
      <main className="mx-auto max-w-3xl">
        <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink-primary">CDK 管理后台</h1>
            <p className="mt-2 text-sm text-ink-secondary">
              生成单次使用的 CDK，明文仅在本页生成成功后展示一次。
            </p>
          </div>
          <a
            href="/"
            className="self-start rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary sm:self-auto"
          >
            返回首页
          </a>
        </header>

        <form onSubmit={handleSubmit} className="bg-surface-1 rounded-xl p-5 sm:p-6">
          {error && (
            <div className="mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
              {error}
            </div>
          )}

          <div className="grid gap-5">
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

            <div>
              <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK 类型</span>
              <div className="inline-flex rounded-lg bg-surface-2 p-1">
                {(['basic', 'premium'] as const).map((item) => (
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
                    {item === 'basic' ? 'Basic' : 'Premium'}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-ink-secondary">订单备注/订单号</span>
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
            disabled={loading}
            className="mt-6 w-full rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
          >
            {loading ? '正在生成...' : '生成 CDK'}
          </button>
        </form>

        {result && (
          <section className="mt-6 rounded-xl border border-warning/30 bg-warning/10 p-5 sm:p-6">
            <p className="text-sm font-semibold text-warning">请立即复制保存，刷新后不会再次显示明文。</p>
            <div className="mt-4 flex flex-col gap-3 rounded-lg bg-surface-0 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 break-all px-1 font-mono text-lg font-semibold tracking-wide text-ink-primary">
                {result.code}
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
              >
                复制 CDK
              </button>
            </div>
            {copyStatus && (
              <p className="mt-2 text-sm text-ink-secondary">{copyStatus}</p>
            )}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-muted">类型</dt>
                <dd className="mt-1 text-ink-primary">{result.permission === 'basic' ? 'Basic' : 'Premium'}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">生成时间</dt>
                <dd className="mt-1 text-ink-primary">{new Date(result.created_at).toLocaleString()}</dd>
              </div>
            </dl>
          </section>
        )}
      </main>
    </div>
  )
}
