import { createContext, useCallback, useContext, useEffect, useState, type FormEvent } from 'react'
import { copy } from '../../../copy/index'
import { ApiError } from '../../../lib/api-client'
import { adminApiJson } from '../../../lib/admin-api-client'
import {
  PUBLIC_CONTENT_LIMITS,
  PUBLIC_PRICING_PLAN_IDS,
  formatPricingDiscountedPrice,
  publicContentDraftSchema,
  type AdminPublicContentSettingsV1,
  type PublicContentDraftV1,
  type PublicContentSettingsV1,
} from '../../../lib/public-content'
import { SortableMasterDetailList } from '../shared/SortableMasterDetailList'
import { AdminToast } from '../shared/AdminToast'

type TabId = 'qq' | 'purchase' | 'faq' | 'pricing' | 'thanks'
type EditSettings = (updater: (draft: AdminPublicContentSettingsV1) => void) => void
type FieldErrors = Record<string, string>

const ValidationContext = createContext<{
  fieldErrors: FieldErrors
  focusPath: string | null
  clearFieldError: (path: string) => void
}>({ fieldErrors: {}, focusPath: null, clearFieldError: () => undefined })

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'qq', label: copy.publicContent.admin_tab_qq },
  { id: 'purchase', label: copy.publicContent.admin_tab_purchase },
  { id: 'faq', label: copy.publicContent.admin_tab_faq },
  { id: 'pricing', label: copy.publicContent.admin_tab_pricing },
  { id: 'thanks', label: copy.publicContent.admin_tab_thanks },
]

