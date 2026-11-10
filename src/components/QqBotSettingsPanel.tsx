import { useCallback, useState } from 'react'
import QqBotVerificationPanel from './QqBotVerificationPanel'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserQueryScope, usePrivateQueryScope } from '../lib/private-query-scope'
import { NotificationSettingsIcon as Bell } from './icons'
import { apiJson } from '../lib/api-client'
import type { AuthMeResponse } from '../lib/types'
import { copy } from '../copy/index'
import { useSiteFeatures } from '../lib/site-feature-context'

type Settings = {
  available: boolean
  binding: { binding_id: string; qq_number: string; notifications_enabled: boolean; bound_at: string } | null
}
const ENDPOINT = '/api/user/qqbot'

export default function QqBotSettingsPanel() {
  const { features } = useSiteFeatures()
  const owner = usePrivateQueryScope('user')
  const session = useQuery({ queryKey: ['user', null, null, 'qqbot-session'], enabled: features.qqbot && !owner.identity, staleTime: 0, gcTime: 0,
    queryFn: ({ signal }) => apiJson<AuthMeResponse>('/api/auth/me', { signal }) })
  const identity = owner.identity ?? session.data?.user?.id ?? null
  if (!features.qqbot) return null
  if (session.error && !identity) return <p className="tool-alert tool-alert--error" role="alert">{session.error.message}<button type="button" className="tool-secondary-action" onClick={() => void session.refetch({ cancelRefetch: false })}>{copy.notifications.qqbot.refresh}</button></p>
  return <UserQueryScope.Provider value={identity}><QqBotSettingsContent key={identity} /></UserQueryScope.Provider>
}

function QqBotSettingsContent() {
  const owner = usePrivateQueryScope('user')
  const client = useQueryClient()
  const key = [...owner.key, 'qqbot']
  const query = useQuery({ queryKey: key, enabled: owner.enabled, queryFn: ({ signal }) => apiJson<Settings>(ENDPOINT, { signal }) })
  const settings = query.data
  const [saving, setBusy] = useState(false)
  const [writeError, setError] = useState<string | null>(null)
  const busy = saving || query.isFetching
  const error = writeError ?? query.error?.message
  const text = copy.notifications.qqbot

  const refresh = async () => { if (owner.enabled) await client.invalidateQueries({ queryKey: key, exact: true }) }

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try { await action() } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.notifications.qqbot.failed)
    } finally { setBusy(false) }
  }, [])

  return (
    <section className="tool-panel p-5 sm:p-6" aria-busy={query.isFetching} data-loading={query.isFetching || undefined}>
      <div className="flex items-center gap-3">
        <Bell size={20} className="shrink-0 text-brand-500" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-ink-primary">{text.title}</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">{text.body}</p>
      {error && <p className="tool-alert tool-alert--error mt-4" role="alert">{error}</p>}
      {settings && !settings.available && <p className="mt-4 text-sm text-ink-secondary">{text.unavailable}</p>}
      {settings?.binding ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-ink-secondary">{text.bound(settings.binding.qq_number)}</p>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink-primary">
            <span>{text.receive}</span>
            <input type="checkbox" checked={settings.binding.notifications_enabled}
              className="size-4 shrink-0 accent-brand-500"
              disabled={busy || (!settings.available && !settings.binding.notifications_enabled)}
              onChange={(event) => {
                const enabled = event.currentTarget.checked
                void run(async () => {
                  await apiJson(ENDPOINT, { method: 'PATCH', json: { notifications_enabled: enabled } })
                  await refresh()
                })
              }} />
          </label>
          <div className="settings-danger-actions">
            <button type="button" className="tool-secondary-action" disabled={busy} aria-busy={saving} onClick={() => {
              if (!window.confirm(text.unbindConfirm)) return
              void run(async () => {
                await apiJson(ENDPOINT, { method: 'DELETE' })
                await refresh()
              })
            }}>{text.unbind}</button>
          </div>
        </div>
      ) : (
        <div className="mt-4"><QqBotVerificationPanel userId={owner.identity ?? ''} disabled={busy || !settings?.available} /></div>
      )}
    </section>
  )
}
