import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiJson } from '../../../lib/api-client'
import type { InvitationSummary, RewardBalance } from '../../../lib/types'

export default function InvitationsSection() {
  const [summary, setSummary] = useState<InvitationSummary | null>(null)
  const [balance, setBalance] = useState<RewardBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [invitation, rewards] = await Promise.all([
        apiJson<InvitationSummary>('/api/user/invitations'),
        apiJson<{ balances?: RewardBalance[] }>('/api/user/rewards'),
      ])
      setSummary(invitation)
      setBalance(rewards.balances?.find((item) => item.type === 'priority_compute_coupon') ?? null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const absoluteShareUrl = useMemo(() => {
    if (!summary?.share_url) return null
    return new URL(summary.share_url, window.location.origin).toString()
  }, [summary?.share_url])

  const generateCode = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await apiJson('/api/user/invitations/code', { method: 'POST', fallbackMessage: '生成邀请码失败' })
      await load()
      setNotice('邀请链接已生成。')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setNotice(`${label}已复制。`)
      setError(null)
    } catch {
      setError('复制失败，请手动选择并复制。')
    }
  }

  if (loading) return <div className="tool-panel p-6 text-sm text-ink-secondary">正在载入邀请信息...</div>

  const inviterRule = summary?.settings.rewards.find((item) => item.recipient === 'inviter')
  const inviteeRule = summary?.settings.rewards.find((item) => item.recipient === 'invitee')

  return (
    <div className="space-y-5">
      {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
      {notice && <div className="tool-alert tool-alert--success" role="status" aria-live="polite">{notice}</div>}

      <section className="tool-panel p-5 sm:p-6" aria-labelledby="invitation-title">
        <p className="tool-eyebrow">邀请奖励</p>
        <h2 id="invitation-title" className="mt-2 text-xl font-semibold text-ink-primary">邀请好友完成账号激活</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
          好友注册时填写你的邀请码，并首次兑换 CDK 或完成森空岛免费档案确认后，奖励会自动结算。
        </p>

        <div className="tool-inset mt-5 p-4 sm:p-5" aria-labelledby="priority-coupon-introduction-title">
          <h3 id="priority-coupon-introduction-title" className="text-sm font-semibold text-ink-primary">优先计算券是什么？</h3>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            每张券可用于一次账号档案的主排班计算。提交前手动勾选后，该任务会进入最高优先队列，排在普通付费和免费任务之前；券只提升排队顺序，不会改变计算结果。
          </p>
          <p className="mt-2 text-xs leading-5 text-ink-muted">
            入队失败不会扣券；服务端执行失败或最终超时会自动退回一张等效券。不适用于升级建议、情景实验或调序检查。
          </p>
        </div>

        {!summary?.settings.enabled ? (
          <div className="tool-alert tool-alert--warning mt-5" role="status">邀请活动当前暂停。</div>
        ) : !summary.can_invite ? (
          <div className="tool-alert tool-alert--warning mt-5" role="status">完成 CDK 兑换或森空岛免费档案激活后，即可生成邀请链接。</div>
        ) : summary.code && absoluteShareUrl ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <CopyField id="invitation-code" label="邀请码" value={summary.code} onCopy={() => void copy(summary.code!, '邀请码')} />
            <CopyField id="invitation-link" label="分享链接" value={absoluteShareUrl} onCopy={() => void copy(absoluteShareUrl, '分享链接')} />
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => void generateCode()} className="tool-primary-action mt-5">
            {busy ? '正在生成...' : '生成邀请链接'}
          </button>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="邀请数据">
        <Metric label="已注册" value={summary?.stats.registered ?? 0} />
        <Metric label="已激活" value={summary?.stats.activated ?? 0} />
        <Metric label="累计获得优先券" value={`${summary?.stats.rewards_earned ?? 0} 张`} />
        <Metric label="可用优先券" value={`${balance?.available ?? 0} 张`} />
      </section>

      <section className="tool-panel p-5 sm:p-6" aria-labelledby="invitation-rules-title">
        <h2 id="invitation-rules-title" className="text-lg font-semibold text-ink-primary">当前活动规则</h2>
        <ul className="mt-4 space-y-2 text-sm leading-6 text-ink-secondary">
          <li>邀请人每次可获得 {inviterRule?.quantity ?? 0} 张优先计算券；新用户完成激活后可获得 {inviteeRule?.quantity ?? 0} 张优先计算券。</li>
          <li>每位邀请人每天最多结算 {summary?.settings.daily_inviter_reward_limit ?? 0} 次邀请人奖励。</li>
          <li>{formatValidity(inviterRule?.validity_days ?? 0)}；每张券可让一次主排班任务进入最高优先队列。</li>
          {balance?.next_expiry_at && <li>最近到期时间：{new Date(balance.next_expiry_at).toLocaleString('zh-CN')}</li>}
        </ul>
      </section>
    </div>
  )
}

function CopyField({ id, label, value, onCopy }: { id: string; label: string; value: string; onCopy: () => void }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink-secondary">{label}</label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} className="tool-field min-w-0 flex-1 font-mono" />
        <button type="button" onClick={onCopy} className="tool-secondary-action shrink-0">复制</button>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="tool-panel p-5"><p className="text-xs font-medium text-ink-muted">{label}</p><p className="mt-2 text-2xl font-semibold text-ink-primary">{value}</p></div>
}

function formatValidity(days: number): string {
  return days > 0 ? `奖励券自发放起 ${days} 天内有效` : '奖励券永久有效'
}