export default function PublicContentSettingsSection() {
  const [settings, setSettings] = useState<AdminPublicContentSettingsV1 | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('qq')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const data = await adminApiJson<{ settings?: AdminPublicContentSettingsV1 }>('/api/admin/public-content', {
        fallbackMessage: copy.publicContent.admin_load_failed,
      })
      if (!data.settings) throw new Error(copy.publicContent.admin_load_failed)
      setSettings(data.settings)
      setDirty(false)
      setConflict(false)
      setFieldErrors({})
      setFocusPath(null)
    } catch (caught) {
      setSettings(null)
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const edit: EditSettings = (updater) => {
    setSettings((current) => {
      if (!current) return current
      const next = structuredClone(current)
      updater(next)
      return next
    })
    setDirty(true)
    setConflict(false)
    setNotice(null)
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settings) return
    setError(null)
    setNotice(null)
    const parsed = publicContentDraftSchema.safeParse(toDraft(settings))
    if (!parsed.success) {
      const nextErrors = issuesToFieldErrors(parsed.error.issues)
      const firstIssuePath = parsed.error.issues[0]?.path.map(String) ?? []
      const firstPath = firstIssuePath.join('.')
      const firstTarget = issueTargetPath(firstIssuePath)
      setFieldErrors(nextErrors)
      setFocusPath(firstPath)
      setActiveTab(tabForValidationPath(firstPath))
      focusValidationTarget(firstTarget)
      return
    }
    setFieldErrors({})
    setFocusPath(null)
    setSaving(true)
    try {
      const data = await adminApiJson<{ settings?: AdminPublicContentSettingsV1 }>('/api/admin/public-content', {
        method: 'PUT',
        json: { ...parsed.data, expected_revision: settings.revision },
        fallbackMessage: copy.publicContent.admin_save_failed,
      })
      if (!data.settings) throw new Error(copy.publicContent.admin_save_failed)
      setSettings(data.settings)
      setDirty(false)
      setConflict(false)
      setNotice(copy.publicContent.admin_saved)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(true)
        setError(copy.publicContent.admin_conflict)
      } else {
        setError((caught as Error).message || copy.publicContent.validation_invalid)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="tool-panel p-6 text-sm text-ink-secondary" role="status">{copy.publicContent.admin_loading}</div>

  if (!settings) {
    return (
      <section className="tool-panel p-5 sm:p-6">
        {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
        <button type="button" onClick={() => void load()} className="tool-secondary-action mt-4">{copy.publicContent.admin_reload}</button>
      </section>
    )
  }

  const clearFieldError = (path: string) => {
    setFieldErrors((current) => {
      if (!current[path]) return current
      const next = { ...current }
      delete next[path]
      return next
    })
  }

  const reload = () => {
    if (dirty && !window.confirm(copy.publicContent.admin_discard_confirm)) return
    void load()
  }

  return (
    <ValidationContext.Provider value={{ fieldErrors, focusPath, clearFieldError }}>
    <form noValidate onSubmit={save} className="space-y-5">
      <section className="tool-panel p-5 sm:p-6">
        <p className="tool-eyebrow">{copy.publicContent.admin_nav}</p>
        <h2 className="mt-2 text-lg font-semibold text-ink-primary">{copy.publicContent.admin_title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">{copy.publicContent.admin_description}</p>
        <div className="tool-alert mt-4" role="note">{copy.publicContent.admin_display_only_warning}</div>
        {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}</div>}
        {notice && <AdminToast message={notice} onDismiss={() => setNotice(null)} />}
      </section>

      <div className="tool-panel p-3">
        <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label={copy.publicContent.admin_tabs_label}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              id={`public-content-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`public-content-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`tool-nav-link shrink-0 px-4 ${activeTab === tab.id ? 'bg-surface-2 text-ink-primary' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <section
        id={`public-content-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`public-content-tab-${activeTab}`}
        tabIndex={0}
        className="space-y-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
      >
        {activeTab === 'qq' && <QqEditor settings={settings} edit={edit} />}
        {activeTab === 'purchase' && <PurchaseEditor settings={settings} edit={edit} />}
        {activeTab === 'faq' && <FaqEditor settings={settings} edit={edit} />}
        {activeTab === 'pricing' && <PricingEditor settings={settings} edit={edit} />}
        {activeTab === 'thanks' && <ThanksEditor settings={settings} edit={edit} />}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="tool-primary-action">
          {saving ? copy.publicContent.admin_saving : copy.publicContent.admin_save}
        </button>
        <button type="button" onClick={reload} disabled={saving} className="tool-secondary-action">
          {conflict ? copy.publicContent.admin_reload_online : copy.publicContent.admin_reload}
        </button>
        {settings.updated_at && <span className="text-xs text-ink-muted">{copy.publicContent.admin_updated_at}{new Date(settings.updated_at).toLocaleString('zh-CN')}</span>}
      </div>
    </form>
    </ValidationContext.Provider>
  )
}

function QqEditor({ settings, edit }: { settings: PublicContentSettingsV1; edit: EditSettings }) {
  return (
    <EditorPanel title={copy.publicContent.admin_tab_qq} description={copy.publicContent.admin_qq_description}>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField path="qq_group.name" id="public-content-qq-name" label={copy.publicContent.admin_qq_name} value={settings.qq_group.name} maxLength={80} onChange={(value) => edit((next) => { next.qq_group.name = value })} />
        <TextField path="qq_group.number" id="public-content-qq-number" label={copy.publicContent.admin_qq_number} value={settings.qq_group.number} maxLength={12} inputMode="numeric" onChange={(value) => edit((next) => { next.qq_group.number = value })} />
        <TextField path="qq_group.link_label" id="public-content-qq-label" label={copy.publicContent.admin_qq_link_label} value={settings.qq_group.link_label} maxLength={80} onChange={(value) => edit((next) => { next.qq_group.link_label = value })} />
        <TextField path="qq_group.join_url" id="public-content-qq-url" label={copy.publicContent.admin_qq_url} value={settings.qq_group.join_url} maxLength={2048} type="url" onChange={(value) => edit((next) => { next.qq_group.join_url = value })} />
      </div>
    </EditorPanel>
  )
}

function PurchaseEditor({ settings, edit }: { settings: PublicContentSettingsV1; edit: EditSettings }) {
  return (
    <EditorPanel title={copy.publicContent.admin_tab_purchase} description={copy.publicContent.admin_purchase_description}>
      <TextField
        path="cdk_purchase.xianyu_url"
        id="public-content-xianyu-url"
        label={copy.publicContent.admin_xianyu_url}
        value={settings.cdk_purchase.xianyu_url}
        maxLength={2048}
        type="url"
        required={false}
        onChange={(value) => edit((next) => { next.cdk_purchase.xianyu_url = value })}
      />
    </EditorPanel>
  )
}

function FaqEditor({ settings, edit }: { settings: PublicContentSettingsV1; edit: EditSettings }) {
  const { focusPath } = useContext(ValidationContext)
  const itemSelectionIds = masterSelectionIds(settings.faq.items)
  const [selectedId, setSelectedId] = useSelectedId(itemSelectionIds)
  const selectedIndex = itemSelectionIds.indexOf(selectedId ?? '')
  const selected = selectedIndex >= 0 ? settings.faq.items[selectedIndex] : null

  useEffect(() => {
    const index = validationArrayIndex(focusPath, 'faq.items')
    if (index !== null && itemSelectionIds[index]) setSelectedId(itemSelectionIds[index])
  }, [focusPath, itemSelectionIds, setSelectedId])

  const addItem = () => {
    const id = newId('faq')
    edit((next) => { next.faq.items.push({ id, question: '', answer: '', action: 'none' }) })
    setSelectedId(id)
  }

  const deleteSelected = () => {
    if (selectedIndex < 0) return
    const nextSelected = selectionAfterDelete(itemSelectionIds, selectedIndex)
    edit((next) => { next.faq.items.splice(selectedIndex, 1) })
    setSelectedId(nextSelected)
  }

  return (
    <>
      <EditorPanel title={copy.publicContent.admin_tab_faq}>
        <PageFields prefix="faq" page={settings.faq} edit={(field, value) => edit((next) => { next.faq[field] = value })} />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TextField path="faq.cta_heading" id="faq-cta-heading" label={copy.publicContent.admin_faq_cta_heading} value={settings.faq.cta_heading} maxLength={120} onChange={(value) => edit((next) => { next.faq.cta_heading = value })} />
          <TextareaField path="faq.cta_body" id="faq-cta-body" label={copy.publicContent.admin_faq_cta_body} value={settings.faq.cta_body} maxLength={1000} onChange={(value) => edit((next) => { next.faq.cta_body = value })} />
        </div>
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_faq_items} description={copy.publicContent.admin_list_order_help} action={<CollectionAddAction path="faq.items" count={settings.faq.items.length} limit={PUBLIC_CONTENT_LIMITS.faqItems} label={copy.publicContent.admin_add_faq} onAdd={addItem} />}>
        <SortableMasterDetailList
          items={settings.faq.items.map((item, index) => ({ id: itemSelectionIds[index], title: item.question, description: item.answer }))}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onReorder={(from, to) => edit((next) => { next.faq.items = moveItem(next.faq.items, from, to) })}
          ariaLabel={copy.publicContent.admin_faq_items}
          detail={selected ? (
            <div className="tool-inset p-5">
              <ListActions index={selectedIndex} length={settings.faq.items.length} onMove={(target) => edit((next) => { next.faq.items = moveItem(next.faq.items, selectedIndex, target) })} onDelete={deleteSelected} />
              <div className="mt-4 grid gap-4">
                <TextField path={`faq.items.${selectedIndex}.question`} id={`faq-question-${selected.id}`} label={copy.publicContent.admin_question} value={selected.question} maxLength={160} onChange={(value) => edit((next) => { next.faq.items[selectedIndex].question = value })} />
                <TextareaField path={`faq.items.${selectedIndex}.answer`} id={`faq-answer-${selected.id}`} label={copy.publicContent.admin_answer} value={selected.answer} maxLength={4000} onChange={(value) => edit((next) => { next.faq.items[selectedIndex].answer = value })} />
                <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink-secondary">
                  <input type="checkbox" checked={selected.action === 'qq_group'} onChange={(event) => edit((next) => { next.faq.items[selectedIndex].action = event.currentTarget.checked ? 'qq_group' : 'none' })} className="h-4 w-4 accent-brand-600" />
                  {copy.publicContent.admin_show_qq_action}
                </label>
              </div>
            </div>
          ) : <EmptyDetail />}
        />
      </EditorPanel>
    </>
  )
}

function PricingEditor({ settings, edit }: { settings: PublicContentSettingsV1; edit: EditSettings }) {
  const { focusPath } = useContext(ValidationContext)
  const disclosureIds = settings.pricing.disclosures.map((_item, index) => `disclosure-${index}`)
  const [selectedDisclosureId, setSelectedDisclosureId] = useSelectedId(disclosureIds)
  const selectedDisclosureIndex = disclosureIds.indexOf(selectedDisclosureId ?? '')
  const selectedDisclosure = selectedDisclosureIndex >= 0 ? settings.pricing.disclosures[selectedDisclosureIndex] : null
  const comparisonSelectionIds = masterSelectionIds(settings.pricing.comparison_rows)
  const [selectedComparisonId, setSelectedComparisonId] = useSelectedId(comparisonSelectionIds)
  const selectedComparisonIndex = comparisonSelectionIds.indexOf(selectedComparisonId ?? '')
  const selectedComparison = selectedComparisonIndex >= 0 ? settings.pricing.comparison_rows[selectedComparisonIndex] : null

  useEffect(() => {
    const disclosureIndex = validationArrayIndex(focusPath, 'pricing.disclosures')
    if (disclosureIndex !== null && settings.pricing.disclosures[disclosureIndex] !== undefined) {
      setSelectedDisclosureId(`disclosure-${disclosureIndex}`)
    }
    const comparisonIndex = validationArrayIndex(focusPath, 'pricing.comparison_rows')
    if (comparisonIndex !== null && comparisonSelectionIds[comparisonIndex]) {
      setSelectedComparisonId(comparisonSelectionIds[comparisonIndex])
    }
  }, [comparisonSelectionIds, focusPath, setSelectedComparisonId, setSelectedDisclosureId, settings.pricing.disclosures])

  const addDisclosure = () => {
    const index = settings.pricing.disclosures.length
    edit((next) => { next.pricing.disclosures.push('') })
    setSelectedDisclosureId(`disclosure-${index}`)
  }

  const deleteDisclosure = () => {
    if (selectedDisclosureIndex < 0) return
    const remainingLength = settings.pricing.disclosures.length - 1
    const nextIndex = Math.min(selectedDisclosureIndex, remainingLength - 1)
    edit((next) => { next.pricing.disclosures.splice(selectedDisclosureIndex, 1) })
    setSelectedDisclosureId(nextIndex >= 0 ? `disclosure-${nextIndex}` : null)
  }

  const addComparison = () => {
    const id = newId('comparison')
    edit((next) => {
      next.pricing.comparison_rows.push({
        id,
        feature: '',
        ...Object.fromEntries(PUBLIC_PRICING_PLAN_IDS.map((planId) => [planId, ''])),
      } as typeof next.pricing.comparison_rows[number])
    })
    setSelectedComparisonId(id)
  }

  const deleteComparison = () => {
    if (selectedComparisonIndex < 0) return
    const nextSelected = selectionAfterDelete(comparisonSelectionIds, selectedComparisonIndex)
    edit((next) => { next.pricing.comparison_rows.splice(selectedComparisonIndex, 1) })
    setSelectedComparisonId(nextSelected)
  }

  return (
    <>
      <EditorPanel title={copy.publicContent.admin_tab_pricing} description={copy.publicContent.admin_display_only_warning}>
        <PageFields prefix="pricing" page={settings.pricing} edit={(field, value) => edit((next) => { next.pricing[field] = value })} />
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_pricing_plans} description={copy.publicContent.admin_pricing_plans_description}>
        <div className="grid gap-4 xl:grid-cols-2">
          {PUBLIC_PRICING_PLAN_IDS.map((planId) => {
            const plan = settings.pricing.plans[planId]
            return (
              <fieldset key={planId} className="tool-inset p-4">
                <legend className="px-2 text-base font-semibold text-ink-primary">{plan.label}</legend>
                <div className="grid gap-4">
                  <TextField path={`pricing.plans.${planId}.label`} id={`${planId}-label`} label={copy.publicContent.admin_plan_label} value={plan.label} maxLength={80} onChange={(value) => edit((next) => { next.pricing.plans[planId].label = value })} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField path={`pricing.plans.${planId}.badge`} id={`${planId}-badge`} label={copy.publicContent.admin_plan_badge} value={plan.badge} maxLength={40} onChange={(value) => edit((next) => { next.pricing.plans[planId].badge = value })} />
                    <TextField
                      path={`pricing.plans.${planId}.original_price`}
                      id={`${planId}-original-price`}
                      label={copy.publicContent.admin_plan_original_price}
                      value={plan.original_price}
                      maxLength={40}
                      onChange={(value) => edit((next) => {
                        const target = next.pricing.plans[planId]
                        target.original_price = value
                        target.display_price = formatPricingDiscountedPrice(value, target.discount_fold)
                      })}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      path={`pricing.plans.${planId}.discount_fold`}
                      id={`${planId}-discount-fold`}
                      label={copy.publicContent.admin_plan_discount_fold}
                      value={String(plan.discount_fold)}
                      maxLength={2}
                      type="number"
                      inputMode="numeric"
                      onChange={(value) => edit((next) => {
                        const target = next.pricing.plans[planId]
                        const parsed = value.trim() === '' ? Number.NaN : Number(value)
                        target.discount_fold = parsed
                        target.display_price = formatPricingDiscountedPrice(target.original_price, parsed)
                      })}
                    />
                    <div className="flex items-end">
                      <p className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2.5 text-sm leading-6 text-ink-secondary">
                        <span className="font-medium text-ink-primary">{copy.publicContent.admin_plan_effective_price}</span>
                        <span className="ml-2 tabular-nums text-brand-400">{plan.display_price}</span>
                      </p>
                    </div>
                  </div>
                  <TextareaField path={`pricing.plans.${planId}.summary`} id={`${planId}-summary`} label={copy.publicContent.admin_plan_summary} value={plan.summary} maxLength={1000} onChange={(value) => edit((next) => { next.pricing.plans[planId].summary = value })} />
                  <TextareaField path={`pricing.plans.${planId}.account_scope`} id={`${planId}-scope`} label={copy.publicContent.admin_plan_scope} value={plan.account_scope} maxLength={500} onChange={(value) => edit((next) => { next.pricing.plans[planId].account_scope = value })} />
                </div>
              </fieldset>
            )
          })}
        </div>
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_disclosures} description={copy.publicContent.admin_list_order_help} action={<CollectionAddAction path="pricing.disclosures" count={settings.pricing.disclosures.length} limit={PUBLIC_CONTENT_LIMITS.pricingDisclosures} label={copy.publicContent.admin_add_disclosure} onAdd={addDisclosure} />}>
        <TextField path="pricing.policy_heading" id="pricing-policy-heading" label={copy.publicContent.admin_policy_heading} value={settings.pricing.policy_heading} maxLength={120} onChange={(value) => edit((next) => { next.pricing.policy_heading = value })} />
        <div className="mt-4">
          <SortableMasterDetailList
            items={settings.pricing.disclosures.map((item, index) => ({ id: `disclosure-${index}`, title: item }))}
            selectedId={selectedDisclosureId}
            onSelect={setSelectedDisclosureId}
            onReorder={(from, to) => {
              edit((next) => { next.pricing.disclosures = moveItem(next.pricing.disclosures, from, to) })
              setSelectedDisclosureId(`disclosure-${to}`)
            }}
            ariaLabel={copy.publicContent.admin_disclosures}
            detail={selectedDisclosure !== null ? (
              <div className="tool-inset p-5">
                <ListActions
                  index={selectedDisclosureIndex}
                  length={settings.pricing.disclosures.length}
                  onMove={(target) => {
                    edit((next) => { next.pricing.disclosures = moveItem(next.pricing.disclosures, selectedDisclosureIndex, target) })
                    setSelectedDisclosureId(`disclosure-${target}`)
                  }}
                  onDelete={deleteDisclosure}
                />
                <div className="mt-4">
                  <TextareaField path={`pricing.disclosures.${selectedDisclosureIndex}`} id={`pricing-disclosure-${selectedDisclosureIndex}`} label={`${copy.publicContent.admin_disclosures} ${selectedDisclosureIndex + 1}`} value={selectedDisclosure} maxLength={500} onChange={(value) => edit((next) => { next.pricing.disclosures[selectedDisclosureIndex] = value })} />
                </div>
              </div>
            ) : <EmptyDetail />}
          />
        </div>
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_comparison_rows} description={copy.publicContent.admin_list_order_help} action={<CollectionAddAction path="pricing.comparison_rows" count={settings.pricing.comparison_rows.length} limit={PUBLIC_CONTENT_LIMITS.pricingComparisonRows} label={copy.publicContent.admin_add_comparison} onAdd={addComparison} />}>
        <TextField path="pricing.comparison_heading" id="pricing-comparison-heading" label={copy.publicContent.admin_comparison_heading} value={settings.pricing.comparison_heading} maxLength={120} onChange={(value) => edit((next) => { next.pricing.comparison_heading = value })} />
        <div className="mt-4">
          <SortableMasterDetailList
            items={settings.pricing.comparison_rows.map((row, index) => ({ id: comparisonSelectionIds[index], title: row.feature, description: PUBLIC_PRICING_PLAN_IDS.map((planId) => row[planId] ?? '').filter(Boolean).join(' / ') }))}
            selectedId={selectedComparisonId}
            onSelect={setSelectedComparisonId}
            onReorder={(from, to) => edit((next) => { next.pricing.comparison_rows = moveItem(next.pricing.comparison_rows, from, to) })}
            ariaLabel={copy.publicContent.admin_comparison_rows}
            detail={selectedComparison ? (
              <div className="tool-inset p-5">
                <ListActions index={selectedComparisonIndex} length={settings.pricing.comparison_rows.length} onMove={(target) => edit((next) => { next.pricing.comparison_rows = moveItem(next.pricing.comparison_rows, selectedComparisonIndex, target) })} onDelete={deleteComparison} />
                <div className="mt-4 grid gap-4">
                  <TextField path={`pricing.comparison_rows.${selectedComparisonIndex}.feature`} id={`comparison-feature-${selectedComparison.id}`} label={copy.publicContent.admin_feature_name} value={selectedComparison.feature} maxLength={120} onChange={(value) => edit((next) => { next.pricing.comparison_rows[selectedComparisonIndex].feature = value })} />
                  <div className="grid gap-4 lg:grid-cols-2">
                    {PUBLIC_PRICING_PLAN_IDS.map((planId) => {
                      const plan = settings.pricing.plans[planId]
                      return <TextareaField
                        key={planId}
                        path={`pricing.comparison_rows.${selectedComparisonIndex}.${planId}`}
                        id={`comparison-${planId}-${selectedComparison.id}`}
                        label={plan.label}
                        value={selectedComparison[planId] ?? ''}
                        maxLength={1000}
                        onChange={(value) => edit((next) => { next.pricing.comparison_rows[selectedComparisonIndex][planId] = value })}
                      />
                    })}
                  </div>
                </div>
              </div>
            ) : <EmptyDetail />}
          />
        </div>
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_support_heading}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField path="pricing.support_heading" id="pricing-support-heading" label={copy.publicContent.admin_support_heading} value={settings.pricing.support_heading} maxLength={120} onChange={(value) => edit((next) => { next.pricing.support_heading = value })} />
          <TextareaField path="pricing.support_body" id="pricing-support-body" label={copy.publicContent.admin_support_body} value={settings.pricing.support_body} maxLength={1000} onChange={(value) => edit((next) => { next.pricing.support_body = value })} />
        </div>
      </EditorPanel>
    </>
  )
}

