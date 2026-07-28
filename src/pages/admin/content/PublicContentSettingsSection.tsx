import { useCallback, useEffect, useState } from 'react'
import { copy } from '../../../copy/index'
import { adminApiJson } from '../../../lib/admin-api-client'
import {
  PUBLIC_PRICING_PLAN_IDS,
  parsePublicContentDraft,
  type PublicContentDraftV1,
  type PublicContentSettingsV1,
} from '../../../lib/public-content'
import { usePublicContent } from '../../../lib/public-content-context'
import { SortableMasterDetailList } from '../shared/SortableMasterDetailList'
import { AdminToast } from '../shared/AdminToast'

type TabId = 'qq' | 'faq' | 'pricing' | 'thanks'
type EditSettings = (updater: (draft: PublicContentSettingsV1) => void) => void

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'qq', label: copy.publicContent.admin_tab_qq },
  { id: 'faq', label: copy.publicContent.admin_tab_faq },
  { id: 'pricing', label: copy.publicContent.admin_tab_pricing },
  { id: 'thanks', label: copy.publicContent.admin_tab_thanks },
]

export default function PublicContentSettingsSection() {
  const { refresh } = usePublicContent()
  const [settings, setSettings] = useState<PublicContentSettingsV1 | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('qq')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const data = await adminApiJson<{ settings?: PublicContentSettingsV1 }>('/api/admin/public-content', {
        fallbackMessage: copy.publicContent.admin_load_failed,
      })
      if (!data.settings) throw new Error(copy.publicContent.admin_load_failed)
      setSettings(data.settings)
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
    setNotice(null)
  }

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const draft = parsePublicContentDraft(toDraft(settings))
      const data = await adminApiJson<{ settings?: PublicContentSettingsV1 }>('/api/admin/public-content', {
        method: 'PUT',
        json: draft,
        fallbackMessage: copy.publicContent.admin_save_failed,
      })
      if (!data.settings) throw new Error(copy.publicContent.admin_save_failed)
      setSettings(data.settings)
      setNotice(copy.publicContent.admin_saved)
      await refresh()
    } catch (caught) {
      setError((caught as Error).message || copy.publicContent.validation_invalid)
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

  return (
    <div className="space-y-5">
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
        {activeTab === 'faq' && <FaqEditor settings={settings} edit={edit} />}
        {activeTab === 'pricing' && <PricingEditor settings={settings} edit={edit} />}
        {activeTab === 'thanks' && <ThanksEditor settings={settings} edit={edit} />}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={saving} className="tool-primary-action">
          {saving ? copy.publicContent.admin_saving : copy.publicContent.admin_save}
        </button>
        <button type="button" onClick={() => void load()} disabled={saving} className="tool-secondary-action">{copy.publicContent.admin_reload}</button>
        {settings.updated_at && <span className="text-xs text-ink-muted">{copy.publicContent.admin_updated_at}{new Date(settings.updated_at).toLocaleString('zh-CN')}</span>}
      </div>
    </div>
  )
}

function QqEditor({ settings, edit }: { settings: PublicContentSettingsV1; edit: EditSettings }) {
  return (
    <EditorPanel title={copy.publicContent.admin_tab_qq} description={copy.publicContent.admin_qq_description}>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField id="public-content-qq-name" label={copy.publicContent.admin_qq_name} value={settings.qq_group.name} maxLength={80} onChange={(value) => edit((next) => { next.qq_group.name = value })} />
        <TextField id="public-content-qq-number" label={copy.publicContent.admin_qq_number} value={settings.qq_group.number} maxLength={12} inputMode="numeric" onChange={(value) => edit((next) => { next.qq_group.number = value })} />
        <TextField id="public-content-qq-label" label={copy.publicContent.admin_qq_link_label} value={settings.qq_group.link_label} maxLength={80} onChange={(value) => edit((next) => { next.qq_group.link_label = value })} />
        <TextField id="public-content-qq-url" label={copy.publicContent.admin_qq_url} value={settings.qq_group.join_url} maxLength={2048} type="url" onChange={(value) => edit((next) => { next.qq_group.join_url = value })} />
      </div>
    </EditorPanel>
  )
}

