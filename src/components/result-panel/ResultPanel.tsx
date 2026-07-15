import { useMemo, useState } from 'react'
import { formatCompactNumber, prepareResult } from './formatters'
import { MaaImportGuide, RotationManualGuide } from './Guides'
import ResultBoard from './ResultBoard'
import ResultDetail from './ResultDetail'
import ResultMetrics from './ResultMetrics'
import type { ResultPanelProps, ResultTabId } from './types'

export default function ResultPanel({
  result,
  operators = [],
  onDownload,
  onSaveWorkfile,
  detailDefaultOpen = false,
  variant = 'optimize',
  suggestionsSlot,
  previewLimit,
}: ResultPanelProps) {
  const isRotationMode = result.schedule_mode === 'rotation'
  const isMaaDormitoryAutofill = !isRotationMode && result.dormitory_rule === 'maa_autofill'
  const isAnalysis = variant === 'analysis' || result.analysis_summary?.source === 'imported_schedule'
  const analysisSummary = result.analysis_summary
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
    { label: '排班模式', value: result.schedule_mode_name ?? (isRotationMode ? '游戏内轮换' : 'MAA排班表') },
    { label: isRotationMode ? '队列数量' : '换班节奏', value: isRotationMode ? result.planTimes ?? `${detailStats.planCount} 组` : shiftPattern },
    {
      label: isRotationMode ? '统计方式' : '统计周期',
      value: isRotationMode
        ? `每队列 ${result.rotation_mode?.shift_hours_per_queue ?? 12}h · 日产量折算 ${result.rotation_mode?.daily_production_normalized_hours ?? 24}h`
        : totalScheduleHours
        ? `${formatCompactNumber(totalScheduleHours)} 小时`
        : '按班次配置',
    },
    {
      label: '宿舍规则',
      value: isRotationMode ? '轮换模式不导出宿舍' : result.dormitory_rule_name ?? (isMaaDormitoryAutofill ? 'MAA 自动填满' : '排班表写死'),
    },
  ]
  const tabs: Array<{ id: ResultTabId; label: string }> = [
    { id: 'board', label: '总览图' },
    { id: 'detail', label: isRotationMode ? '预设队列' : '详情' },
    ...(!isPreview ? [{ id: 'data' as const, label: '数据' }] : []),
    ...(!isPreview ? [{ id: 'import' as const, label: isRotationMode ? '设置' : '导入' }] : []),
    ...(!isPreview && suggestionsSlot ? [{ id: 'suggestions' as const, label: '建议' }] : []),
  ] as const
  const [activeTab, setActiveTab] = useState<ResultTabId>(
    detailDefaultOpen ? 'detail' : isAnalysis ? 'data' : 'board',
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
            <p className="tool-eyebrow">生成结果</p>
            <h2 className="text-lg font-semibold text-ink-primary">
              {isPreview ? '免费个人排班已就绪' : isAnalysis ? '排班表分析完成' : '排班方案已就绪'}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {isPreview
                ? '这是按正常流程生成的免费个人排班结果，可照着设置完整游戏内轮换，但不包含导出和高级分析。'
                : isAnalysis
                ? '已根据导入排班表计算红脸风险、日产量和爆仓信息。'
                : isRotationMode
                  ? '按下方预设队列在游戏内逐个设施设置，平时使用队列轮换的快速切换按钮。'
                  : '排班 JSON 用于导入或交给 MAA 使用；账号空间接入后会自动保存当前练度和配置。'}
            </p>
          </div>
          {(onDownload || onSaveWorkfile) && (
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-shrink-0">
              {!isAnalysis && !isRotationMode && onDownload && (
                <button
                  type="button"
                  onClick={onDownload}
                  className="tool-primary-action"
                >
                  下载排班 JSON
                </button>
              )}
              {!isAnalysis && onSaveWorkfile && (
                <button
                  type="button"
                  onClick={onSaveWorkfile}
                  className="tool-secondary-action"
                >
                  导出本地备份
                </button>
              )}
            </div>
          )}
        </div>
        {previewLimit && (
          <div className="tool-alert tool-alert--warning mx-5 mb-3 mt-5 text-sm sm:mx-6">
            {previewLimit.notice}
            {previewLimit.hidden_room_count > 0 ? ` 另有 ${previewLimit.hidden_room_count} 个房间已隐藏。` : ''}
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
              <span>菲亚梅塔</span>
              <span className="font-semibold text-ink-primary">
                {fiammettaSlots.length > 0 ? fiammettaSlots.join('、') : '未启用'}
              </span>
            </span>
          </div>
        </div>

        <div className="border-b border-surface-3/60 px-5 pt-3 sm:px-6">
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="排班结果视图">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selectedTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex min-h-11 w-max shrink-0 border-b-2 px-4 py-2 text-sm font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 ${
                  selectedTab === tab.id
                    ? 'border-brand-400 text-ink-primary'
                    : 'border-transparent text-ink-muted hover:border-surface-4 hover:text-ink-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {selectedTab === 'board' && (
        <ResultBoard
          isRotationMode={isRotationMode}
          prepared={prepared}
          planTimes={result.planTimes}
        />
      )}

      {selectedTab === 'data' && (
        <ResultMetrics
          isAnalysis={isAnalysis}
          isRotationMode={isRotationMode}
          analysisSummary={analysisSummary}
          prepared={prepared}
        />
      )}

      {selectedTab === 'detail' && (
        <ResultDetail
          isRotationMode={isRotationMode}
          prepared={prepared}
          planTimes={result.planTimes}
        />
      )}

      {selectedTab === 'import' && (
        <section className="tool-panel overflow-hidden p-5 sm:p-6">
          {isRotationMode ? <RotationManualGuide compact /> : <MaaImportGuide compact />}
        </section>
      )}

      {selectedTab === 'suggestions' && suggestionsSlot && (
        <section className="tool-panel overflow-hidden p-5 sm:p-6">
          {suggestionsSlot}
        </section>
      )}
    </div>
  )
}
