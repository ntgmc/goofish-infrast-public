import { lazy, Suspense } from 'react'
import { SCHEDULE_MODE_LABELS, normalizeScheduleMode } from '../../../lib/config'
import type { ConfigDiffItem } from '../../../lib/workspace-history'
import type { LicenseConfig, PermissionMode, WorkspaceResultHistoryItem } from '../../../lib/types'
import { ResultFallback } from './feedback'
import type { ValidationState } from './types'

const ConfigEditor = lazy(() => import('../../../components/ConfigEditor'))

export default function ConfigSection({
  activeConfig,
  permission,
  userCanEditConfig,
  userCanUseIntermediateAutoConfig,
  configChanged,
  configPresetLabel,
  configValidation,
  latestResult,
  diffRows,
  updateConfig,
  resetConfig,
}: {
  activeConfig: LicenseConfig
  permission: PermissionMode
  userCanEditConfig: boolean
  userCanUseIntermediateAutoConfig: boolean
  configChanged: boolean
  configPresetLabel: string
  configValidation: ValidationState
  latestResult: WorkspaceResultHistoryItem | null
  diffRows: ConfigDiffItem[]
  updateConfig: (mutate: (config: LicenseConfig) => void) => void
  resetConfig: () => void
}) {
  const description = `${SCHEDULE_MODE_LABELS[normalizeScheduleMode(activeConfig.schedule_mode)]} · ${userCanEditConfig ? `${activeConfig.layout} · ${activeConfig.desc}` : configPresetLabel}`

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,0.42fr)]">
      <section className="tool-panel min-w-0 overflow-hidden" aria-labelledby="config-section-title">
        <div className="tool-panel-header flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="tool-eyebrow">工作区输入</p>
              {configChanged && <span className="tool-status tool-status--warning">已修改</span>}
              {!configValidation.ok && <span className="tool-status tool-status--error">需处理</span>}
            </div>
            <h2 id="config-section-title" className="mt-2 text-base font-semibold text-ink-primary">基建配置</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">{description}</p>
          </div>
          <button type="button" onClick={resetConfig} disabled={!configChanged} className="tool-secondary-action shrink-0">
            恢复已保存配置
          </button>
        </div>
        <div className="p-4 sm:p-5">
          <Suspense fallback={<ResultFallback />}>
            <ConfigEditor
              config={activeConfig}
              permission={permission}
              canEdit={userCanEditConfig}
              canEditIntermediateInventory={userCanUseIntermediateAutoConfig}
              changed={configChanged}
              validation={configValidation}
              onUpdate={updateConfig}
              onReset={resetConfig}
              embedded
            />
          </Suspense>
        </div>
      </section>

      <aside className="tool-panel min-w-0 p-5 sm:p-6" aria-labelledby="config-diff-title">
        <p className="tool-eyebrow">变化记录</p>
        <h3 id="config-diff-title" className="mt-2 text-base font-semibold text-ink-primary">当前配置与上次生成</h3>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">只有会影响结果的差异才需要重新计算。</p>

        {latestResult ? (
          diffRows.length > 0 ? (
            <dl className="mt-5 divide-y divide-surface-3 border-y border-surface-3">
              {diffRows.map((row) => (
                <div key={row.label} className="py-3">
                  <dt className="text-sm font-medium text-ink-primary">{row.label}</dt>
                  <dd className="mt-2 grid gap-1 text-xs leading-5 sm:grid-cols-2">
                    <span className="text-ink-muted">上次：{row.before}</span>
                    <span className="font-medium text-brand-200">当前：{row.after}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="tool-alert tool-alert--success mt-5" role="status" aria-live="polite">当前配置与上次生成配置一致。</p>
          )
        ) : (
          <p className="mt-5 tool-inset px-3 py-3 text-sm leading-6 text-ink-muted">暂无上次方案可对比。生成一次后，这里会记录会影响结果的配置变化。</p>
        )}
      </aside>
    </div>
  )
}
