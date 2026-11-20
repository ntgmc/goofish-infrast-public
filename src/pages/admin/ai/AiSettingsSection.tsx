import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { copy } from '../../../copy'
import { AI_CREDIT_SERVICES } from '../../../lib/ai-credits'
import { formatPoints } from '../../../lib/balance-contracts'
import { AI_PROTOCOLS, adminAiSettingsUpdateSchema, aiConfigurationIssues, aiSettingsSchema, type AdminAiSettings, type AiSettings } from '../../../lib/ai-settings'
import { adminApiJson } from '../../../lib/admin-api-client'
import { useAdminDraftQuery } from '../../../lib/admin-draft-query'
import { SITE_FEATURE_QUERY_KEY } from '../../../lib/site-feature-context'
import { ApiError } from '../../../lib/api-client'
import { SectionLoader } from '../../../components/SessionLoader'
import { AdminToast } from '../shared/AdminToast'
import { inputClassName } from '../shared/helpers'

const text = copy.aiSettings
const numberGroups = [
  { title: text.pricing, help: text.pricing_help, fields: ['inputPrice', 'outputPrice', 'requestCap', 'dailyBudget', 'monthlyBudget'] },
  { title: text.requests, help: text.requests_help, fields: ['dailyAttemptLimit', 'concurrencyLimit'] },
  { title: text.bounds, help: text.bounds_help, fields: ['maxInputTokens', 'maxOutputTokens', 'timeoutMs'] },
] as const