function ThanksEditor({ settings, edit }: { settings: PublicContentSettingsV1; edit: EditSettings }) {
  const { focusPath } = useContext(ValidationContext)
  const sectionSelectionIds = masterSelectionIds(settings.thanks.sections)
  const [selectedSectionId, setSelectedSectionId] = useSelectedId(sectionSelectionIds)
  const selectedSectionIndex = sectionSelectionIds.indexOf(selectedSectionId ?? '')
  const selectedSection = selectedSectionIndex >= 0 ? settings.thanks.sections[selectedSectionIndex] : null

  useEffect(() => {
    const index = validationArrayIndex(focusPath, 'thanks.sections')
    if (index !== null && sectionSelectionIds[index]) setSelectedSectionId(sectionSelectionIds[index])
  }, [focusPath, sectionSelectionIds, setSelectedSectionId])

  const addSection = () => {
    const id = newId('section')
    edit((next) => { next.thanks.sections.push({ id, heading: '', intro: '', entries: [] }) })
    setSelectedSectionId(id)
  }

  const deleteSection = () => {
    if (selectedSectionIndex < 0) return
    const nextSelected = selectionAfterDelete(sectionSelectionIds, selectedSectionIndex)
    edit((next) => { next.thanks.sections.splice(selectedSectionIndex, 1) })
    setSelectedSectionId(nextSelected)
  }

  return (
    <>
      <EditorPanel title={copy.publicContent.admin_tab_thanks}>
        <PageFields prefix="thanks" page={settings.thanks} edit={(field, value) => edit((next) => { next.thanks[field] = value })} />
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_thanks_sections} description={copy.publicContent.admin_list_order_help} action={<CollectionAddAction path="thanks.sections" count={settings.thanks.sections.length} limit={PUBLIC_CONTENT_LIMITS.thanksSections} label={copy.publicContent.admin_add_section} onAdd={addSection} />}>
        <SortableMasterDetailList
          items={settings.thanks.sections.map((section, index) => ({ id: sectionSelectionIds[index], title: section.heading, description: section.intro, meta: `${section.entries.length} ${copy.publicContent.admin_entries}` }))}
          selectedId={selectedSectionId}
          onSelect={setSelectedSectionId}
          onReorder={(from, to) => edit((next) => { next.thanks.sections = moveItem(next.thanks.sections, from, to) })}
          ariaLabel={copy.publicContent.admin_thanks_sections}
          detail={selectedSection ? (
            <ThanksSectionDetail
              key={selectedSectionId}
              section={selectedSection}
              sectionIndex={selectedSectionIndex}
              sectionCount={settings.thanks.sections.length}
              edit={edit}
              onMoveSection={(target) => edit((next) => { next.thanks.sections = moveItem(next.thanks.sections, selectedSectionIndex, target) })}
              onDeleteSection={deleteSection}
            />
          ) : <EmptyDetail />}
        />
      </EditorPanel>
    </>
  )
}