function FaqEditor({ settings, edit }: { settings: PublicContentSettingsV1; edit: EditSettings }) {
  const [selectedId, setSelectedId] = useSelectedId(settings.faq.items.map((item) => item.id))
  const selectedIndex = settings.faq.items.findIndex((item) => item.id === selectedId)
  const selected = selectedIndex >= 0 ? settings.faq.items[selectedIndex] : null

  const addItem = () => {
    const id = newId('faq')
    edit((next) => { next.faq.items.push({ id, question: '', answer: '', action: 'none' }) })
    setSelectedId(id)
  }

  const deleteSelected = () => {
    if (selectedIndex < 0) return
    const nextSelected = selectionAfterDelete(settings.faq.items, selectedIndex)
    edit((next) => { next.faq.items.splice(selectedIndex, 1) })
    setSelectedId(nextSelected)
  }

  return (
    <>
      <EditorPanel title={copy.publicContent.admin_tab_faq}>
        <PageFields prefix="faq" page={settings.faq} edit={(field, value) => edit((next) => { next.faq[field] = value })} />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <TextField id="faq-cta-heading" label={copy.publicContent.admin_faq_cta_heading} value={settings.faq.cta_heading} maxLength={120} onChange={(value) => edit((next) => { next.faq.cta_heading = value })} />
          <TextareaField id="faq-cta-body" label={copy.publicContent.admin_faq_cta_body} value={settings.faq.cta_body} maxLength={1000} onChange={(value) => edit((next) => { next.faq.cta_body = value })} />
        </div>
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_faq_items} description={copy.publicContent.admin_list_order_help} action={<button type="button" className="tool-secondary-action" onClick={addItem}>{copy.publicContent.admin_add_faq}</button>}>
        <SortableMasterDetailList
          items={settings.faq.items.map((item) => ({ id: item.id, title: item.question, description: item.answer }))}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onReorder={(from, to) => edit((next) => { next.faq.items = moveItem(next.faq.items, from, to) })}
          ariaLabel={copy.publicContent.admin_faq_items}
          detail={selected ? (
            <div className="tool-inset p-5">
              <ListActions index={selectedIndex} length={settings.faq.items.length} onMove={(target) => edit((next) => { next.faq.items = moveItem(next.faq.items, selectedIndex, target) })} onDelete={deleteSelected} />
              <div className="mt-4 grid gap-4">
                <TextField id={`faq-question-${selected.id}`} label={copy.publicContent.admin_question} value={selected.question} maxLength={160} onChange={(value) => edit((next) => { next.faq.items[selectedIndex].question = value })} />
                <TextareaField id={`faq-answer-${selected.id}`} label={copy.publicContent.admin_answer} value={selected.answer} maxLength={4000} onChange={(value) => edit((next) => { next.faq.items[selectedIndex].answer = value })} />
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
  const disclosureIds = settings.pricing.disclosures.map((_item, index) => `disclosure-${index}`)
  const [selectedDisclosureId, setSelectedDisclosureId] = useSelectedId(disclosureIds)
  const selectedDisclosureIndex = disclosureIds.indexOf(selectedDisclosureId ?? '')
  const selectedDisclosure = selectedDisclosureIndex >= 0 ? settings.pricing.disclosures[selectedDisclosureIndex] : null
  const [selectedComparisonId, setSelectedComparisonId] = useSelectedId(settings.pricing.comparison_rows.map((row) => row.id))
  const selectedComparisonIndex = settings.pricing.comparison_rows.findIndex((row) => row.id === selectedComparisonId)
  const selectedComparison = selectedComparisonIndex >= 0 ? settings.pricing.comparison_rows[selectedComparisonIndex] : null

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
    edit((next) => { next.pricing.comparison_rows.push({ id, feature: '', free_preview: '', single_account_lifetime: '' }) })
    setSelectedComparisonId(id)
  }

  const deleteComparison = () => {
    if (selectedComparisonIndex < 0) return
    const nextSelected = selectionAfterDelete(settings.pricing.comparison_rows, selectedComparisonIndex)
    edit((next) => { next.pricing.comparison_rows.splice(selectedComparisonIndex, 1) })
    setSelectedComparisonId(nextSelected)
  }

  return (
    <>
      <EditorPanel title={copy.publicContent.admin_tab_pricing} description={copy.publicContent.admin_display_only_warning}>
        <PageFields prefix="pricing" page={settings.pricing} edit={(field, value) => edit((next) => { next.pricing[field] = value })} />
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_pricing_plans}>
        <div className="grid gap-4 xl:grid-cols-2">
          {PUBLIC_PRICING_PLAN_IDS.map((planId) => {
            const plan = settings.pricing.plans[planId]
            return (
              <fieldset key={planId} className="tool-inset p-4">
                <legend className="px-2 text-base font-semibold text-ink-primary">{plan.label}</legend>
                <div className="grid gap-4">
                  <TextField id={`${planId}-label`} label={copy.publicContent.admin_plan_label} value={plan.label} maxLength={80} onChange={(value) => edit((next) => { next.pricing.plans[planId].label = value })} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField id={`${planId}-badge`} label={copy.publicContent.admin_plan_badge} value={plan.badge} maxLength={40} onChange={(value) => edit((next) => { next.pricing.plans[planId].badge = value })} />
                    <TextField id={`${planId}-price`} label={copy.publicContent.admin_plan_price} value={plan.display_price} maxLength={40} onChange={(value) => edit((next) => { next.pricing.plans[planId].display_price = value })} />
                  </div>
                  <TextareaField id={`${planId}-summary`} label={copy.publicContent.admin_plan_summary} value={plan.summary} maxLength={1000} onChange={(value) => edit((next) => { next.pricing.plans[planId].summary = value })} />
                  <TextareaField id={`${planId}-scope`} label={copy.publicContent.admin_plan_scope} value={plan.account_scope} maxLength={500} onChange={(value) => edit((next) => { next.pricing.plans[planId].account_scope = value })} />
                </div>
              </fieldset>
            )
          })}
        </div>
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_disclosures} description={copy.publicContent.admin_list_order_help} action={<button type="button" className="tool-secondary-action" onClick={addDisclosure}>{copy.publicContent.admin_add_disclosure}</button>}>
        <TextField id="pricing-policy-heading" label={copy.publicContent.admin_policy_heading} value={settings.pricing.policy_heading} maxLength={120} onChange={(value) => edit((next) => { next.pricing.policy_heading = value })} />
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
                  <TextareaField id={`pricing-disclosure-${selectedDisclosureIndex}`} label={`${copy.publicContent.admin_disclosures} ${selectedDisclosureIndex + 1}`} value={selectedDisclosure} maxLength={500} onChange={(value) => edit((next) => { next.pricing.disclosures[selectedDisclosureIndex] = value })} />
                </div>
              </div>
            ) : <EmptyDetail />}
          />
        </div>
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_comparison_rows} description={copy.publicContent.admin_list_order_help} action={<button type="button" className="tool-secondary-action" onClick={addComparison}>{copy.publicContent.admin_add_comparison}</button>}>
        <TextField id="pricing-comparison-heading" label={copy.publicContent.admin_comparison_heading} value={settings.pricing.comparison_heading} maxLength={120} onChange={(value) => edit((next) => { next.pricing.comparison_heading = value })} />
        <div className="mt-4">
          <SortableMasterDetailList
            items={settings.pricing.comparison_rows.map((row) => ({ id: row.id, title: row.feature, description: `${row.free_preview} / ${row.single_account_lifetime}` }))}
            selectedId={selectedComparisonId}
            onSelect={setSelectedComparisonId}
            onReorder={(from, to) => edit((next) => { next.pricing.comparison_rows = moveItem(next.pricing.comparison_rows, from, to) })}
            ariaLabel={copy.publicContent.admin_comparison_rows}
            detail={selectedComparison ? (
              <div className="tool-inset p-5">
                <ListActions index={selectedComparisonIndex} length={settings.pricing.comparison_rows.length} onMove={(target) => edit((next) => { next.pricing.comparison_rows = moveItem(next.pricing.comparison_rows, selectedComparisonIndex, target) })} onDelete={deleteComparison} />
                <div className="mt-4 grid gap-4">
                  <TextField id={`comparison-feature-${selectedComparison.id}`} label={copy.publicContent.admin_feature_name} value={selectedComparison.feature} maxLength={120} onChange={(value) => edit((next) => { next.pricing.comparison_rows[selectedComparisonIndex].feature = value })} />
                  <div className="grid gap-4 lg:grid-cols-2">
                    <TextareaField id={`comparison-free-${selectedComparison.id}`} label={copy.publicContent.admin_free_preview} value={selectedComparison.free_preview} maxLength={1000} onChange={(value) => edit((next) => { next.pricing.comparison_rows[selectedComparisonIndex].free_preview = value })} />
                    <TextareaField id={`comparison-paid-${selectedComparison.id}`} label={copy.publicContent.admin_single_lifetime} value={selectedComparison.single_account_lifetime} maxLength={1000} onChange={(value) => edit((next) => { next.pricing.comparison_rows[selectedComparisonIndex].single_account_lifetime = value })} />
                  </div>
                </div>
              </div>
            ) : <EmptyDetail />}
          />
        </div>
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_support_heading}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField id="pricing-support-heading" label={copy.publicContent.admin_support_heading} value={settings.pricing.support_heading} maxLength={120} onChange={(value) => edit((next) => { next.pricing.support_heading = value })} />
          <TextareaField id="pricing-support-body" label={copy.publicContent.admin_support_body} value={settings.pricing.support_body} maxLength={1000} onChange={(value) => edit((next) => { next.pricing.support_body = value })} />
        </div>
      </EditorPanel>
    </>
  )
}

