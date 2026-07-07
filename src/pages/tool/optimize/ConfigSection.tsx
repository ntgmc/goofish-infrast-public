import { lazy, Suspense } from 'react'
import type { LicenseConfig, PermissionMode, WorkspaceResultHistoryItem } from '../../../lib/types'
import { SCHEDULE_MODE_LABELS, normalizeScheduleMode } from '../../../lib/config'
import type { ConfigDiffItem } from '../../../lib/workspace-history'
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
  activeConfig: LicenseConfig;
  permission: PermissionMode;
  userCanEditConfig: boolean;
  userCanUseIntermediateAutoConfig: boolean;
  configChanged: boolean;
  configPresetLabel: string;
  configValidation: ValidationState;
  latestResult: WorkspaceResultHistoryItem | null;
  diffRows: ConfigDiffItem[];
  updateConfig: (mutate: (config: LicenseConfig) => void) => void;
  resetConfig: () => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.42fr)]">
      <section className="min-w-0 overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
        <div className="border-b border-surface-3/60 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-ink-primary">基建配置</h2>
                {configChanged && (
                  <span className="inline-flex w-max shrink-0 whitespace-nowrap rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                    已修改
                  </span>
                )}
                {!configValidation.ok && (
                  <span className="inline-flex w-max shrink-0 whitespace-nowrap rounded-full bg-error/10 px-2.5 py-1 text-xs font-medium text-error">
                    需处理
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-6 text-ink-secondary">
                {SCHEDULE_MODE_LABELS[normalizeScheduleMode(activeConfig.schedule_mode)]} · {userCanEditConfig ? `${activeConfig.layout} · ${activeConfig.desc}` : configPresetLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={resetConfig}
              disabled={!configChanged}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:cursor-not-allowed disabled:text-ink-muted"
            >
              重置配置
            </button>
          </div>
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

      <aside className="min-w-0 rounded-xl border border-surface-3 bg-surface-1 p-5 sm:p-6">
        <p className="text-sm font-semibold text-brand-400">配置对比</p>
        <h3 className="mt-1 text-base font-semibold text-ink-primary">当前方案 vs 上次方案</h3>
        {latestResult ? (
          diffRows.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {diffRows.map((row) => (
                <div key={row.label} className="rounded-lg bg-surface-2 px-3 py-3 text-sm">
                  <p className="font-medium text-ink-primary">{row.label}</p>
                  <p className="mt-1 text-ink-muted">上次：{row.before}</p>
                  <p className="mt-1 text-brand-300">当前：{row.after}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-success/10 px-3 py-3 text-sm text-success">当前配置与上次生成配置一致。</p>
          )
        ) : (
          <p className="mt-4 rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-muted">暂无上次方案可对比。</p>
        )}
      </aside>
    </div>
  )
}