function ThanksSectionDetail({ section, sectionIndex, sectionCount, edit, onMoveSection, onDeleteSection }: {
  section: PublicContentSettingsV1['thanks']['sections'][number]
  sectionIndex: number
  sectionCount: number
  edit: EditSettings
  onMoveSection: (target: number) => void
  onDeleteSection: () => void
}) {
  const { focusPath } = useContext(ValidationContext)
  const entrySelectionIds = masterSelectionIds(section.entries)
  const [selectedEntryId, setSelectedEntryId] = useSelectedId(entrySelectionIds)
  const selectedEntryIndex = entrySelectionIds.indexOf(selectedEntryId ?? '')
  const selectedEntry = selectedEntryIndex >= 0 ? section.entries[selectedEntryIndex] : null

  useEffect(() => {
    const index = validationArrayIndex(focusPath, `thanks.sections.${sectionIndex}.entries`)
    if (index !== null && entrySelectionIds[index]) setSelectedEntryId(entrySelectionIds[index])
  }, [entrySelectionIds, focusPath, sectionIndex, setSelectedEntryId])

  const addEntry = () => {
    const id = newId('entry')
    edit((next) => { next.thanks.sections[sectionIndex].entries.push({ id, name: '', description: '', url: '', avatar_url: '' }) })
    setSelectedEntryId(id)
  }

  const deleteEntry = () => {
    if (selectedEntryIndex < 0) return
    const nextSelected = selectionAfterDelete(entrySelectionIds, selectedEntryIndex)
    edit((next) => { next.thanks.sections[sectionIndex].entries.splice(selectedEntryIndex, 1) })
    setSelectedEntryId(nextSelected)
  }

  return (
    <div className="tool-inset p-5">
      <ListActions index={sectionIndex} length={sectionCount} onMove={onMoveSection} onDelete={onDeleteSection} />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <TextField path={`thanks.sections.${sectionIndex}.heading`} id={`thanks-heading-${section.id}`} label={copy.publicContent.admin_section_heading} value={section.heading} maxLength={120} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].heading = value })} />
        <TextareaField path={`thanks.sections.${sectionIndex}.intro`} id={`thanks-intro-${section.id}`} label={copy.publicContent.admin_section_intro} value={section.intro} maxLength={1000} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].intro = value })} />
      </div>
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-surface-3 pt-5">
        <h3 className="text-sm font-semibold text-ink-primary">{copy.publicContent.admin_entries}</h3>
        <CollectionAddAction path={`thanks.sections.${sectionIndex}.entries`} count={section.entries.length} limit={PUBLIC_CONTENT_LIMITS.thanksEntries} label={copy.publicContent.admin_add_entry} onAdd={addEntry} compact />
      </div>
      <div className="mt-3">
        <SortableMasterDetailList
          items={section.entries.map((entry, index) => ({ id: entrySelectionIds[index], title: entry.name, description: entry.description }))}
          selectedId={selectedEntryId}
          onSelect={setSelectedEntryId}
          onReorder={(from, to) => edit((next) => { next.thanks.sections[sectionIndex].entries = moveItem(next.thanks.sections[sectionIndex].entries, from, to) })}
          ariaLabel={copy.publicContent.admin_entries}
          detail={selectedEntry ? (
            <div className="rounded-xl border border-surface-3 p-4">
              <ListActions index={selectedEntryIndex} length={section.entries.length} onMove={(target) => edit((next) => { next.thanks.sections[sectionIndex].entries = moveItem(next.thanks.sections[sectionIndex].entries, selectedEntryIndex, target) })} onDelete={deleteEntry} />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <TextField path={`thanks.sections.${sectionIndex}.entries.${selectedEntryIndex}.name`} id={`thanks-name-${selectedEntry.id}`} label={copy.publicContent.admin_entry_name} value={selectedEntry.name} maxLength={120} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].entries[selectedEntryIndex].name = value })} />
                <TextField path={`thanks.sections.${sectionIndex}.entries.${selectedEntryIndex}.url`} id={`thanks-url-${selectedEntry.id}`} label={copy.publicContent.admin_entry_url} value={selectedEntry.url} maxLength={2048} type="url" required={false} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].entries[selectedEntryIndex].url = value })} />
                <TextField path={`thanks.sections.${sectionIndex}.entries.${selectedEntryIndex}.avatar_url`} id={`thanks-avatar-url-${selectedEntry.id}`} label={copy.publicContent.admin_entry_avatar_url} value={selectedEntry.avatar_url} maxLength={2048} type="url" required={false} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].entries[selectedEntryIndex].avatar_url = value })} />
                <div className="md:col-span-2">
                  <TextareaField path={`thanks.sections.${sectionIndex}.entries.${selectedEntryIndex}.description`} id={`thanks-description-${selectedEntry.id}`} label={copy.publicContent.admin_entry_description} value={selectedEntry.description} maxLength={1000} required={false} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].entries[selectedEntryIndex].description = value })} />
                </div>
              </div>
            </div>
          ) : <EmptyDetail />}
        />
      </div>
    </div>
  )
}