function ThanksEditor({ settings, edit }: { settings: PublicContentSettingsV1; edit: EditSettings }) {
  const [selectedSectionId, setSelectedSectionId] = useSelectedId(settings.thanks.sections.map((section) => section.id))
  const selectedSectionIndex = settings.thanks.sections.findIndex((section) => section.id === selectedSectionId)
  const selectedSection = selectedSectionIndex >= 0 ? settings.thanks.sections[selectedSectionIndex] : null

  const addSection = () => {
    const id = newId('section')
    edit((next) => { next.thanks.sections.push({ id, heading: '', intro: '', entries: [] }) })
    setSelectedSectionId(id)
  }

  const deleteSection = () => {
    if (selectedSectionIndex < 0) return
    const nextSelected = selectionAfterDelete(settings.thanks.sections, selectedSectionIndex)
    edit((next) => { next.thanks.sections.splice(selectedSectionIndex, 1) })
    setSelectedSectionId(nextSelected)
  }

  return (
    <>
      <EditorPanel title={copy.publicContent.admin_tab_thanks}>
        <PageFields prefix="thanks" page={settings.thanks} edit={(field, value) => edit((next) => { next.thanks[field] = value })} />
      </EditorPanel>
      <EditorPanel title={copy.publicContent.admin_thanks_sections} description={copy.publicContent.admin_list_order_help} action={<button type="button" className="tool-secondary-action" onClick={addSection}>{copy.publicContent.admin_add_section}</button>}>
        <SortableMasterDetailList
          items={settings.thanks.sections.map((section) => ({ id: section.id, title: section.heading, description: section.intro, meta: `${section.entries.length} ${copy.publicContent.admin_entries}` }))}
          selectedId={selectedSectionId}
          onSelect={setSelectedSectionId}
          onReorder={(from, to) => edit((next) => { next.thanks.sections = moveItem(next.thanks.sections, from, to) })}
          ariaLabel={copy.publicContent.admin_thanks_sections}
          detail={selectedSection ? (
            <ThanksSectionDetail
              key={selectedSection.id}
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
  const [selectedEntryId, setSelectedEntryId] = useSelectedId(section.entries.map((entry) => entry.id))
  const selectedEntryIndex = section.entries.findIndex((entry) => entry.id === selectedEntryId)
  const selectedEntry = selectedEntryIndex >= 0 ? section.entries[selectedEntryIndex] : null

  const addEntry = () => {
    const id = newId('entry')
    edit((next) => { next.thanks.sections[sectionIndex].entries.push({ id, name: '', description: '', url: '', avatar_url: '' }) })
    setSelectedEntryId(id)
  }

  const deleteEntry = () => {
    if (selectedEntryIndex < 0) return
    const nextSelected = selectionAfterDelete(section.entries, selectedEntryIndex)
    edit((next) => { next.thanks.sections[sectionIndex].entries.splice(selectedEntryIndex, 1) })
    setSelectedEntryId(nextSelected)
  }

  return (
    <div className="tool-inset p-5">
      <ListActions index={sectionIndex} length={sectionCount} onMove={onMoveSection} onDelete={onDeleteSection} />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <TextField id={`thanks-heading-${section.id}`} label={copy.publicContent.admin_section_heading} value={section.heading} maxLength={120} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].heading = value })} />
        <TextareaField id={`thanks-intro-${section.id}`} label={copy.publicContent.admin_section_intro} value={section.intro} maxLength={1000} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].intro = value })} />
      </div>
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-surface-3 pt-5">
        <h3 className="text-sm font-semibold text-ink-primary">{copy.publicContent.admin_entries}</h3>
        <button type="button" className="tool-secondary-action px-3 text-sm" onClick={addEntry}>{copy.publicContent.admin_add_entry}</button>
      </div>
      <div className="mt-3">
        <SortableMasterDetailList
          items={section.entries.map((entry) => ({ id: entry.id, title: entry.name, description: entry.description }))}
          selectedId={selectedEntryId}
          onSelect={setSelectedEntryId}
          onReorder={(from, to) => edit((next) => { next.thanks.sections[sectionIndex].entries = moveItem(next.thanks.sections[sectionIndex].entries, from, to) })}
          ariaLabel={copy.publicContent.admin_entries}
          detail={selectedEntry ? (
            <div className="rounded-xl border border-surface-3 p-4">
              <ListActions index={selectedEntryIndex} length={section.entries.length} onMove={(target) => edit((next) => { next.thanks.sections[sectionIndex].entries = moveItem(next.thanks.sections[sectionIndex].entries, selectedEntryIndex, target) })} onDelete={deleteEntry} />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <TextField id={`thanks-name-${selectedEntry.id}`} label={copy.publicContent.admin_entry_name} value={selectedEntry.name} maxLength={120} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].entries[selectedEntryIndex].name = value })} />
                <TextField id={`thanks-url-${selectedEntry.id}`} label={copy.publicContent.admin_entry_url} value={selectedEntry.url} maxLength={2048} type="url" required={false} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].entries[selectedEntryIndex].url = value })} />
                <TextField id={`thanks-avatar-url-${selectedEntry.id}`} label={copy.publicContent.admin_entry_avatar_url} value={selectedEntry.avatar_url} maxLength={2048} type="url" required={false} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].entries[selectedEntryIndex].avatar_url = value })} />
                <div className="md:col-span-2">
                  <TextareaField id={`thanks-description-${selectedEntry.id}`} label={copy.publicContent.admin_entry_description} value={selectedEntry.description} maxLength={1000} required={false} onChange={(value) => edit((next) => { next.thanks.sections[sectionIndex].entries[selectedEntryIndex].description = value })} />
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
      <TextField id={`${prefix}-eyebrow`} label={copy.publicContent.admin_page_eyebrow} value={page.eyebrow} maxLength={80} onChange={(value) => edit('eyebrow', value)} />
      <TextField id={`${prefix}-title`} label={copy.publicContent.admin_page_title} value={page.title} maxLength={80} onChange={(value) => edit('title', value)} />
      <div className="md:col-span-2">
        <TextareaField id={`${prefix}-intro`} label={copy.publicContent.admin_page_intro} value={page.intro} maxLength={1000} onChange={(value) => edit('intro', value)} />
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

