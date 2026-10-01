import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { LayoutGroup } from 'motion/react'
import { AnimatedPresenceRegion, MotionNavIndicator } from '../MotionPrimitives'
import { formatCompactNumber, prepareResult } from './formatters'
import { MaaImportGuide, RotationManualGuide } from './Guides'
import ResultBoard from './ResultBoard'
import ResultBoardV2 from './ResultBoardV2'
import OperatorSkillPreview from './OperatorSkillPreview'
import ResultDetail from './ResultDetail'
import ResultMetrics from './ResultMetrics'
import type { ResultPanelProps, ResultTabId } from './types'
import { copy, CURRENT_LOCALE } from '../../copy/index'
import { hasCapability } from '../../lib/product-catalog'
import { manualSourceKey } from './manual-schedule'

const ManualScheduleEditor = lazy(() => import('./ManualScheduleEditor'))

export default function ResultPanel({
  result,
  operators = [],
  onDownload,
  onDownloadFullResult,
  downloadBusy = false,
  fullResultDownloadBusy = false,
  fullDataAvailable = true,
  onSaveWorkfile,
  detailDefaultOpen = false,
  suggestionsSlot,
  manualPreviewSlot,
  previewLimit,
  manualEditProfile,
}: ResultPanelProps) {
  const isRotationMode = result.schedule_mode === 'rotation'
  const isPureMaaDormitoryAutofill = !isRotationMode && result.dormitory_rule === 'maa_pure_autofill'
  const prepared = useMemo(
    () => prepareResult(result, isRotationMode, isPureMaaDormitoryAutofill, operators),
    [result, isRotationMode, isPureMaaDormitoryAutofill, operators],
  )
  const { detailStats } = prepared
  const isPreview = Boolean(previewLimit)
  const canEditManual = Boolean(manualEditProfile && manualEditProfile.kind !== 'free_preview'
    && !isPreview && !result.preview_limit && hasCapability(manualEditProfile, 'edit_full_config') && result.plans.length > 0)
  const manualKey = useMemo(() => manualSourceKey(result), [result])
  const searchedStateCount = result.searched_state_count
  const showSearchedStateCount = typeof searchedStateCount === 'number'
    && Number.isSafeInteger(searchedStateCount) && searchedStateCount >= 0

  const shiftPattern = result.shift_pattern ?? result.shift_hours?.map((hour) => `${hour}h`).join('-') ?? result.planTimes
  const totalScheduleHours = result.total_schedule_hours ?? result.daily_production?.hours
  const fiammettaSlots = result.fiammetta_target_slots ?? []
  const fiammettaRequested = !isRotationMode && result.plans.some((plan) => plan.Fiammetta?.requested === true)
  const fiammettaNoTarget = fiammettaRequested
    && fiammettaSlots.length === 0
    && result.plans.some((plan) => plan.Fiammetta?.status === 'no_target')
  const fiammettaStatus = fiammettaSlots.length > 0
    ? fiammettaSlots.join('、')
    : fiammettaNoTarget
      ? copy.domain.components_result_panel_ResultPanel_043
      : copy.domain.components_result_panel_ResultPanel_037
  const contextItems = [
    { label: copy.domain.components_result_panel_ResultPanel_001, value: result.schedule_mode_name ?? (isRotationMode ? copy.domain.components_result_panel_ResultPanel_002 : copy.domain.components_result_panel_ResultPanel_003) },
    { label: isRotationMode ? copy.domain.components_result_panel_ResultPanel_004 : copy.domain.components_result_panel_ResultPanel_005, value: isRotationMode ? result.planTimes ?? `${detailStats.planCount}${copy.domain.components_result_panel_ResultPanel_006}` : shiftPattern },
    {
      label: isRotationMode ? copy.domain.components_result_panel_ResultPanel_007 : copy.domain.components_result_panel_ResultPanel_008,
      value: isRotationMode
        ? `${copy.domain.components_result_panel_ResultPanel_009}${result.rotation_mode?.shift_hours_per_queue ?? 12}${copy.domain.components_result_panel_ResultPanel_010}${result.rotation_mode?.daily_production_normalized_hours ?? 24}h`
        : totalScheduleHours
        ? `${formatCompactNumber(totalScheduleHours)}${copy.domain.components_result_panel_ResultPanel_011}`
        : copy.domain.components_result_panel_ResultPanel_012,
    },
    {
      label: copy.domain.components_result_panel_ResultPanel_013,
      value: isRotationMode
        ? copy.domain.components_result_panel_ResultPanel_014
        : result.dormitory_rule_name ?? (
          isPureMaaDormitoryAutofill
            ? copy.domain.components_result_panel_ResultPanel_042
            : result.dormitory_rule === 'maa_autofill'
              ? copy.domain.components_result_panel_ResultPanel_015
              : copy.domain.components_result_panel_ResultPanel_016
        ),
    },
  ]
  const tabs: Array<{ id: ResultTabId; label: string }> = [
    { id: 'board', label: copy.domain.components_result_panel_ResultPanel_017 },
    { id: 'board-v2', label: copy.domain.result_board_v2.tab },
    ...(canEditManual || manualPreviewSlot ? [{ id: 'manual' as const, label: copy.domain.manual_schedule.tab }] : []),
    { id: 'detail', label: isRotationMode ? copy.domain.components_result_panel_ResultPanel_018 : copy.domain.components_result_panel_ResultPanel_019 },
    { id: 'data' as const, label: copy.domain.components_result_panel_ResultPanel_020 },
    ...(!isPreview ? [{ id: 'import' as const, label: isRotationMode ? copy.domain.components_result_panel_ResultPanel_021 : copy.domain.components_result_panel_ResultPanel_022 }] : []),
    ...(suggestionsSlot ? [{ id: 'suggestions' as const, label: copy.domain.components_result_panel_ResultPanel_023 }] : []),
  ] as const
  const [activeTab, setActiveTab] = useState<ResultTabId>(
    detailDefaultOpen ? 'detail' : 'board',
  )
  const [manualOpened, setManualOpened] = useState(false)
  const selectedTab = (isPreview && activeTab === 'import') || (activeTab === 'manual' && !canEditManual && !manualPreviewSlot)
      ? 'board'
    : activeTab === 'suggestions' && !suggestionsSlot
      ? fullDataAvailable ? 'data' : 'board'
      : activeTab
  const [activePlan, setActivePlan] = useState(0)
  const [imageExporting, setImageExporting] = useState(false)
  const [imageExportError, setImageExportError] = useState<string | null>(null)
  const imageExportLock = useRef(false)
  const selectedPlan = activePlan < prepared.plans.length ? activePlan : 0
  const imageCopy = copy.domain.result_image

  async function handleImageExport(allPlans: boolean) {
    if (imageExportLock.current) return
    imageExportLock.current = true
    setImageExporting(true)
    setImageExportError(null)
    try {
      const { downloadScheduleImage } = await import('./schedule-image')
      await downloadScheduleImage({
        prepared, isRotationMode, shiftHours: result.shift_hours, title: result.title,
        version: selectedTab === 'board-v2' ? 'v2' : 'v1',
        planIndex: allPlans ? undefined : selectedPlan,
      })
    } catch {
      setImageExportError(imageCopy.failed)
    } finally {
      imageExportLock.current = false
      setImageExporting(false)
    }
  }

  return (
    <OperatorSkillPreview>
    <div className="space-y-4">
      <div className="tool-panel overflow-hidden">
        <div className="tool-panel-header flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="tool-eyebrow">{copy.domain.components_result_panel_ResultPanel_024}</p>
            <h2 className="text-lg font-semibold text-ink-primary">
              {selectedTab === 'manual' ? copy.domain.manual_schedule.title : isPreview ? copy.domain.components_result_panel_ResultPanel_025 : copy.domain.components_result_panel_ResultPanel_027}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {selectedTab === 'manual' ? copy.domain.manual_schedule.pending : isPreview
                ? copy.domain.components_result_panel_ResultPanel_028
                : isRotationMode
                  ? copy.domain.components_result_panel_ResultPanel_030
                  : copy.domain.components_result_panel_ResultPanel_031}
            </p>
          </div>
          {selectedTab !== 'manual' && (onDownload || onSaveWorkfile) && (
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-shrink-0">
              {!isRotationMode && onDownload && (
                <button
                  type="button"
                  onClick={onDownload}
                  disabled={downloadBusy}
                  aria-busy={downloadBusy}
                  className="tool-primary-action"
                >
                  {downloadBusy ? copy.inventory.export_downloading : copy.domain.components_result_panel_ResultPanel_032}</button>
              )}
              {onSaveWorkfile && (
                <button
                  type="button"
                  onClick={onSaveWorkfile}
                  className="tool-secondary-action"
                >
                  {copy.domain.components_result_panel_ResultPanel_033}</button>
              )}
            </div>
          )}
        </div>
        {previewLimit && (
          <div className="tool-alert tool-alert--warning mx-5 mb-3 mt-5 text-sm sm:mx-6">
            {previewLimit.notice}
            {previewLimit.hidden_room_count > 0 ? `${copy.domain.components_result_panel_ResultPanel_034}${previewLimit.hidden_room_count}${copy.domain.components_result_panel_ResultPanel_035}` : ''}
          </div>
        )}
        <div className="border-b border-surface-3/60 px-5 py-3 sm:px-6">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-muted">
            {showSearchedStateCount && (
              <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1">
                <span>{copy.domain.components_result_panel_ResultPanel_045}</span>
                <span className="font-semibold text-ink-primary">
                  {searchedStateCount.toLocaleString(CURRENT_LOCALE)} {copy.domain.components_result_panel_ResultPanel_046}
                </span>
              </span>
            )}
            {contextItems.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span>{item.label}</span>
                <span className="font-semibold text-ink-primary">{item.value}</span>
              </span>
            ))}
            <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>{copy.domain.components_result_panel_ResultPanel_036}</span>
              <span className="font-semibold text-ink-primary">{fiammettaStatus}</span>
              {fiammettaNoTarget && (
                <span className="whitespace-normal text-ink-muted">{copy.domain.components_result_panel_ResultPanel_044}</span>
              )}
            </span>
          </div>
        </div>

        <div className="border-b border-surface-3/60 px-5 pt-3 sm:px-6">
          <LayoutGroup id="result-tabs">
            <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label={copy.domain.components_result_panel_ResultPanel_038}>
              {tabs.map((tab) => (
                <button
                  id={`result-${tab.id}-tab`}
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedTab === tab.id}
                  aria-controls={`result-${tab.id}-panel`}
                  onClick={() => { setActiveTab(tab.id); if (tab.id === 'manual') setManualOpened(true) }}
                  className={`relative inline-flex min-h-11 w-max shrink-0 border-b-2 px-4 py-2 text-sm font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 ${
                    selectedTab === tab.id
                      ? 'border-transparent text-ink-primary'
                      : 'border-transparent text-ink-muted hover:border-surface-4 hover:text-ink-primary'
                  }`}
                >
                  {selectedTab === tab.id && <MotionNavIndicator layoutId="result-tab-active" variant="underline" />}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              ))}
            </div>
          </LayoutGroup>
        </div>
      </div>

      {(selectedTab === 'board' || selectedTab === 'board-v2') && (
        <div className="space-y-2">
          <div className="flex flex-wrap justify-end gap-2" aria-busy={imageExporting}>
            {selectedTab === 'board-v2' && (
              <button type="button" className="tool-secondary-action" disabled={imageExporting || prepared.plans.length === 0}
                onClick={() => void handleImageExport(false)}>
                <Download size={16} aria-hidden="true" />{imageCopy.current}
              </button>
            )}
            <button type="button" className="tool-secondary-action" disabled={imageExporting || prepared.plans.length === 0}
              onClick={() => void handleImageExport(true)}>
              <Download size={16} aria-hidden="true" />
              {selectedTab === 'board-v2' ? imageCopy.all : imageCopy.long}
            </button>
            {imageExporting && <span className="self-center text-sm text-ink-muted" role="status">{imageCopy.busy}</span>}
          </div>
          {imageExportError && <p className="tool-alert tool-alert--warning text-sm" role="alert">{imageExportError}</p>}
        </div>
      )}

      {canEditManual && manualOpened && manualEditProfile && (
        <div id="result-manual-panel" role="tabpanel" aria-labelledby="result-manual-tab" hidden={selectedTab !== 'manual'}>
          <Suspense fallback={<p className="p-5 text-sm text-ink-muted">{copy.domain.manual_schedule.title}</p>}>
            <ManualScheduleEditor key={`${manualEditProfile.id}:${manualKey}`} source={result} profileId={manualEditProfile.id} operators={operators} />
          </Suspense>
        </div>
      )}

      {selectedTab === 'manual' && !canEditManual && manualPreviewSlot && (
        <section id="result-manual-panel" role="tabpanel" aria-labelledby="result-manual-tab" className="tool-panel p-5 sm:p-6">
          {manualPreviewSlot}
        </section>
      )}
      {selectedTab !== 'manual' && <AnimatedPresenceRegion
        motionKey={selectedTab}
        id={`result-${selectedTab}-panel`}
        role="tabpanel"
        labelledBy={`result-${selectedTab}-tab`}
      >
        {selectedTab === 'board' && <ResultBoard isRotationMode={isRotationMode} prepared={prepared} planTimes={result.planTimes} />}
        {selectedTab === 'board-v2' && <ResultBoardV2 isRotationMode={isRotationMode} prepared={prepared} shiftHours={result.shift_hours} activePlan={selectedPlan} onPlanChange={setActivePlan} />}
        {selectedTab === 'data' && (isPreview || !fullDataAvailable) && (
          <section className="tool-panel space-y-4 p-5" aria-label={copy.optimize.paid_preview.exports}>
            <h3 className="font-medium text-ink-primary">{copy.optimize.paid_preview.exports}</h3>
            <p className="text-sm leading-6 text-ink-secondary">{copy.optimize.paid_preview.exports_detail}</p>
            <dl className="tool-inset grid gap-4 p-4 sm:grid-cols-2">
              {[copy.domain.components_result_panel_ResultMetrics_017, copy.domain.components_result_panel_ResultMetrics_020].map((label) => (
                <div key={label}><dt className="text-sm text-ink-secondary">{label}</dt><dd className="mt-2 text-sm text-ink-muted">{copy.optimize.paid_preview.result_pending}</dd></div>
              ))}
            </dl>
            <button type="button" disabled className="tool-secondary-action">{copy.optimize.paid_preview.export_action}</button>
            <a href="/pricing" className="block text-sm text-brand-200 underline">{copy.optimize.paid_preview.compare}</a>
          </section>
        )}
        {selectedTab === 'data' && !isPreview && fullDataAvailable && (
          <div className="space-y-4">
            <ResultMetrics isRotationMode={isRotationMode} prepared={prepared} />
            {onDownloadFullResult && <FullResultExportDisclosure onDownload={onDownloadFullResult} busy={fullResultDownloadBusy} />}
          </div>
        )}
        {selectedTab === 'detail' && <ResultDetail isRotationMode={isRotationMode} prepared={prepared} planTimes={result.planTimes} />}
        {selectedTab === 'import' && (
          <section className="tool-panel overflow-hidden p-5 sm:p-6">
            {isRotationMode ? <RotationManualGuide compact /> : <MaaImportGuide compact />}
          </section>
        )}
        {selectedTab === 'suggestions' && suggestionsSlot && <section className="tool-panel overflow-hidden p-5 sm:p-6">{suggestionsSlot}</section>}
      </AnimatedPresenceRegion>}
    </div>
    </OperatorSkillPreview>
  )
}

function FullResultExportDisclosure({ onDownload, busy }: { onDownload: () => void; busy: boolean }) {
  return (
    <details className="tool-panel overflow-hidden">
      <summary className="cursor-pointer px-5 py-4 text-xs font-medium text-ink-muted transition-colors hover:text-ink-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/45 sm:px-6">
        {copy.domain.components_result_panel_ResultPanel_040}
      </summary>
      <div className="border-t border-surface-3/60 px-5 py-4 sm:px-6">
        <p className="text-xs leading-5 text-ink-muted">
          {copy.domain.components_result_panel_ResultPanel_041}
        </p>
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          aria-busy={busy}
          className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-ink-muted underline decoration-surface-4 underline-offset-4 transition-colors hover:text-ink-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45"
        >
          {busy ? copy.inventory.export_downloading : copy.domain.components_result_panel_ResultPanel_039}
        </button>
      </div>
    </details>
  )
}
