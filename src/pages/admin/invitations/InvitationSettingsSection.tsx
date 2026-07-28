import { Dialog } from 'radix-ui'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import { itemIconPath } from '../../../lib/inventory-contracts'
import type {
  AdminInvitationSettingsResponse,
  InvitationRewardCatalogItem,
  InvitationGiftPackSummary,
  InvitationRewardRecipient,
  InvitationRewardRule,
  InvitationSettings,
} from '../../../lib/types'
import { AdminToast } from '../shared/AdminToast'

const DEFAULT_SETTINGS: InvitationSettings = {
  version: 2,
  enabled: true,
  activation_rule: 'first_active_profile',
  daily_inviter_reward_limit: 10,
  rewards: [{
    recipient: 'inviter',
    item_code: 'priority_compute_coupon',
    quantity: 1,
    expiry: { mode: 'never' },
    gift_pack_version_id: null,
  }],
  updated_at: null,
}

export default function InvitationSettingsSection() {
  const [settings, setSettings] = useState<InvitationSettings>(DEFAULT_SETTINGS)
  const [savedSettings, setSavedSettings] = useState<InvitationSettings>(DEFAULT_SETTINGS)
  const [catalog, setCatalog] = useState<InvitationRewardCatalogItem[]>([])
  const [configuredGiftPackVersions, setConfiguredGiftPackVersions] = useState<InvitationGiftPackSummary[]>([])
  const [addingFor, setAddingFor] = useState<InvitationRewardRecipient | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminApiJson<AdminInvitationSettingsResponse>('/api/admin/invitation-settings')
      const next = data.settings ?? DEFAULT_SETTINGS
      setSettings(next)
      setSavedSettings(next)
      setCatalog(data.catalog ?? [])
      setConfiguredGiftPackVersions(data.configured_gift_pack_versions ?? [])
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(savedSettings), [savedSettings, settings])
  const catalogByCode = useMemo(() => new Map(catalog.map((item) => [item.item_code, item])), [catalog])
  const giftPackVersionById = useMemo(() => new Map(configuredGiftPackVersions.map((version) => [version.id, version])), [configuredGiftPackVersions])

  const updateReward = (recipient: InvitationRewardRecipient, itemCode: string, update: Partial<InvitationRewardRule>) => {
    setSettings((current) => ({
      ...current,
      rewards: current.rewards.map((reward) => reward.recipient === recipient && reward.item_code === itemCode
        ? { ...reward, ...update }
        : reward),
    }))
  }

  const removeReward = (recipient: InvitationRewardRecipient, itemCode: string) => {
    setSettings((current) => ({
      ...current,
      rewards: current.rewards.filter((reward) => reward.recipient !== recipient || reward.item_code !== itemCode),
    }))
  }

  const addReward = (recipient: InvitationRewardRecipient, item: InvitationRewardCatalogItem) => {
    setSettings((current) => ({
      ...current,
      rewards: [...current.rewards, {
        recipient,
        item_code: item.item_code,
        quantity: 1,
        expiry: { mode: 'never' },
        gift_pack_version_id: item.latest_gift_pack_version?.id ?? null,
      }],
    }))
    setAddingFor(null)
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
      const next = data.settings ?? settings
      setSettings(next)
      setSavedSettings(next)
      setNotice('邀请设置已保存；新配置将用于之后完成激活的邀请。')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="tool-panel p-6 text-sm text-ink-secondary" role="status">正在载入邀请设置...</div>

  const invalidRewards = settings.rewards.filter((reward) => catalogByCode.get(reward.item_code)?.selectable !== true)
  const cannotSave = saving || !dirty || invalidRewards.length > 0 || (settings.enabled && settings.rewards.length === 0)

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
      {notice && <AdminToast message={notice} onDismiss={() => setNotice(null)} />}

      <section className="tool-panel p-5 sm:p-6" aria-labelledby="admin-invitation-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="tool-eyebrow">拉新活动</p>
            <h2 id="admin-invitation-title" className="mt-2 text-lg font-semibold text-ink-primary">邀请注册奖励</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">分别配置邀请人和新用户的道具组合；同一次成功邀请只占邀请人的一个每日名额。</p>
          </div>
          <label className="tool-inset flex min-h-11 items-center gap-3 px-4 text-sm font-semibold text-ink-secondary">
            <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.currentTarget.checked }))} className="h-4 w-4 accent-brand-600" />
            启用邀请活动
          </label>
        </div>

        <label className="mt-6 block max-w-sm" htmlFor="daily-inviter-limit">
          <span className="mb-2 block text-sm font-medium text-ink-secondary">每日获奖邀请人数上限</span>
          <input id="daily-inviter-limit" type="number" min={1} max={1000} value={settings.daily_inviter_reward_limit} onChange={(event) => setSettings((current) => ({ ...current, daily_inviter_reward_limit: Number(event.currentTarget.value) }))} className="tool-field" />
          <span className="mt-1.5 block text-xs text-ink-muted">按 Asia/Shanghai 自然日统计；每位成功激活的新用户只占一个名额，与奖励道具数量无关。</span>
        </label>

        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          {(['inviter', 'invitee'] as InvitationRewardRecipient[]).map((recipient) => (
            <RewardGroup
              key={recipient}
              recipient={recipient}
              rewards={settings.rewards.filter((reward) => reward.recipient === recipient)}
              catalogByCode={catalogByCode}
              giftPackVersionById={giftPackVersionById}
              onAdd={() => setAddingFor(recipient)}
              onUpdate={updateReward}
              onRemove={removeReward}
            />
          ))}
        </div>

        {settings.enabled && settings.rewards.length === 0 && <div className="tool-alert tool-alert--warning mt-5" role="alert">启用活动前，至少要为邀请人或新用户配置一项奖励。</div>}
        {invalidRewards.length > 0 && <div className="tool-alert tool-alert--error mt-5" role="alert">配置中存在已停发或不可用的道具，请先移除后再保存。</div>}

        <div className="tool-inset mt-5 p-4 text-sm leading-6 text-ink-secondary">
          <p><span className="font-semibold text-ink-primary">邀请人：</span>{rewardSummary(settings.rewards.filter((reward) => reward.recipient === 'inviter'), catalogByCode)}</p>
          <p><span className="font-semibold text-ink-primary">新用户：</span>{rewardSummary(settings.rewards.filter((reward) => reward.recipient === 'invitee'), catalogByCode)}</p>
          <p className="mt-2 text-xs text-ink-muted">礼包将在保存时固定最新已发布版本；暂停期间已经激活的邀请保留其激活快照。</p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={cannotSave} className="tool-primary-action disabled:cursor-not-allowed disabled:opacity-50">{saving ? '保存中...' : dirty ? '保存邀请设置' : '已保存'}</button>
          <button type="button" disabled={saving} onClick={() => void load()} className="tool-secondary-action">重新载入</button>
          <span className="text-xs text-ink-muted" aria-live="polite">{dirty ? '有未保存修改' : `最近更新：${settings.updated_at ? new Date(settings.updated_at).toLocaleString('zh-CN') : '使用默认配置'}`}</span>
        </div>
      </section>

      <ItemPickerDialog
        recipient={addingFor}
        catalog={catalog}
        selectedCodes={new Set(settings.rewards.filter((reward) => reward.recipient === addingFor).map((reward) => reward.item_code))}
        onClose={() => setAddingFor(null)}
        onSelect={(item) => addingFor && addReward(addingFor, item)}
      />
    </form>
  )
}

