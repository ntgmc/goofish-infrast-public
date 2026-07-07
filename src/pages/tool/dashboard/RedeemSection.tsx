import { useState, type FormEvent } from 'react'
import type { AuthSuccessResponse } from '../../../lib/types'
import { apiJson } from '../../../lib/api-client'
import SklandBindingDialog, { type SklandPayload } from '../../../components/SklandBindingDialog'

type AddAccountMode = 'cdk' | 'preview'

export default function RedeemSection({ onRedeemed }: { onRedeemed: (payload: AuthSuccessResponse) => void }) {
  const [mode, setMode] = useState<AddAccountMode>('cdk')
  const [cdk, setCdk] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [claimDialogOpen, setClaimDialogOpen] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'preview') {
      setError(null)
      setClaimDialogOpen(true)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<AuthSuccessResponse>('/api/user/profiles/redeem', {
        method: 'POST',
        json: { cdk, display_name: displayName, note },
        fallbackMessage: 'CDK 兑换失败',
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

  const handleClaimPayload = (payload: SklandPayload) => {
    if (!payload.user) return
    setCdk('')
    setDisplayName('')
    setNote('')
    setClaimDialogOpen(false)
    onRedeemed(payload)
  }

  return (
    <>
      <form onSubmit={submit} className="max-w-2xl rounded-xl border border-surface-3 bg-surface-1 p-6">
        <h2 className="text-lg font-semibold text-ink-primary">新增账号档案</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          CDK 用于解锁正式档案；免费个人排班需要通过森空岛确认游戏 UID 后领取。
        </p>

        <div className="mt-5 inline-flex rounded-lg border border-surface-3 bg-surface-0 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('cdk')
              setError(null)
            }}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${mode === 'cdk' ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            CDK 解锁
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('preview')
              setError(null)
            }}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${mode === 'preview' ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            免费个人排班
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
            免费个人排班会展示完整游戏内轮换队列，但不提供 MAA JSON 下载、原始数据、高级分析、批量导出或商用授权。
          </div>
        )}

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">档案名称</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder={mode === 'preview' ? '例如：免费排班' : '例如：主账号'} />
        </label>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">备注</span>
          <textarea value={note} onChange={(event) => setNote(event.currentTarget.value)} rows={4} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="可填写账号用途、区服或其他备注" />
        </label>
        <button type="submit" disabled={loading} className="mt-5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
          {loading ? 'Working...' : mode === 'preview' ? '通过森空岛领取免费个人排班' : 'Redeem CDK'}
        </button>
      </form>
      <SklandBindingDialog
        open={claimDialogOpen}
        profile={null}
        context="free_preview_claim"
        claimProfileMeta={{ displayName, note }}
        onOpenChange={setClaimDialogOpen}
        onPayload={handleClaimPayload}
      />
    </>
  )
}