function PageFields({ prefix, page, edit }: {
  prefix: string
  page: { eyebrow: string; title: string; intro: string }
  edit: (field: 'eyebrow' | 'title' | 'intro', value: string) => void
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TextField path={`${prefix}.eyebrow`} id={`${prefix}-eyebrow`} label={copy.publicContent.admin_page_eyebrow} value={page.eyebrow} maxLength={80} onChange={(value) => edit('eyebrow', value)} />
      <TextField path={`${prefix}.title`} id={`${prefix}-title`} label={copy.publicContent.admin_page_title} value={page.title} maxLength={80} onChange={(value) => edit('title', value)} />
      <div className="md:col-span-2">
        <TextareaField path={`${prefix}.intro`} id={`${prefix}-intro`} label={copy.publicContent.admin_page_intro} value={page.intro} maxLength={1000} onChange={(value) => edit('intro', value)} />
      </div>
    </div>
  )
}

function EditorPanel({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="tool-panel p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink-primary">{title}</h2>
          {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-secondary">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function TextField({ path, id, label, value, maxLength, onChange, type = 'text', inputMode, required = true }: {
  path: string; id: string; label: string; value: string; maxLength: number; onChange: (value: string) => void; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; required?: boolean
}) {
  const { fieldErrors, clearFieldError } = useContext(ValidationContext)
  const error = fieldErrors[path]
  const errorId = `${id}-error`
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-sm font-medium text-ink-secondary">{label}{required && <RequiredMark />}</span>
      <input id={id} data-validation-path={path} value={value} type={type} inputMode={inputMode} maxLength={maxLength} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={(event) => { clearFieldError(path); onChange(event.currentTarget.value) }} className="tool-field" />
      {error && <p id={errorId} className="mt-1.5 text-sm text-error" role="alert">{error}</p>}
    </label>
  )
}

