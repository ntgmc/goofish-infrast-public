import { useState } from 'react'
import type { AuthSuccessResponse } from '../../../lib/types'
import { apiJson } from '../../../lib/api-client'


export default function RedeemSection({ onRedeemed }: { onRedeemed: (payload: AuthSuccessResponse) => void }) {
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
      const data = await apiJson<AuthSuccessResponse>('/api/user/profiles/redeem', {
        method: 'POST',
        json: { cdk, display_name: displayName, note },
        fallbackMessage: '兑换失败',
      })
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
