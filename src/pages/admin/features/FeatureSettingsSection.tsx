import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SITE_FEATURE_QUERY_KEY } from '../../../lib/site-feature-context'
import { useAdminDraftQuery } from '../../../lib/admin-draft-query'
import { ApiError } from '../../../lib/api-client'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { AdminSiteFeatureSettingsV1, PausableSiteFeature, SiteFeatureKey } from '../../../lib/site-features'
import { computeEffectiveSiteFeatures, FEATURE_PAUSE_NOTICE_LIMIT, isPausableSiteFeature, METERED_BILLING_AVAILABLE, normalizeSiteFeatureSettings, PAUSABLE_SITE_FEATURES } from '../../../lib/site-features'
import { copy } from '../../../copy/index'
import { SectionLoader } from '../../../components/SessionLoader'
import { AdminToast } from '../shared/AdminToast'
import SklandIcon from '../../../components/SklandIcon'
import { AdminTabs } from '../shared/AdminTabs'

type FeatureSettingsResponse = {
  settings?: AdminSiteFeatureSettingsV1
}

const GROUPS: Array<{ label: string; features: SiteFeatureKey[] }> = [
  { label: copy.features.admin_groups.site, features: ['site'] },
  { label: copy.features.admin_groups.account, features: ['registration', 'login', 'profiles', 'cdk_redemption', 'free_preview', 'skland'] },
  { label: copy.features.admin_groups.pages, features: ['v2', 'v1', 'faq', 'support', 'pricing', 'changelog', 'thanks', 'service_status'] },
  { label: copy.features.admin_groups.scheduling, features: ['schedule_generation', 'one_shift_per_day', 'scenario_comparison', 'metered_billing'] },
  { label: copy.features.admin_groups.assistants, features: ['ai_credits', 'ai_schedule_explanation', 'schedule_explanation_avatar', 'ai_goal_comparison', 'ai_cultivation_advisor', 'workspace_page_help', 'ai_change_summary'] },
  { label: copy.features.admin_groups.tools, features: ['tools', 'manual_schedule', 'schedule_comparison', 'cultivation_plan', 'cultivation_projects', 'training_ratio', 'thanks_recruitment', 'material_demand', 'depot_value', 'building_rating_radar'] },
  { label: copy.features.admin_groups.exports, features: ['maa_export', 'full_result_export'] },
  { label: copy.features.admin_groups.community, features: ['invitations', 'inventory', 'onboarding_tasks', 'announcements', 'notifications', 'website_events', 'qqbot'] },
]