function TextareaField({ path, id, label, value, maxLength, required = true, onChange }: { path: string; id: string; label: string; value: string; maxLength: number; required?: boolean; onChange: (value: string) => void }) {
  const { fieldErrors, clearFieldError } = useContext(ValidationContext)
  const error = fieldErrors[path]
  const errorId = `${id}-error`
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-sm font-medium text-ink-secondary">{label}{required && <RequiredMark />}</span>
      <textarea id={id} data-validation-path={path} value={value} maxLength={maxLength} required={required} rows={4} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={(event) => { clearFieldError(path); onChange(event.currentTarget.value) }} className="tool-field min-h-28 resize-y" />
      {error && <p id={errorId} className="mt-1.5 text-sm text-error" role="alert">{error}</p>}
    </label>
  )
}

function CollectionAddAction({ path, count, limit, label, onAdd, compact = false }: {
  path: string
  count: number
  limit: number
  label: string
  onAdd: () => void
  compact?: boolean
}) {
  const { fieldErrors, clearFieldError } = useContext(ValidationContext)
  const reachedLimit = count >= limit
  const error = fieldErrors[path]
  const description = error ?? (reachedLimit ? copy.publicContent.admin_limit_reached(limit) : null)
  const descriptionId = `${path.replace(/\./g, '-')}-collection-error`
  return (
    <div className="text-right">
      <button
        type="button"
        data-validation-path={path}
        disabled={reachedLimit}
        aria-invalid={Boolean(error)}
        aria-describedby={description ? descriptionId : undefined}
        className={`tool-secondary-action ${compact ? 'px-3 text-sm' : ''}`}
        onClick={() => {
          clearFieldError(path)
          onAdd()
        }}
      >
        {label}
      </button>
      {description && <p id={descriptionId} className="mt-1 text-xs text-error" role={error ? 'alert' : undefined}>{description}</p>}
    </div>
  )
}