export default function AiSettingsSection() {
  const [data, setData] = useState<AdminAiSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [reason, setReason] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const apply = useCallback((value: AdminAiSettings) => {
    const creditPrices = { ...value.settings.creditPrices }
    for (const service of AI_CREDIT_SERVICES) {
      const price = creditPrices[service]
      if (price !== null) creditPrices[service] = formatPoints(price)
    }
    setData({ ...value, settings: { ...value.settings, creditPrices } }); setApiKey(''); setClearKey(false); setReason(''); setDirty(false); setIssues({}); setError(null)
  }, [])
  const client = useQueryClient()
  const query = useAdminDraftQuery('ai', '/api/admin/ai-settings', apply)
  const change = (path: string) => {
    setDirty(true); setNotice(null); setIssues((current) => { const next = { ...current }; delete next[path]; return next })
  }
  const update = <K extends keyof AiSettings>(name: K, value: AiSettings[K]) => {
    setData((current) => current ? { ...current, settings: { ...current.settings, [name]: value } } : current)
    change(`settings.${name}`)
  }
  const fail = (message: string, fields: Record<string, string> = {}) => {
    setError(message); setIssues(fields)
    requestAnimationFrame(() => errorRef.current?.focus())
  }
  const save = async () => {
    if (!data) return
    setNotice(null)
    const parsed = adminAiSettingsUpdateSchema.safeParse({ settings: data.settings, enabled: data.enabled,
      ...(apiKey.trim() ? { api_key: apiKey } : {}), clear_api_key: clearKey, reason,
      expected_revision: data.revision, expected_feature_revision: data.feature_revision })
    if (!parsed.success) {
      fail(text.invalid, Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), text.invalid])))
      return
    }
    const configurationIssues = data.enabled ? aiConfigurationIssues(data.settings, Boolean(apiKey.trim()) || data.has_api_key && !clearKey) : []
    if (configurationIssues.length) { fail(text.invalid, Object.fromEntries(configurationIssues.map((issue) => [issue.path, issue.message]))); return }
    setSaving(true); setError(null)
    try {
      const saved = await adminApiJson<AdminAiSettings>('/api/admin/ai-settings', { method: 'PUT', json: parsed.data, fallbackMessage: text.save_failed })
      await query.write(saved)
      apply(saved)
      void client.invalidateQueries({ queryKey: SITE_FEATURE_QUERY_KEY, exact: true })
      setNotice(text.saved)
    } catch (cause) {
      fail(cause instanceof ApiError && cause.status === 409 ? text.conflict : cause instanceof Error ? cause.message : text.save_failed)
    } finally { setSaving(false) }
  }
  const reload = () => {
    if (dirty && !window.confirm(text.discard)) return
    setError(null); setNotice(null); void query.load()
  }
  if (!data && query.isFetching) return <SectionLoader label={text.loading} />
  if (!data) return <section className="tool-panel p-5"><p role="alert">{query.error?.message ?? text.load_failed}</p><button type="button" onClick={reload} className="tool-secondary-action mt-4">{text.reload}</button></section>

  const fieldError = (path: string) => issues[path] ? <span id={`ai-${path}-error`} className="mt-2 block text-sm text-error">{issues[path]}</span> : null
  const a11y = (path: string, help?: string) => ({ 'aria-invalid': Boolean(issues[path]), 'aria-describedby': [help, issues[path] ? `ai-${path}-error` : ''].filter(Boolean).join(' ') || undefined })
  return <form className="admin-settings space-y-5" aria-labelledby="ai-settings-title" noValidate onSubmit={(event) => { event.preventDefault(); void save() }}>
    <section className="admin-settings-heading"><h2 id="ai-settings-title" className="text-lg font-semibold">{text.title}</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">{text.description}</p></section>
    {(error || query.error) && <div ref={errorRef} tabIndex={-1} role="alert" className="tool-alert tool-alert--error">{error ?? query.error?.message}</div>}
    {notice && <AdminToast message={notice} onDismiss={() => setNotice(null)} />}
    <fieldset disabled={saving} className="tool-panel p-5 sm:p-6"><legend className="text-base font-semibold">{text.connection}</legend>
      <label className="admin-feature-option"><input name="enabled" type="checkbox" checked={data.enabled} onChange={(event) => { setData({ ...data, enabled: event.currentTarget.checked }); change('enabled') }} className="mt-1 h-4 w-4 accent-brand-600" /><span><strong className="text-sm">{text.enabled}</strong><span className="mt-1 block text-xs text-ink-secondary">{text.enabled_help}</span></span></label>
      {data.enabled && !data.effective_enabled && !dirty && <p className="mt-2 text-sm text-ink-secondary">{text.inherited_off}</p>}
      <div className="admin-settings-fields mt-4">
        <div><label className="block" htmlFor="ai-provider"><span className="mb-2 block text-sm">{text.provider}</span></label><input id="ai-provider" name="provider" value={data.settings.provider} onChange={(event) => update('provider', event.currentTarget.value)} maxLength={80} className={inputClassName(Boolean(issues['settings.provider']))} {...a11y('settings.provider')} /><span className="mt-1 block text-xs text-ink-muted">{text.provider_help}</span>{fieldError('settings.provider')}</div>
        <div><label className="mb-2 block text-sm" htmlFor="ai-protocol">{text.protocol}</label><select id="ai-protocol" name="protocol" value={data.settings.protocol} onChange={(event) => update('protocol', AI_PROTOCOLS.find((protocol) => protocol === event.currentTarget.value)!)} className={inputClassName(false)}>{AI_PROTOCOLS.map((protocol) => <option key={protocol} value={protocol}>{text.protocols[protocol]}</option>)}</select></div>
        <div><label className="block" htmlFor="ai-baseURL"><span className="mb-2 block text-sm">{text.baseURL}</span></label><input id="ai-baseURL" name="baseURL" type="url" value={data.settings.baseURL} autoCapitalize="none" spellCheck={false} onChange={(event) => update('baseURL', event.currentTarget.value)} maxLength={2048} className={inputClassName(Boolean(issues['settings.baseURL']))} {...a11y('settings.baseURL', 'ai-base-help')} /><span id="ai-base-help" className="mt-1 block text-xs text-ink-muted">{text.base_help}</span>{fieldError('settings.baseURL')}</div>
        <div><label className="mb-2 block text-sm" htmlFor="ai-model">{text.model}</label><input id="ai-model" name="model" value={data.settings.model} autoCapitalize="none" spellCheck={false} onChange={(event) => update('model', event.currentTarget.value)} maxLength={128} className={inputClassName(Boolean(issues['settings.model']))} {...a11y('settings.model')} />{fieldError('settings.model')}</div>
        <div><label className="block" htmlFor="ai-api-key"><span className="mb-2 block text-sm">{text.api_key}</span></label><input id="ai-api-key" name="api_key" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} disabled={clearKey} onChange={(event) => { setApiKey(event.currentTarget.value); change('api_key') }} maxLength={4096} className={inputClassName(Boolean(issues.api_key))} {...a11y('api_key')} /><span className="mt-1 block text-xs text-ink-secondary">{data.has_api_key ? text.key_present : text.key_absent}</span><span className="mt-1 block text-xs text-ink-muted">{text.key_help}</span>{fieldError('api_key')}</div>
        {data.has_api_key && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clear_api_key" checked={clearKey} onChange={(event) => { setClearKey(event.currentTarget.checked); setApiKey(''); change('api_key') }} className="h-4 w-4 accent-brand-600" />{text.clear_key}</label>}
      </div>
    </fieldset>
    {numberGroups.map((group) => <fieldset key={group.title} disabled={saving} className="tool-panel p-5 sm:p-6"><legend className="text-base font-semibold">{group.title}</legend><p className="text-sm leading-6 text-ink-secondary">{group.help}</p><div className="admin-settings-fields mt-4">{group.fields.map((name) => <div key={name}><label className="mb-2 block text-sm" htmlFor={`ai-${name}`}>{text.fields[name]}</label><input id={`ai-${name}`} name={name} type="number" step={aiSettingsSchema.shape[name].isInt ? 1 : 'any'} min={aiSettingsSchema.shape[name].minValue ?? undefined} max={aiSettingsSchema.shape[name].maxValue ?? undefined} value={data.settings[name]} onChange={(event) => update(name, Number(event.currentTarget.value))} className={inputClassName(Boolean(issues[`settings.${name}`]))} {...a11y(`settings.${name}`)} />{fieldError(`settings.${name}`)}</div>)}</div>{group.title === text.pricing && <div className="admin-settings-fields mt-4">{(['cachedInputPrice', 'cacheWritePrice', 'cacheWrite1hPrice'] as const).map((name) => <div key={name}><label className="mb-2 block text-sm" htmlFor={`ai-${name}`}>{text.fields[name]}</label><input id={`ai-${name}`} name={name} type="number" step="any" min={0} max={10000} value={data.settings[name] ?? ''} onChange={(event) => update(name, event.currentTarget.value === '' ? null : Number(event.currentTarget.value))} className={inputClassName(Boolean(issues[`settings.${name}`]))} {...a11y(`settings.${name}`)} />{fieldError(`settings.${name}`)}</div>)}</div>}</fieldset>)}
    <fieldset disabled={saving} className="tool-panel p-5 sm:p-6"><legend className="text-base font-semibold">{text.credits}</legend>
      <p id="ai-credits-help" className="text-sm leading-6 text-ink-secondary">{text.credits_help}</p>
      <div className="admin-settings-fields mt-4">{AI_CREDIT_SERVICES.map((service) => {
        const path = `settings.creditPrices.${service}`
        return <div key={service}><label className="mb-2 block text-sm" htmlFor={`ai-credit-${service}`}>{copy.balance.services[service]}</label>
          <input id={`ai-credit-${service}`} name={`creditPrices.${service}`} inputMode="decimal" maxLength={10} value={data.settings.creditPrices[service] ?? ''}
            onChange={(event) => { update('creditPrices', { ...data.settings.creditPrices, [service]: event.currentTarget.value === '' ? null : event.currentTarget.value }); change(path) }}
            className={inputClassName(Boolean(issues[path]))} {...a11y(path, 'ai-credits-help')} />{fieldError(path)}</div>
      })}</div>
    </fieldset>
    <section className="tool-panel p-5 sm:p-6"><label className="block" htmlFor="ai-reason"><span className="mb-2 block text-sm">{text.reason}</span></label><input id="ai-reason" name="reason" value={reason} disabled={saving} onChange={(event) => { setReason(event.currentTarget.value); change('reason') }} minLength={2} maxLength={500} required className={inputClassName(Boolean(issues.reason))} {...a11y('reason')} /><span className="mt-1 block text-xs text-ink-muted">{text.reason_help}</span>{fieldError('reason')}</section>
    <div className="admin-savebar"><span className="text-sm text-ink-muted">{dirty ? '有待保存的修改' : '已与线上配置同步'}</span><button type="submit" disabled={saving} className="tool-primary-action">{saving ? text.saving : text.save}</button><button type="button" disabled={saving} onClick={reload} className="tool-secondary-action">{text.reload}</button></div>
  </form>
}
