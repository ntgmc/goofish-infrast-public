import { useCallback, useEffect, useState } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { SiteFeatureKey, SiteFeatureSettingsV1, SiteFeatures } from '../../../lib/site-features'
import { DEFAULT_SITE_FEATURE_SETTINGS, computeEffectiveSiteFeatures } from '../../../lib/site-features'
import { copy } from '../../../copy/index'

type FeatureSettingsResponse = {
  settings?: SiteFeatureSettingsV1
  effective_features?: SiteFeatures
}

const GROUPS: Array<{ label: string; features: SiteFeatureKey[] }> = [
  { label: copy.features.admin_groups.site, features: ['site'] },
  { label: copy.features.admin_groups.account, features: ['registration', 'login', 'profiles', 'cdk_redemption', 'free_preview', 'skland'] },
  { label: copy.features.admin_groups.scheduling, features: ['schedule_generation'] },
  { label: copy.features.admin_groups.tools, features: ['tools', 'depot_value'] },
  { label: copy.features.admin_groups.community, features: ['invitations', 'inventory', 'onboarding_tasks', 'announcements'] },
]

export default function FeatureSettingsSection() {
  const [settings, setSettings] = useState<SiteFeatureSettingsV1>(DEFAULT_SITE_FEATURE_SETTINGS)
  const [effective, setEffective] = useState<SiteFeatures>(() => computeEffectiveSiteFeatures(DEFAULT_SITE_FEATURE_SETTINGS))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const applyResponse = useCallback((data: FeatureSettingsResponse) => {
    const nextSettings = data.settings ?? DEFAULT_SITE_FEATURE_SETTINGS
    setSettings(nextSettings)
    setEffective(data.effective_features ?? computeEffectiveSiteFeatures(nextSettings))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      applyResponse(await adminApiJson<FeatureSettingsResponse>('/api/admin/feature-settings', {
        fallbackMessage: copy.features.admin_load_failed,
      }))
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [applyResponse])

  useEffect(() => { void load() }, [load])

  const toggle = (feature: SiteFeatureKey, checked: boolean) => {
    setSettings((current) => {
      const next = { ...current, features: { ...current.features, [feature]: checked } }
      setEffective(computeEffectiveSiteFeatures(next))
      return next
    })
    setNotice(null)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      applyResponse(await adminApiJson<FeatureSettingsResponse>('/api/admin/feature-settings', {
        method: 'PUT',
        json: { features: settings.features },
        fallbackMessage: copy.features.admin_save_failed,
      }))
      setNotice(copy.features.admin_saved)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="tool-panel p-6 text-sm text-ink-secondary" role="status">{copy.features.admin_loading}</div>

  return (
    <div className="space-y-5">
      <section className="tool-panel p-5 sm:p-6">
        <p className="tool-eyebrow">{copy.features.admin_nav}</p>
        <h2 className="mt-2 text-lg font-semibold text-ink-primary">{copy.features.admin_title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{copy.features.admin_description}</p>
        {error && <div className="tool-alert tool-alert--error mt-5" role="alert">{error}</div>}
        {notice && <div className="tool-alert tool-alert--success mt-5" role="status">{notice}</div>}
      </section>

      {GROUPS.map((group) => (
        <section key={group.label} className="tool-panel p-5 sm:p-6" aria-labelledby={`feature-group-${group.features[0]}`}>
          <h3 id={`feature-group-${group.features[0]}`} className="text-base font-semibold text-ink-primary">{group.label}</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {group.features.map((feature) => {
              const rawEnabled = settings.features[feature]
              const effectiveEnabled = effective[feature]
              return (
                <label key={feature} className="tool-inset flex cursor-pointer items-start gap-3 p-4">
                  <input
                    type="checkbox"
                    checked={rawEnabled}
                    onChange={(event) => toggle(feature, event.currentTarget.checked)}
                    className="mt-1 h-4 w-4 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <strong className="block text-sm text-ink-primary">{copy.features.feature_labels[feature]}</strong>
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

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => void save()} disabled={saving} className="tool-primary-action">
          {saving ? copy.features.admin_saving : copy.features.admin_save}
        </button>
        <button type="button" onClick={() => void load()} disabled={saving} className="tool-secondary-action">{copy.features.admin_reload}</button>
        {settings.updated_at && <span className="self-center text-xs text-ink-muted">{copy.features.admin_updated_at}{new Date(settings.updated_at).toLocaleString('zh-CN')}</span>}
      </div>
    </div>
  )
}