function RequiredMark() {
  return <><span className="ml-1 text-error" aria-hidden="true">*</span><span className="sr-only">（{copy.publicContent.admin_required}）</span></>
}

function ListActions({ index, length, onMove, onDelete }: { index: number; length: number; onMove: (target: number) => void; onDelete: () => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" disabled={index === 0} onClick={() => onMove(index - 1)} className="tool-secondary-action px-3 text-sm">{copy.publicContent.admin_move_up}</button>
      <button type="button" disabled={index === length - 1} onClick={() => onMove(index + 1)} className="tool-secondary-action px-3 text-sm">{copy.publicContent.admin_move_down}</button>
      <button type="button" onClick={onDelete} className="tool-secondary-action border-error/40 bg-error/10 px-3 text-sm text-error">{copy.publicContent.admin_delete}</button>
    </div>
  )
}

function EmptyDetail() {
  return <div className="tool-inset border-dashed p-6 text-sm text-ink-muted">{copy.publicContent.admin_select_item}</div>
}

function issuesToFieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code: string }>): FieldErrors {
  const errors: FieldErrors = {}
  for (const issue of issues) {
    const path = issue.path.map(String)
    const target = issueTargetPath(path)
    if (!errors[target]) {
      errors[target] = issue.code === 'custom' && path[path.length - 1] === 'id'
        ? copy.publicContent.admin_duplicate_id
        : issue.message
    }
  }
  return errors
}

