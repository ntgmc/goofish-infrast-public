import { useMemo, useState } from 'react'
import { LayoutGroup } from 'motion/react'
import { AnimatedPresenceRegion, MotionNavIndicator } from '../MotionPrimitives'
import { formatCompactNumber, prepareResult } from './formatters'
import { MaaImportGuide, RotationManualGuide } from './Guides'
import ResultBoard from './ResultBoard'
import ResultDetail from './ResultDetail'
import ResultMetrics from './ResultMetrics'
import type { ResultPanelProps, ResultTabId } from './types'
import { copy } from '../../copy/index'


export default function ResultPanel({
  result,
  operators = [],
  onDownload,
  onSaveWorkfile,
  detailDefaultOpen = false,
  suggestionsSlot,
  previewLimit,
}: ResultPanelProps) {
  const isRotationMode = result.schedule_mode === 'rotation'
  const isMaaDormitoryAutofill = !isRotationMode && result.dormitory_rule === 'maa_autofill'
  const prepared = useMemo(
    () => prepareResult(result, isRotationMode, isMaaDormitoryAutofill, operators),
    [result, isRotationMode, isMaaDormitoryAutofill, operators],
  )
  const { detailStats } = prepared
  const isPreview = Boolean(previewLimit)

  const shiftPattern = result.shift_pattern ?? result.shift_hours?.map((hour) => `${hour}h`).join('-') ?? result.planTimes
  const totalScheduleHours = result.total_schedule_hours ?? result.daily_production?.hours
  const fiammettaSlots = result.fiammetta_target_slots ?? []
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
      value: isRotationMode ? copy.domain.components_result_panel_ResultPanel_014 : result.dormitory_rule_name ?? (isMaaDormitoryAutofill ? copy.domain.components_result_panel_ResultPanel_015 : copy.domain.components_result_panel_ResultPanel_016),
    },
  ]
  const tabs: Array<{ id: ResultTabId; label: string }> = [
    { id: 'board', label: copy.domain.components_result_panel_ResultPanel_017 },
    { id: 'detail', label: isRotationMode ? copy.domain.components_result_panel_ResultPanel_018 : copy.domain.components_result_panel_ResultPanel_019 },
    ...(!isPreview ? [{ id: 'data' as const, label: copy.domain.components_result_panel_ResultPanel_020 }] : []),
    ...(!isPreview ? [{ id: 'import' as const, label: isRotationMode ? copy.domain.components_result_panel_ResultPanel_021 : copy.domain.components_result_panel_ResultPanel_022 }] : []),
    ...(!isPreview && suggestionsSlot ? [{ id: 'suggestions' as const, label: copy.domain.components_result_panel_ResultPanel_023 }] : []),
  ] as const
  const [activeTab, setActiveTab] = useState<ResultTabId>(
    detailDefaultOpen ? 'detail' : 'board',
  )
  const selectedTab = isPreview && (activeTab === 'data' || activeTab === 'import' || activeTab === 'suggestions')
    ? 'board'
    : activeTab === 'suggestions' && !suggestionsSlot
      ? 'data'
      : activeTab

  return (
    <div className="space-y-4">
      <div className="tool-panel overflow-hidden">
        <div className="tool-panel-header flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="tool-eyebrow">{copy.domain.components_result_panel_ResultPanel_024}</p>
            <h2 className="text-lg font-semibold text-ink-primary">
              {isPreview ? copy.domain.components_result_panel_ResultPanel_025 : copy.domain.components_result_panel_ResultPanel_027}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {isPreview
                ? copy.domain.components_result_panel_ResultPanel_028
                : isRotationMode
                  ? copy.domain.components_result_panel_ResultPanel_030
                  : copy.domain.components_result_panel_ResultPanel_031}
            </p>
          </div>
          {(onDownload || onSaveWorkfile) && (
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-shrink-0">
              {!isRotationMode && onDownload && (
                <button
                  type="button"
                  onClick={onDownload}
                  className="tool-primary-action"
                >
                  {copy.domain.components_result_panel_ResultPanel_032}</button>
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
            {contextItems.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span>{item.label}</span>
                <span className="font-semibold text-ink-primary">{item.value}</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span>{copy.domain.components_result_panel_ResultPanel_036}</span>
              <span className="font-semibold text-ink-primary">
                {fiammettaSlots.length > 0 ? fiammettaSlots.join('、') : copy.domain.components_result_panel_ResultPanel_037}
              </span>
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
                  onClick={() => setActiveTab(tab.id)}
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

      <AnimatedPresenceRegion
        motionKey={selectedTab}
        id={`result-${selectedTab}-panel`}
        role="tabpanel"
        labelledBy={`result-${selectedTab}-tab`}
      >
        {selectedTab === 'board' && <ResultBoard isRotationMode={isRotationMode} prepared={prepared} planTimes={result.planTimes} />}
        {selectedTab === 'data' && <ResultMetrics isRotationMode={isRotationMode} prepared={prepared} />}
        {selectedTab === 'detail' && <ResultDetail isRotationMode={isRotationMode} prepared={prepared} planTimes={result.planTimes} />}
        {selectedTab === 'import' && (
          <section className="tool-panel overflow-hidden p-5 sm:p-6">
            {isRotationMode ? <RotationManualGuide compact /> : <MaaImportGuide compact />}
          </section>
        )}
        {selectedTab === 'suggestions' && suggestionsSlot && <section className="tool-panel overflow-hidden p-5 sm:p-6">{suggestionsSlot}</section>}
      </AnimatedPresenceRegion>
    </div>
  )
}
