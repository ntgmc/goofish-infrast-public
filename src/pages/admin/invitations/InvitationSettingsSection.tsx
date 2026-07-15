import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { InvitationRewardRecipient, InvitationSettings } from '../../../lib/types'

const DEFAULT_SETTINGS: InvitationSettings = {
  version: 1,
  enabled: true,
  activation_rule: 'first_active_profile',
  daily_inviter_reward_limit: 10,
  rewards: [
    { recipient: 'inviter', type: 'priority_compute_coupon', quantity: 1, validity_days: 0 },
    { recipient: 'invitee', type: 'priority_compute_coupon', quantity: 0, validity_days: 0 },
  ],
  updated_at: null,
}

export default function InvitationSettingsSection() {
  const [settings, setSettings] = useState<InvitationSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminApiJson<{ settings?: InvitationSettings }>('/api/admin/invitation-settings')
      setSettings(data.settings ?? DEFAULT_SETTINGS)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const updateReward = (recipient: InvitationRewardRecipient, field: 'quantity' | 'validity_days', value: number) => {
    setSettings((current) => ({
      ...current,
      rewards: current.rewards.map((reward) => reward.recipient === recipient ? { ...reward, [field]: value } : reward),
    }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const data = await adminApiJson<{ settings?: InvitationSettings }>('/api/admin/invitation-settings', {
        method: 'PUT',
        json: {
          enabled: settings.enabled,
          daily_inviter_reward_limit: settings.daily_inviter_reward_limit,
          rewards: settings.rewards,
        },
        fallbackMessage: '保存邀请设置失败',
      })
      setSettings(data.settings ?? settings)
      setNotice('邀请设置已保存；新配置将用于之后完成激活的邀请。')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="tool-panel p-6 text-sm text-ink-secondary">正在载入邀请设置...</div>

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
      {notice && <div className="tool-alert tool-alert--success" role="status" aria-live="polite">{notice}</div>}

      <section className="tool-panel p-5 sm:p-6" aria-labelledby="admin-invitation-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="tool-eyebrow">拉新活动</p>
            <h2 id="admin-invitation-title" className="mt-2 text-lg font-semibold text-ink-primary">邀请注册奖励</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">奖励在新用户首次激活 CDK 或森空岛免费档案时，按当时配置结算。</p>
          </div>
          <label className="tool-inset flex min-h-11 items-center gap-3 px-4 text-sm font-semibold text-ink-secondary">
            <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.currentTarget.checked }))} className="h-4 w-4 accent-brand-600" />
            启用邀请活动
          </label>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <RewardEditor title="邀请人奖励" recipient="inviter" settings={settings} onChange={updateReward} />
          <RewardEditor title="新用户奖励" recipient="invitee" settings={settings} onChange={updateReward} />
        </div>

        <label className="mt-5 block max-w-sm" htmlFor="daily-inviter-limit">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">每位邀请人每日奖励上限</span>
          <input id="daily-inviter-limit" type="number" min={1} max={1000} value={settings.daily_inviter_reward_limit} onChange={(event) => setSettings((current) => ({ ...current, daily_inviter_reward_limit: Number(event.currentTarget.value) }))} className="tool-field" />
          <span className="mt-1.5 block text-xs text-ink-muted">按 Asia/Shanghai 自然日统计，范围 1–1000。</span>
        </label>

        <div className="tool-inset mt-5 p-4 text-sm leading-6 text-ink-secondary">
          <p><span className="font-semibold text-ink-primary">激活规则：</span>首次拥有有效的 CDK 或森空岛免费档案。</p>
          <p><span className="font-semibold text-ink-primary">配置生效：</span>按新用户完成激活时的最新设置结算，已发奖励不追溯调整。</p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="tool-primary-action">{saving ? '保存中...' : '保存邀请设置'}</button>
          <button type="button" disabled={saving} onClick={() => void load()} className="tool-secondary-action">重新载入</button>
          <span className="text-xs text-ink-muted">最近更新：{settings.updated_at ? new Date(settings.updated_at).toLocaleString('zh-CN') : '使用默认配置'}</span>
        </div>
      </section>
    </form>
  )
}

function RewardEditor({ title, recipient, settings, onChange }: {
  title: string
  recipient: InvitationRewardRecipient
  settings: InvitationSettings
  onChange: (recipient: InvitationRewardRecipient, field: 'quantity' | 'validity_days', value: number) => void
}) {
  const reward = settings.rewards.find((item) => item.recipient === recipient) ?? DEFAULT_SETTINGS.rewards.find((item) => item.recipient === recipient)!
  return (
    <fieldset className="tool-inset p-4">
      <legend className="px-1 text-sm font-semibold text-ink-primary">{title}</legend>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <label>
          <span className="mb-2 block text-sm font-medium text-ink-secondary">优先计算券数量</span>
          <input type="number" min={0} max={100} value={reward.quantity} onChange={(event) => onChange(recipient, 'quantity', Number(event.currentTarget.value))} className="tool-field" />
          <span className="mt-1.5 block text-xs text-ink-muted">0 表示不向该对象发券。</span>
        </label>
        <label>
          <span className="mb-2 block text-sm font-medium text-ink-secondary">有效天数</span>
          <input type="number" min={0} max={3650} value={reward.validity_days} onChange={(event) => onChange(recipient, 'validity_days', Number(event.currentTarget.value))} className="tool-field" />
          <span className="mt-1.5 block text-xs text-ink-muted">0 表示永久有效。</span>
        </label>
      </div>
    </fieldset>
  )
}