function issueTargetPath(path: string[]): string {
  if (path[path.length - 1] !== 'id') return path.join('.') || 'public-content-form'
  let itemIndex = -1
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (/^\d+$/.test(path[index])) {
      itemIndex = index
      break
    }
  }
  return itemIndex >= 0 ? path.slice(0, itemIndex).join('.') : path.join('.')
}

function tabForValidationPath(path: string): TabId {
  if (path.startsWith('cdk_purchase.')) return 'purchase'
  if (path.startsWith('faq.')) return 'faq'
  if (path.startsWith('pricing.')) return 'pricing'
  if (path.startsWith('thanks.')) return 'thanks'
  return 'qq'
}

function validationArrayIndex(path: string | null, prefix: string): number | null {
  if (!path?.startsWith(`${prefix}.`)) return null
  const value = path.slice(prefix.length + 1).split('.')[0]
  return /^\d+$/.test(value) ? Number(value) : null
}

function focusValidationTarget(path: string): void {
  let attempts = 0
  const focus = () => {
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-validation-path]'))
      .find((element) => element.dataset.validationPath === path)
    if (target) {
      target.focus()
      return
    }
    attempts += 1
    if (attempts < 8) window.setTimeout(focus, 16)
  }
  window.setTimeout(focus, 0)
}

function useSelectedId(ids: string[]): [string | null, (id: string | null) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(() => ids[0] ?? null)
  useEffect(() => {
    if (selectedId && ids.includes(selectedId)) return
    setSelectedId(ids[0] ?? null)
  }, [ids, selectedId])
  return [selectedId, setSelectedId]
}

function selectionAfterDelete(ids: string[], deletedIndex: number): string | null {
  if (ids.length <= 1) return null
  return ids[Math.min(deletedIndex + 1, ids.length - 1)]
    ?? ids[Math.max(0, deletedIndex - 1)]
    ?? null
}

function masterSelectionIds(items: Array<{ id: string }>): string[] {
  const totals = new Map<string, number>()
  const occurrences = new Map<string, number>()
  for (const item of items) totals.set(item.id, (totals.get(item.id) ?? 0) + 1)
  return items.map((item) => {
    if (totals.get(item.id) === 1) return item.id
    const occurrence = occurrences.get(item.id) ?? 0
    occurrences.set(item.id, occurrence + 1)
    return `${item.id}::duplicate-${occurrence}`
  })
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function newId(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${uuid}`
}

function toDraft(settings: PublicContentSettingsV1): PublicContentDraftV1 {
  return {
    cdk_purchase: settings.cdk_purchase,
    qq_group: settings.qq_group,
    faq: settings.faq,
    pricing: settings.pricing,
    thanks: settings.thanks,
  }
}
