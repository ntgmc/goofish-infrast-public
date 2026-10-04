import { useCallback, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { apiJson } from '../lib/api-client'
import { copy } from '../copy/index'

type Settings = {
  available: boolean
  binding: { binding_id: string; qq_number: string; notifications_enabled: boolean; bound_at: string } | null
}
type BindingCode = { binding_code: string; expires_at: string }
const ENDPOINT = '/api/user/qqbot'

export default function QqBotSettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [code, setCode] = useState<BindingCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const text = copy.notifications.qqbot

  const refresh = useCallback(async () => {
    const next = await apiJson<Settings>(ENDPOINT)
    setSettings(next)
    if (next.binding) setCode(null)
  }, [])

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try { await action() } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.notifications.qqbot.failed)
    } finally { setBusy(false) }
  }, [])

  useEffect(() => { void run(refresh) }, [refresh, run])

  return (
    <section className="tool-panel p-5 sm:p-6">
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
          <label className="flex min-h-11 items-center gap-3 text-sm text-ink-primary">
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
            {text.receive}
          </label>
          <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => {
            if (!window.confirm(text.unbindConfirm)) return
            void run(async () => {
              await apiJson(ENDPOINT, { method: 'DELETE' })
              setCode(null)
              await refresh()
            })
          }}>{text.unbind}</button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {code && <div role="status" className="space-y-2">
            <label className="block text-sm text-ink-secondary">
              {text.codeLabel}
              <input className="tool-field mt-2 font-mono" readOnly value={text.bindingCommand(code.binding_code)} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <p className="text-sm text-ink-secondary">{text.codeHelp(new Date(code.expires_at).toLocaleString('zh-CN'))}</p>
          </div>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="tool-primary-action" disabled={busy || !settings?.available} onClick={() => void run(async () => {
              setCode(await apiJson<BindingCode>(ENDPOINT, { method: 'POST' }))
            })}>{code ? text.regenerate : text.generate}</button>
            <button type="button" className="tool-secondary-action" disabled={busy} onClick={() => void run(refresh)}>{text.refresh}</button>
          </div>
        </div>
      )}
    </section>
  )
}
