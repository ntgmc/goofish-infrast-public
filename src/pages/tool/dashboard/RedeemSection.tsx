import { useState, type FormEvent } from 'react'
import type { AuthSuccessResponse } from '../../../lib/types'
import { apiJson } from '../../../lib/api-client'

type AddAccountMode = 'cdk' | 'preview'

export default function RedeemSection({ onRedeemed }: { onRedeemed: (payload: AuthSuccessResponse) => void }) {
  const [mode, setMode] = useState<AddAccountMode>('cdk')
  const [cdk, setCdk] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<AuthSuccessResponse>(mode === 'preview' ? '/api/user/profiles/preview' : '/api/user/profiles/redeem', {
        method: 'POST',
        json: mode === 'preview' ? { display_name: displayName, note } : { cdk, display_name: displayName, note },
        fallbackMessage: mode === 'preview' ? '创建免费预览失败' : '兑换失败',
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
      <p className="mt-2 text-sm leading-6 text-ink-secondary">正式账号需要未使用的 CDK；也可以先创建免费预览档案，按相同流程准备数据并查看限制版结果。</p>

      <div className="mt-5 inline-flex rounded-lg border border-surface-3 bg-surface-0 p-1">
        <button
          type="button"
          onClick={() => {
            setMode('cdk')
            setError(null)
          }}
          className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${mode === 'cdk' ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}
        >
          正式账号
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('preview')
            setError(null)
          }}
          className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${mode === 'preview' ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}
        >
          免费预览
        </button>
      </div>

      {error && <div className="mt-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}

      {mode === 'cdk' ? (
        <label className="mt-5 block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK</span>
          <input value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink-primary" required />
        </label>
      ) : (
        <div className="mt-5 rounded-lg border border-brand-600/25 bg-brand-600/10 px-4 py-3 text-sm leading-6 text-brand-300">
          免费预览不会消耗 CDK，每个登录账号最多保留一个预览档案。结果页只展示部分房间，不提供 MAA JSON 下载和练度建议。
        </div>
      )}

      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">账号名称</span>
        <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder={mode === 'preview' ? '例如：免费预览' : '例如：主号'} />
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-ink-secondary">备注</span>
        <textarea value={note} onChange={(event) => setNote(event.currentTarget.value)} rows={4} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="可以写区服、用途等说明。请不要填写游戏密码。" />
      </label>
      <button type="submit" disabled={loading} className="mt-5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">{loading ? '处理中...' : mode === 'preview' ? '创建免费预览' : '兑换 CDK'}</button>
    </form>
  )
}
