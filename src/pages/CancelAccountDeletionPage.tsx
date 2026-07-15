import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiVoid } from '../lib/api-client'

export default function CancelAccountDeletionPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', [])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(token ? null : '撤销链接无效或已过期。')
  const [loading, setLoading] = useState(false)

  const cancel = async () => {
    if (!token || loading || status) return
    setLoading(true); setError(null)
    try {
      await apiVoid('/api/user/data/cancel', { method: 'POST', json: { token } })
      setStatus('注销请求已撤销。你现在可以正常登录。')
    } catch (caught) { setError((caught as Error).message) }
    finally { setLoading(false) }
  }

  return (
    <main className="tool-shell flex min-h-dvh items-center justify-center px-4 py-6 sm:px-6" tabIndex={-1} data-route-focus>
      <section className="tool-panel w-full max-w-lg p-6 sm:p-8" aria-labelledby="cancel-account-deletion-title">
        <p className="tool-eyebrow">账号安全</p>
        <h1 id="cancel-account-deletion-title" className="mt-2 text-2xl font-semibold text-ink-primary">撤销账号注销</h1>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">确认后将恢复账号及现有工作台数据；此操作不会重新生成或修改任何排班方案。</p>
        {error && <p className="tool-alert tool-alert--error mt-5" role="alert">{error}</p>}
        {status && <p className="tool-alert tool-alert--success mt-5" role="status" aria-live="polite">{status}</p>}
        <button type="button" disabled={!token || loading || Boolean(status)} onClick={() => void cancel()} className="tool-primary-action mt-5 w-full">
          {loading ? '正在处理...' : '撤销注销'}
        </button>
        <Link to="/tool/profiles" className="mt-5 inline-flex min-h-11 w-full items-center justify-center text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
          返回登录
        </Link>
      </section>
    </main>
  )
}