function RewardGroup({ recipient, rewards, catalogByCode, giftPackVersionById, onAdd, onUpdate, onRemove }: {
  recipient: InvitationRewardRecipient
  rewards: InvitationRewardRule[]
  catalogByCode: Map<string, InvitationRewardCatalogItem>
  giftPackVersionById: Map<string, InvitationGiftPackSummary>
  onAdd: () => void
  onUpdate: (recipient: InvitationRewardRecipient, itemCode: string, update: Partial<InvitationRewardRule>) => void
  onRemove: (recipient: InvitationRewardRecipient, itemCode: string) => void
}) {
  const title = recipient === 'inviter' ? '邀请人奖励' : '新用户奖励'
  return (
    <fieldset className="tool-inset min-w-0 p-4">
      <legend className="px-1 text-sm font-semibold text-ink-primary">{title}</legend>
      {rewards.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-surface-3 p-5 text-center text-sm text-ink-muted">暂未配置奖励</p>
      ) : (
        <div className="mt-2 space-y-3">
          {rewards.map((reward) => {
            const item = catalogByCode.get(reward.item_code)
            const configuredVersion = reward.gift_pack_version_id ? giftPackVersionById.get(reward.gift_pack_version_id) : null
            return (
              <article key={reward.item_code} className="rounded-xl border border-surface-3 bg-surface-1 p-4">
                <div className="flex items-start gap-3">
                  <img src={itemIconPath(item?.icon_key ?? 'placeholder')} alt="" width={56} height={56} className="h-14 w-14 shrink-0 object-contain" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><h3 className="font-semibold text-ink-primary">{item?.name ?? reward.item_code}</h3><p className="mt-0.5 text-xs text-ink-muted">{kindLabel(item?.kind)} · {reward.item_code}</p></div>
                      <button type="button" onClick={() => onRemove(recipient, reward.item_code)} className="tool-secondary-action min-h-9 px-3 py-1.5 text-xs" aria-label={`移除${item?.name ?? reward.item_code}`}>移除</button>
                    </div>
                    {!item?.selectable && <p className="mt-2 text-xs font-medium text-danger-500">{item?.unavailable_reason ?? '道具当前不可用。'}</p>}
                    {(configuredVersion ?? item?.latest_gift_pack_version) && <p className="mt-2 text-xs text-ink-secondary">礼包版本 v{(configuredVersion ?? item!.latest_gift_pack_version)!.version} · {packContents((configuredVersion ?? item!.latest_gift_pack_version)!.contents)}</p>}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(6rem,.75fr)]">
                  <label><span className="mb-1.5 block text-xs font-medium text-ink-secondary">数量</span><input className="tool-field" type="number" min={1} max={10000} value={reward.quantity} onChange={(event) => onUpdate(recipient, reward.item_code, { quantity: Number(event.currentTarget.value) })} /></label>
                  <label><span className="mb-1.5 block text-xs font-medium text-ink-secondary">有效期</span><select className="tool-field" value={reward.expiry.mode} onChange={(event) => onUpdate(recipient, reward.item_code, { expiry: event.currentTarget.value === 'never' ? { mode: 'never' } : { mode: 'relative_days', days: 30 } })}><option value="never">永久有效</option><option value="relative_days">领取后 N 天</option></select></label>
                  {reward.expiry.mode === 'relative_days' && <label><span className="mb-1.5 block text-xs font-medium text-ink-secondary">天数</span><input className="tool-field" type="number" min={1} max={3650} value={reward.expiry.days} onChange={(event) => onUpdate(recipient, reward.item_code, { expiry: { mode: 'relative_days', days: Number(event.currentTarget.value) } })} /></label>}
                </div>
              </article>
            )
          })}
        </div>
      )}
      <button type="button" disabled={rewards.length >= 16} onClick={onAdd} className="tool-secondary-action mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50">{rewards.length >= 16 ? '已达到 16 项上限' : '添加道具'}</button>
    </fieldset>
  )
}

