import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { invalidateSklandSnapshot, loadSklandSnapshot, readSklandSnapshotState, sklandSnapshotKey, subscribeSklandSnapshot } from '../lib/skland-snapshot-client'
import type { UserGameAccount } from '../lib/types'
import { useSiteFeatures } from '../lib/site-feature-context'
import { sklandResourceState } from '../lib/skland-snapshot'
import { copy } from '../copy'

export function useSklandSnapshot(userId: string | undefined, profile: UserGameAccount | null | undefined, enabled = true, resource: 'inventory' | 'live' = 'inventory') {
  const { features } = useSiteFeatures()
  const available = Boolean(enabled && features.skland && userId && profile?.skland_binding && profile.status === 'active' && !profile.archived_at
    && profile.skland_binding.credential_status !== 'invalid')
  const key = userId && profile?.skland_binding ? sklandSnapshotKey(userId, profile.skland_binding.uid) : 'none'
  const subscribe = useCallback((listener: () => void) => key !== 'none' ? subscribeSklandSnapshot(key, listener) : () => {}, [key])
  const read = useCallback(() => readSklandSnapshotState(key), [key])
  const state = useSyncExternalStore(subscribe, read, read)
  const accessError = profile ? state.accessErrors[profile.id] : undefined
  const canLoad = available && !state.blocked && !accessError
  useEffect(() => {
    if (canLoad) void loadSklandSnapshot(userId!, profile!, { reload: true, force: resource === 'live' }).catch(() => undefined)
  }, [canLoad, key, state.revision, userId, profile?.id, resource]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!canLoad) return
    const check = () => { if (document.visibilityState === 'visible') void loadSklandSnapshot(userId!, profile!, { reload: true, force: resource === 'live' }).catch(() => undefined) }
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [canLoad, key, userId, profile?.id, resource]) // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(async () => {
    if (canLoad) return loadSklandSnapshot(userId!, profile!, { force: true }).catch(() => undefined)
  }, [canLoad, userId, profile?.id, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => { if (available) invalidateSklandSnapshot(key) }, [available, key])
  const expired = Boolean(state.data && sklandResourceState(state.data.inventory.fetchedAt) === 'expired'
    && (resource === 'inventory' || sklandResourceState(state.data.game.fetchedAt) === 'expired'))
  const needsAuthorization = Boolean(profile && (!profile.skland_binding || profile.skland_binding.credential_status === 'invalid'
    || accessError?.code === 'skland_credential_invalid' || accessError?.code === 'skland_not_bound'))
  const error = needsAuthorization && profile?.skland_binding ? copy.skland.authorizationExpired
    : accessError?.code === 'session_expired' ? copy.skland.signInRequired : accessError?.message || state.error || (expired ? copy.skland.expired : '')
  return { ...state, data: expired || accessError || !available || state.blocked ? null : state.data, error, errorCode: accessError?.code,
    needsAuthorization, expired, refresh, reload, available: canLoad }
}