function TextField({ id, label, value, maxLength, onChange, type = 'text', inputMode, required = true }: {
  id: string; label: string; value: string; maxLength: number; onChange: (value: string) => void; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; required?: boolean
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-sm font-medium text-ink-secondary">{label}{required && <RequiredMark />}</span>
      <input id={id} value={value} type={type} inputMode={inputMode} maxLength={maxLength} required={required} onChange={(event) => onChange(event.currentTarget.value)} className="tool-field" />
    </label>
  )
}

function TextareaField({ id, label, value, maxLength, required = true, onChange }: { id: string; label: string; value: string; maxLength: number; required?: boolean; onChange: (value: string) => void }) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-2 block text-sm font-medium text-ink-secondary">{label}{required && <RequiredMark />}</span>
      <textarea id={id} value={value} maxLength={maxLength} required={required} rows={4} onChange={(event) => onChange(event.currentTarget.value)} className="tool-field min-h-28 resize-y" />
    </label>
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

function useSelectedId(ids: string[]): [string | null, (id: string | null) => void] {
  const [selectedId, setSelectedId] = useState<string | null>(() => ids[0] ?? null)
  useEffect(() => {
    if (selectedId && ids.includes(selectedId)) return
    setSelectedId(ids[0] ?? null)
  }, [ids, selectedId])
  return [selectedId, setSelectedId]
}

function selectionAfterDelete<T extends { id: string }>(items: T[], deletedIndex: number): string | null {
  if (items.length <= 1) return null
  return items[Math.min(deletedIndex + 1, items.length - 1)]?.id
    ?? items[Math.max(0, deletedIndex - 1)]?.id
    ?? null
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
    qq_group: settings.qq_group,
    faq: settings.faq,
    pricing: settings.pricing,
    thanks: settings.thanks,
  }
}