function ItemPickerDialog({ recipient, catalog, selectedCodes, onClose, onSelect }: {
  recipient: InvitationRewardRecipient | null
  catalog: InvitationRewardCatalogItem[]
  selectedCodes: Set<string>
  onClose: () => void
  onSelect: (item: InvitationRewardCatalogItem) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = catalog.filter((item) => !search.trim()
    || `${item.name} ${item.item_code}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return (
    <Dialog.Root open={recipient !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-surface-3 bg-surface-1 p-5 shadow-2xl focus:outline-none sm:p-6">
          <Dialog.Title className="text-lg font-semibold text-ink-primary">添加{recipient === 'inviter' ? '邀请人' : '新用户'}奖励</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm leading-6 text-ink-secondary">选择一个当前允许发放的道具；已添加的道具不能重复选择。</Dialog.Description>
          <label htmlFor="invitation-item-search" className="sr-only">搜索道具</label>
          <input id="invitation-item-search" autoFocus className="tool-field mt-4 w-full" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="搜索道具名称或代码" />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {filtered.map((item) => {
              const disabled = selectedCodes.has(item.item_code) || !item.selectable
              return <button key={item.item_code} type="button" disabled={disabled} onClick={() => onSelect(item)} className="tool-inset flex items-center gap-3 p-3 text-left transition hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-45">
                <img src={itemIconPath(item.icon_key)} alt="" width={48} height={48} className="h-12 w-12 shrink-0 object-contain" />
                <span className="min-w-0"><strong className="block truncate text-sm text-ink-primary">{item.name}</strong><span className="block truncate text-xs text-ink-muted">{kindLabel(item.kind)}{selectedCodes.has(item.item_code) ? ' · 已添加' : item.unavailable_reason ? ` · ${item.unavailable_reason}` : ''}</span></span>
              </button>
            })}
          </div>
          {filtered.length === 0 && <p className="tool-inset mt-4 p-6 text-center text-sm text-ink-muted">没有匹配的道具</p>}
          <div className="mt-5 flex justify-end"><Dialog.Close className="tool-secondary-action">关闭</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function rewardSummary(rewards: InvitationRewardRule[], catalog: Map<string, InvitationRewardCatalogItem>): string {
  if (rewards.length === 0) return '未配置'
  return rewards.map((reward) => `${catalog.get(reward.item_code)?.name ?? reward.item_code} ×${reward.quantity}（${reward.expiry.mode === 'never' ? '永久' : `${reward.expiry.days} 天`}）`).join('、')
}

function kindLabel(kind: InvitationRewardCatalogItem['kind'] | undefined): string {
  if (kind === 'capacity_upgrade') return '档案扩容'
  if (kind === 'gift_pack') return '礼包'
  return '消耗券'
}

function packContents(contents: InvitationGiftContents): string {
  return contents.length > 0 ? contents.map((item) => `${item.name} ×${item.quantity}`).join('、') : '内容将在开启后发放'
}

type InvitationGiftContents = NonNullable<InvitationRewardCatalogItem['latest_gift_pack_version']>['contents']
