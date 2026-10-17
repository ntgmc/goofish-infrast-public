import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { invalidateSklandSnapshot, loadSklandSnapshot, readSklandSnapshotState, sklandSnapshotKey, subscribeSklandSnapshot } from '../lib/skland-snapshot-client'
import type { UserGameAccount } from '../lib/types'
import { useSiteFeatures } from '../lib/site-feature-context'
import { sklandResourceState } from '../lib/skland-snapshot'
import { copy } from '../copy'

export function useSklandSnapshot(userId: string | undefined, profile: UserGameAccount | null | undefined, enabled = true) {
  const { features } = useSiteFeatures()
  const available = Boolean(enabled && features.skland && userId && profile?.skland_binding && profile.status === 'active' && !profile.archived_at
    && profile.skland_binding.credential_status !== 'invalid')
  const key = available ? sklandSnapshotKey(userId!, profile!.skland_binding!.uid) : 'none'
  const subscribe = useCallback((listener: () => void) => available ? subscribeSklandSnapshot(key, listener) : () => {}, [available, key])
  const read = useCallback(() => readSklandSnapshotState(key), [key])
  const state = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    if (available) void loadSklandSnapshot(userId!, profile!, { reload: true }).catch(() => undefined)
  }, [available, key, state.revision, userId, profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!available) return
    const check = () => { if (document.visibilityState === 'visible') void loadSklandSnapshot(userId!, profile!, { reload: true }).catch(() => undefined) }
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [available, key, userId, profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(async () => {
    if (available) return loadSklandSnapshot(userId!, profile!, { force: true }).catch(() => undefined)
  }, [available, userId, profile?.id, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => { if (available) invalidateSklandSnapshot(key) }, [available, key])
  const expired = Boolean(state.data && sklandResourceState(state.data.inventory.fetchedAt) === 'expired')
  return { ...state, data: expired ? null : state.data, error: state.error || (expired ? copy.skland.expired : ''), expired, refresh, reload, available: available && !state.blocked }
}
