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
      <form onSubmit={submit} className="tool-panel max-w-2xl p-6">
        <h2 className="text-lg font-semibold text-ink-primary">新增账号档案</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          CDK 用于解锁正式档案；免费个人排班需要通过森空岛确认游戏 UID 后领取。
        </p>

        <div className="tool-inset mt-5 inline-flex p-1" role="group" aria-label="新增档案方式">
          <button
            type="button"
            onClick={() => {
              setMode('cdk')
              setError(null)
            }}
            aria-pressed={mode === 'cdk'}
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
            aria-pressed={mode === 'preview'}
            className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150 ${mode === 'preview' ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            免费个人排班
          </button>
        </div>

        {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}

        {mode === 'cdk' ? (
          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK</span>
            <input value={cdk} onChange={(event) => setCdk(event.currentTarget.value)} className="tool-field font-mono uppercase tracking-wide" required />
          </label>
        ) : (
          <div className="tool-alert tool-alert--warning mt-5">
            免费个人排班会展示完整游戏内轮换队列，但不提供 MAA JSON 下载、原始数据、高级分析、批量导出或商用授权。
          </div>
        )}

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">档案名称</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} className="tool-field" placeholder={mode === 'preview' ? '例如：免费排班' : '例如：主账号'} />
        </label>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">备注</span>
          <textarea value={note} onChange={(event) => setNote(event.currentTarget.value)} rows={4} className="tool-field resize-y" placeholder="可填写账号用途、区服或其他备注" />
        </label>
        <button type="submit" disabled={loading} className="tool-primary-action mt-5">
          {loading ? '处理中...' : mode === 'preview' ? '通过森空岛领取免费个人排班' : '兑换 CDK'}
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
