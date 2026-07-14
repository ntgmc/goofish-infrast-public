import { useMemo, useState } from 'react'
import { apiVoid } from '../lib/api-client'

export default function CancelAccountDeletionPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', [])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const cancel = async () => {
    setLoading(true); setError(null)
    try {
      await apiVoid('/api/user/data/cancel', { method: 'POST', json: { token } })
      setStatus('注销请求已撤销。你现在可以正常登录。')
    } catch (caught) { setError((caught as Error).message) }
    finally { setLoading(false) }
  }

  return <main className="mx-auto flex min-h-screen max-w-lg items-center px-6"><section className="w-full rounded-xl border border-surface-3 bg-surface-1 p-6"><h1 className="text-xl font-semibold">撤销账号注销</h1><p className="mt-2 text-sm text-ink-secondary">确认后将恢复你的账号及现有数据。</p>{error && <p className="mt-4 text-sm text-error">{error}</p>}{status && <p className="mt-4 text-sm text-success">{status}</p>}<button type="button" disabled={!token || loading || Boolean(status)} onClick={() => void cancel()} className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-surface-3">{loading ? '正在处理...' : '撤销注销'}</button></section></main>
}