export default function FeatureSettingsSection() {
  const [groupId, setGroupId] = useState('registration')
  const [settings, setSettings] = useState<AdminSiteFeatureSettingsV1 | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [writeError, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [invalidNotice, setInvalidNotice] = useState<PausableSiteFeature | null>(null)
  const effective = settings ? computeEffectiveSiteFeatures(settings) : null
  const text = copy.features.admin_availability

  const applyResponse = useCallback((data: FeatureSettingsResponse) => {
    if (!data.settings) throw new Error(copy.features.admin_load_failed)
    const nextSettings = { ...normalizeSiteFeatureSettings(data.settings), revision: data.settings.revision }
    setSettings(nextSettings)
    setInvalidNotice(null)
    setDirty(false)
    setConflict(false)
  }, [])

  const client = useQueryClient()
  const query = useAdminDraftQuery('features', '/api/admin/feature-settings', applyResponse)
  const loading = query.isFetching
  const error = writeError ?? query.error?.message
  const load = () => { setError(null); return query.load() }

  const toggle = (feature: SiteFeatureKey, checked: boolean, pauseNotice?: string) => {
    setSettings((current) => {
      if (!current) return current
      const next = { ...current, features: { ...current.features, [feature]: checked } }
      if (isPausableSiteFeature(feature) && (pauseNotice !== undefined || next.pause_notices?.[feature] !== undefined)) {
        next.pause_notices = { ...next.pause_notices }
        if (pauseNotice === undefined) delete next.pause_notices[feature]
        else next.pause_notices[feature] = pauseNotice
      }
      return next
    })
    if (feature === invalidNotice && (pauseNotice === undefined || pauseNotice.trim())) setInvalidNotice(null)
    setDirty(true)
    setConflict(false)
    setNotice(null)
  }

  const save = async () => {
    if (!settings) return
    const empty = PAUSABLE_SITE_FEATURES.find((feature) => settings.pause_notices?.[feature]?.trim() === '')
    if (empty) {
      setInvalidNotice(empty)
      setGroupId(GROUPS.find((group) => group.features.includes(empty))!.features[0])
      requestAnimationFrame(() => document.getElementById(`pause-notice-${empty}`)?.focus())
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const data = await adminApiJson<FeatureSettingsResponse>('/api/admin/feature-settings', {
        method: 'PUT',
        json: { features: settings.features, expected_revision: settings.revision, ...(settings.pause_notices && { pause_notices: settings.pause_notices }) },
        fallbackMessage: copy.features.admin_save_failed,
      })
      await query.write(data)
      applyResponse(data)
      void client.invalidateQueries({ queryKey: SITE_FEATURE_QUERY_KEY, exact: true })
      setNotice(copy.features.admin_saved)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(true)
        setError(copy.features.admin_conflict)
      } else {
        setError((caught as Error).message)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <SectionLoader label={copy.features.admin_loading} />

  const reload = () => {
    if (dirty && !window.confirm(copy.features.admin_discard_confirm)) return
    void load()
  }

  if (!settings || !effective) {
    return (
      <section className="tool-panel p-5 sm:p-6">
        {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
        <button type="button" onClick={() => void load()} className="tool-secondary-action mt-4">{copy.features.admin_reload}</button>
      </section>
    )
  }

  return (
    <div className="admin-settings space-y-5">
      <section className="admin-settings-heading">
        <p className="tool-eyebrow">{copy.features.admin_nav}</p>
        <h2 className="mt-2 text-lg font-semibold text-ink-primary">{copy.features.admin_title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{copy.features.admin_description}</p>
        {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}
        {notice && <AdminToast message={notice} onDismiss={() => setNotice(null)} />}
      </section>

      <AdminTabs label="功能配置任务" items={GROUPS.map((group) => ({ id: group.features[0], label: group.label }))} value={groupId} onChange={setGroupId} />
      {GROUPS.map((group) => (
        <section key={group.label} hidden={group.features[0] !== groupId} role="tabpanel" className="tool-panel p-5 sm:p-6" aria-labelledby={`feature-group-${group.features[0]}`}>
          <h3 id={`feature-group-${group.features[0]}`} className="text-base font-semibold text-ink-primary">{group.label}</h3>
          {group.features.some(isPausableSiteFeature) && <p className="mt-2 text-sm leading-6 text-ink-secondary">{text.help}</p>}
          <div className="admin-settings-fields admin-feature-grid mt-4">
            {group.features.filter((feature) => feature !== 'metered_billing' || METERED_BILLING_AVAILABLE).map((feature) => {
              const rawEnabled = settings.features[feature]
              const effectiveEnabled = effective[feature]
              const label = copy.features.feature_labels[feature]
              const assistantHelp = feature in copy.features.admin_assistant_help
                ? copy.features.admin_assistant_help[feature as keyof typeof copy.features.admin_assistant_help]
                : null
              if (isPausableSiteFeature(feature)) {
                const pauseNotice = settings.pause_notices?.[feature]
                const mode = rawEnabled ? 'open' : pauseNotice === undefined ? 'hidden' : 'paused'
                const availableIfOpen = rawEnabled ? effectiveEnabled : computeEffectiveSiteFeatures({ ...settings, features: { ...settings.features, [feature]: true } })[feature]
                const fieldId = `pause-notice-${feature}`
                return <div key={feature} className="admin-feature-card" data-mode={mode}>
                  <div className="admin-feature-card-row">
                    <div className="min-w-0">
                      <label htmlFor={`feature-mode-${feature}`} className="block text-sm font-semibold text-ink-primary">{label}</label>
                      {assistantHelp && <p className="mt-1 text-xs leading-5 text-ink-secondary">{assistantHelp}</p>}
                    </div>
                    <select id={`feature-mode-${feature}`} name={feature} className="tool-field" value={mode} disabled={saving}
                      onChange={(event) => {
                        const next = event.currentTarget.value
                        toggle(feature, next === 'open', next === 'paused' ? '' : undefined)
                        if (feature === 'ai_schedule_explanation' && next === 'paused') toggle('schedule_explanation_avatar', true)
                      }}>
                      <option value="open">{text.open}</option>
                      <option value="hidden">{feature === 'ai_schedule_explanation' ? text.generation_off : text.hidden}</option>
                      <option value="paused">{text.paused}</option>
                    </select>
                  </div>
                  {!availableIfOpen && mode !== 'hidden' && <p className="text-xs leading-5 text-ink-secondary">{mode === 'paused' ? text.inherited : copy.features.admin_raw_on_effective_off}</p>}
                  {feature === 'ai_schedule_explanation' && mode === 'paused' && !settings.features.schedule_explanation_avatar && <p className="text-xs leading-5 text-ink-secondary">{text.avatar_hidden}</p>}
                  {mode === 'paused' && <div className="admin-feature-notice">
                    <label htmlFor={fieldId} className="text-xs font-semibold text-ink-primary">{text.notice_label(label)}</label>
                    <textarea id={fieldId} className="tool-field" rows={3} maxLength={FEATURE_PAUSE_NOTICE_LIMIT} required disabled={saving}
                      aria-describedby={invalidNotice === feature ? `${fieldId}-help ${fieldId}-error` : `${fieldId}-help`} aria-invalid={invalidNotice === feature || undefined}
                      value={pauseNotice} placeholder={text.notice_placeholder} onChange={(event) => toggle(feature, false, event.currentTarget.value)} />
                    <div className="admin-feature-notice-help text-xs text-ink-secondary"><span id={`${fieldId}-help`}>{text.notice_help}</span><span aria-hidden="true">{pauseNotice?.length ?? 0}/{FEATURE_PAUSE_NOTICE_LIMIT}</span></div>
                    {invalidNotice === feature && <p id={`${fieldId}-error`} className="text-xs text-error" role="alert">{text.notice_required}</p>}
                  </div>}
                </div>
              }
              return (
                <label key={feature} className="admin-feature-option">
                  <input
                    type="checkbox"
                    name={feature}
                    checked={rawEnabled}
                    disabled={saving}
                    onChange={(event) => toggle(feature, event.currentTarget.checked)}
                    className="mt-1 h-4 w-4 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <strong className="flex items-center gap-2 text-sm text-ink-primary">{feature === 'skland' && <SklandIcon />}{copy.features.feature_labels[feature]}</strong>
                    {(feature === 'v1' || assistantHelp) && <span className="mt-1 block text-xs leading-5 text-ink-secondary">{assistantHelp ?? copy.features.v1_migration.admin_help}</span>}
                    <span className={`mt-1 block text-xs ${effectiveEnabled ? 'text-success' : 'text-ink-muted'}`}>
                      {effectiveEnabled ? copy.features.admin_effective_on : rawEnabled ? copy.features.admin_raw_on_effective_off : copy.features.admin_effective_off}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </section>
      ))}

      <div className="admin-savebar"><span className="text-sm text-ink-muted">{dirty ? '有待保存的修改' : '已与线上配置同步'}</span>
        <button type="button" onClick={() => void save()} disabled={saving} className="tool-primary-action">
          {saving ? copy.features.admin_saving : copy.features.admin_save}
        </button>
        <button type="button" onClick={reload} disabled={saving} className="tool-secondary-action">
          {conflict ? copy.features.admin_reload_online : copy.features.admin_reload}
        </button>
        {settings.updated_at && <span className="self-center text-xs text-ink-muted">{copy.features.admin_updated_at}{new Date(settings.updated_at).toLocaleString('zh-CN')}</span>}
      </div>
    </div>
  )
}
