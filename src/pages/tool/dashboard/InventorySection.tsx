import { Dialog } from 'radix-ui'
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { copy } from '../../../copy/index'
import { apiJson, getApiErrorMessage } from '../../../lib/api-client'
import SklandBindingDialog, { type SklandPayload } from '../../../components/SklandBindingDialog'
import type { AuthSuccessResponse } from '../../../lib/types'
import {
  itemIconPath,
  type InventoryResponse,
  type InventoryStack,
  type OnboardingTaskView,
  type ProfileCapacitySummary,
} from '../../../lib/inventory-contracts'

type Category = 'all' | 'consumable' | 'capacity_upgrade' | 'gift_pack' | 'license_voucher'
type UseResponse = { rewards?: Array<{ item_code: string; quantity: number; expires_at: string | null }> }

export default function InventorySection({
  onPayload,
  onLifetimeProfileCreated,
}: {
  onPayload: (payload: AuthSuccessResponse) => void
  onLifetimeProfileCreated?: () => void
}) {
  const [inventory, setInventory] = useState<InventoryResponse | null>(null)
  const [tasks, setTasks] = useState<OnboardingTaskView[]>([])
  const [selected, setSelected] = useState<InventoryStack | null>(null)
  const [category, setCategory] = useState<Category>('all')
  const [search, setSearch] = useState('')
  const [profileId, setProfileId] = useState('')
  const [lifetimeDisplayName, setLifetimeDisplayName] = useState('')
  const [lifetimeNote, setLifetimeNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rewards, setRewards] = useState<UseResponse['rewards']>(undefined)
  const [lifetimeDialogOpen, setLifetimeDialogOpen] = useState(false)
  const itemIdempotencyKeyRef = useRef(crypto.randomUUID())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextInventory, nextTasks] = await Promise.all([
        apiJson<InventoryResponse>('/api/user/inventory'),
        apiJson<{ tasks: OnboardingTaskView[] }>('/api/user/onboarding-tasks'),
      ])
      setInventory(nextInventory)
      setTasks(nextTasks.tasks ?? [])
    } catch (caught) {
      setError(getApiErrorMessage(caught, copy.inventory.load_failed))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => (inventory?.stacks ?? []).filter((stack) => {
    if (category !== 'all' && stack.item.kind !== category) return false
    return !search.trim() || stack.item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  }), [category, inventory?.stacks, search])

  const runItemAction = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await apiJson<UseResponse>('/api/user/inventory', {
        method: 'POST',
        json: {
          item_code: selected.item.code,
          quantity: 1,
          ...(profileId && { profile_id: profileId }),
          ...(selected.gift_pack_version_id && { gift_pack_version_id: selected.gift_pack_version_id }),
          idempotency_key: itemIdempotencyKeyRef.current,
        },
      })
      itemIdempotencyKeyRef.current = crypto.randomUUID()
      setRewards(response.rewards)
      setNotice(copy.inventory.operation_done)
      setSelected(null)
      await load()
    } catch (caught) {
      setError(getApiErrorMessage(caught, copy.inventory.load_failed))
    } finally {
      setBusy(false)
    }
  }

  const claimTask = async (task: OnboardingTaskView) => {
    setBusy(true)
    setError(null)
    try {
      await apiJson(`/api/user/onboarding-tasks/${encodeURIComponent(task.code)}/claim`, {
        method: 'POST',
        json: { idempotency_key: crypto.randomUUID() },
      })
      setNotice(copy.inventory.claim_done)
      await load()
    } catch (caught) {
      setError(getApiErrorMessage(caught, copy.inventory.load_failed))
    } finally {
      setBusy(false)
    }
  }

  const createLifetimeProfileWithJson = async () => {
    if (selected?.item.code !== 'lifetime_profile_voucher') return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await apiJson<AuthSuccessResponse>('/api/user/inventory/lifetime-profile', {
        method: 'POST',
        json: {
          idempotency_key: itemIdempotencyKeyRef.current,
          ...(lifetimeDisplayName.trim() && { display_name: lifetimeDisplayName.trim() }),
          ...(lifetimeNote.trim() && { note: lifetimeNote.trim() }),
        },
        fallbackMessage: copy.inventory.lifetime_create_failed,
      })
      itemIdempotencyKeyRef.current = crypto.randomUUID()
      setSelected(null)
      setLifetimeDisplayName('')
      setLifetimeNote('')
      setNotice(copy.inventory.lifetime_json_created)
      onPayload(response)
      if (onLifetimeProfileCreated) onLifetimeProfileCreated()
      else await load()
    } catch (caught) {
      setError(getApiErrorMessage(caught, copy.inventory.lifetime_create_failed))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !inventory) return <div className="tool-panel p-6 text-sm text-ink-secondary" role="status">{copy.inventory.loading}</div>

  const selectedCapacity = selected ? capacityForItem(selected.item.code, profileId, inventory?.capacities ?? []) : null
  const canUseSelected = selected?.item.kind === 'gift_pack'
    || selected?.actions.includes('bind')
    || (selected?.item.kind === 'license_voucher' && selected.actions.includes('use'))
    || (selected?.item.kind === 'capacity_upgrade' && Boolean(selectedCapacity) && selectedCapacity!.limit < selectedCapacity!.maximum)

  const handleLifetimePayload = (payload: SklandPayload) => {
    if (!payload.user) return
    setLifetimeDialogOpen(false)
    setNotice(copy.inventory.lifetime_bound)
    onPayload(payload)
    if (onLifetimeProfileCreated) onLifetimeProfileCreated()
    else void load()
  }

  return (
    <div className="space-y-5">
      <section className="tool-panel p-5 sm:p-6">
        <p className="tool-eyebrow">{copy.inventory.eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold text-ink-primary">{copy.inventory.title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{copy.inventory.description}</p>
        {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
        {notice && <div className="tool-alert tool-alert--success mt-4" role="status" aria-live="polite">{notice}</div>}
      </section>

      {tasks.some((task) => task.enabled) && (
        <section className="tool-panel p-5 sm:p-6" aria-labelledby="inventory-tasks-title">
          <h3 id="inventory-tasks-title" className="text-base font-semibold text-ink-primary">{copy.inventory.tasks}</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {tasks.filter((task) => task.enabled).map((task) => (
              <article key={task.code} className="tool-inset p-4">
                <h4 className="text-sm font-semibold text-ink-primary">{task.title}</h4>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">{task.description}</p>
                <button type="button" className="tool-secondary-action mt-4 w-full" disabled={busy || task.status !== 'claimable'} onClick={() => void claimTask(task)}>
                  {task.status === 'claimed' ? copy.inventory.claimed : task.status === 'claimable' ? copy.inventory.claim : task.status === 'disabled' ? copy.inventory.disabled : copy.inventory.incomplete}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="tool-panel p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" role="group" aria-label={copy.inventory.title}>
            {(['all', 'license_voucher', 'consumable', 'capacity_upgrade', 'gift_pack'] as Category[]).map((value) => (
              <button key={value} type="button" onClick={() => setCategory(value)} className={category === value ? 'tool-primary-action' : 'tool-secondary-action'}>
                {categoryLabel(value)}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="inventory-search">{copy.inventory.search}</label>
          <input id="inventory-search" className="tool-field sm:max-w-xs" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder={copy.inventory.search} />
        </div>
        {filtered.length === 0 ? (
          <div className="tool-inset mt-5 p-8 text-center text-sm text-ink-muted">{copy.inventory.empty}</div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((stack) => (
              <button key={stack.stack_id} type="button" onClick={() => { setSelected(stack); setProfileId(''); setLifetimeDisplayName(''); setLifetimeNote('') }} className="tool-inset min-w-0 p-4 text-left transition hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                <img src={itemIconPath(stack.item.icon_key)} onError={fallbackItemIcon} alt="" width={64} height={64} className="mx-auto h-16 w-16 object-contain" />
                <strong className="mt-3 block truncate text-sm text-ink-primary">{stack.item.name}</strong>
                <span className="mt-1 block text-xs text-ink-secondary">{copy.inventory.quantity} × {stack.quantity}</span>
                <span className="mt-1 block truncate text-[11px] text-ink-muted">{stack.next_expiry_at ? `${copy.inventory.expires}${formatDate(stack.next_expiry_at)}` : copy.inventory.permanent}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <Dialog.Root open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-surface-3 bg-surface-1 p-5 shadow-2xl focus:outline-none sm:p-6">
            {selected && <>
              <div className="flex gap-4">
                <img src={itemIconPath(selected.item.icon_key)} onError={fallbackItemIcon} alt="" width={64} height={64} className="h-16 w-16 object-contain" />
                <div className="min-w-0"><Dialog.Title className="text-lg font-semibold text-ink-primary">{selected.item.name}</Dialog.Title><Dialog.Description className="mt-1 text-sm leading-6 text-ink-secondary">{selected.item.description}</Dialog.Description></div>
              </div>
              <h4 className="mt-5 text-sm font-semibold text-ink-primary">{copy.inventory.batches}</h4>
              <ul className="mt-2 space-y-2 text-sm text-ink-secondary">
                {selected.expiry_buckets.map((bucket, index) => <li key={`${bucket.expires_at ?? 'never'}-${index}`} className="tool-inset flex justify-between p-3"><span>× {bucket.quantity}</span><span>{bucket.expires_at ? formatDate(bucket.expires_at) : copy.inventory.permanent}</span></li>)}
              </ul>
              {selected.item.kind === 'capacity_upgrade' && <>
                <label htmlFor="inventory-profile" className="mt-5 block text-sm font-medium text-ink-primary">{copy.inventory.choose_profile}</label>
                <select id="inventory-profile" className="tool-field mt-2 w-full" value={profileId} onChange={(event) => setProfileId(event.currentTarget.value)}>
                  <option value="">{copy.inventory.choose_profile}</option>
                  {(inventory?.capacities ?? []).map((profile) => <option key={profile.profile_id} value={profile.profile_id}>{profile.display_name}</option>)}
                </select>
                {selectedCapacity && <div className="tool-inset mt-3 grid grid-cols-3 gap-2 p-3 text-center text-xs"><span>{copy.inventory.current}<strong className="mt-1 block text-sm">{selectedCapacity.limit}</strong></span><span>{copy.inventory.after_use}<strong className="mt-1 block text-sm">{Math.min(selectedCapacity.maximum, selectedCapacity.limit + 1)}</strong></span><span>{copy.inventory.maximum}<strong className="mt-1 block text-sm">{selectedCapacity.maximum}</strong></span></div>}
              </>}
              {selected.actions.includes('context_only') && <div className="tool-alert mt-5">{copy.inventory.context_only}</div>}
              {selected.item.code === 'lifetime_profile_voucher' && <>
                <div className="tool-alert mt-5">{copy.inventory.lifetime_use_help}</div>
                <div className="tool-inset mt-4 space-y-3 p-4">
                  <div>
                    <label htmlFor="lifetime-profile-name" className="block text-sm font-medium text-ink-primary">{copy.inventory.lifetime_profile_name}</label>
                    <input id="lifetime-profile-name" className="tool-field mt-2 w-full" maxLength={40} value={lifetimeDisplayName} onChange={(event) => setLifetimeDisplayName(event.currentTarget.value)} placeholder={copy.inventory.lifetime_profile_name_placeholder} />
                  </div>
                  <div>
                    <label htmlFor="lifetime-profile-note" className="block text-sm font-medium text-ink-primary">{copy.inventory.lifetime_profile_note}</label>
                    <textarea id="lifetime-profile-note" className="tool-field mt-2 w-full resize-y" maxLength={500} rows={2} value={lifetimeNote} onChange={(event) => setLifetimeNote(event.currentTarget.value)} placeholder={copy.inventory.lifetime_profile_note_placeholder} />
                  </div>
                </div>
              </>}
              {selected.item.code === 'limited_profile_voucher' && <div className="tool-alert mt-5">{copy.inventory.limited_use_help}</div>}
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <Dialog.Close className="tool-secondary-action">{copy.inventory.close}</Dialog.Close>
                {selected.item.code === 'lifetime_profile_voucher' ? <>
                  <button type="button" disabled={busy || !canUseSelected} onClick={() => void createLifetimeProfileWithJson()} className="tool-secondary-action">
                    {busy ? copy.inventory.processing : copy.inventory.create_with_json}
                  </button>
                  <button type="button" disabled={busy || !canUseSelected} onClick={() => { setSelected(null); setLifetimeDialogOpen(true) }} className="tool-primary-action">
                    {copy.inventory.bind_and_use}
                  </button>
                </> : !selected.actions.includes('context_only') && <button type="button" disabled={busy || !canUseSelected} onClick={() => void runItemAction()} className="tool-primary-action">{busy ? copy.inventory.processing : selected.item.kind === 'gift_pack' ? copy.inventory.open : copy.inventory.use}</button>}
              </div>
            </>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {rewards && rewards.length > 0 && <section className="tool-panel p-5" aria-live="polite"><h3 className="text-base font-semibold text-ink-primary">{copy.inventory.rewards_received}</h3><ul className="mt-3 grid gap-2 sm:grid-cols-2">{rewards.map((reward) => <li key={reward.item_code} className="tool-inset p-3 text-sm text-ink-secondary">{reward.item_code} × {reward.quantity} · {reward.expires_at ? formatDate(reward.expires_at) : copy.inventory.permanent}</li>)}</ul></section>}
      <SklandBindingDialog
        open={lifetimeDialogOpen}
        profile={null}
        context="lifetime_voucher_use"
        onOpenChange={setLifetimeDialogOpen}
        onPayload={handleLifetimePayload}
      />
    </div>
  )
}

function categoryLabel(category: Category): string {
  if (category === 'consumable') return copy.inventory.consumable
  if (category === 'capacity_upgrade') return copy.inventory.capacity
  if (category === 'gift_pack') return copy.inventory.packs
  if (category === 'license_voucher') return copy.inventory.license_vouchers
  return copy.inventory.all
}

function capacityForItem(code: string, profileId: string, profiles: ProfileCapacitySummary[]) {
  const profile = profiles.find((candidate) => candidate.profile_id === profileId)
  if (!profile) return null
  if (code === 'plan_capacity_certificate') return profile.plan_slots
  if (code === 'history_capacity_certificate') return profile.history_slots
  if (code === 'result_archive_folder') return profile.archive_slots
  return null
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function fallbackItemIcon(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.onerror = null
  event.currentTarget.src = itemIconPath('placeholder')
}
