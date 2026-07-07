import { useCallback, useMemo, useState } from 'react'
import type { FreePreviewRequest, FreePreviewResult, LicenseConfig, LicenseOperator } from '../../../lib/types'
import ConfigEditor from '../../../components/ConfigEditor'
import { apiJson } from '../../../lib/api-client'
import { CONFIG_PRESETS, cloneConfig, normalizeConfig, validateConfig } from '../../../lib/config'
import { formatPreviewEfficiency, parseOperatorsText } from '../tool-utils'

export default function FreePreviewSection({ onUseCdk }: { onUseCdk: () => void }) {
const [operators, setOperators] = useState<LicenseOperator[] | null>(null)
const [operatorFileName, setOperatorFileName] = useState<string | null>(null)
const [config, setConfig] = useState<LicenseConfig>(() => normalizeConfig(cloneConfig(CONFIG_PRESETS['243'])))
const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)
const [preview, setPreview] = useState<FreePreviewResult | null>(null)
const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])

const clearPreviewState = useCallback(() => {
  setPreview(null)
  setError(null)
}, [])

const updateConfig = useCallback((mutate: (config: LicenseConfig) => void) => {
  const next = normalizeConfig(normalizedConfig)
  mutate(next)
  setConfig(normalizeConfig(next))
  clearPreviewState()
}, [clearPreviewState, normalizedConfig])

const handleOperatorsFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.currentTarget.files?.[0]
  setOperatorFileName(file?.name ?? null)
  setOperators(null)
  clearPreviewState()
  if (!file) return
  try {
    setOperators(parseOperatorsText(await file.text()))
  } catch (caught) {
    setError((caught as Error).message)
  }
}

const handleSubmit = async (event: React.FormEvent) => {
  event.preventDefault()
  setError(null)
  setPreview(null)
  if (!operators) {
    setError('请先上传 operators.json 或 .txt。')
    return
  }
  if (!configValidation.ok) {
    setError(configValidation.message)
    return
  }
  const payload: FreePreviewRequest = {
    operators,
    config: normalizedConfig,
  }
  setLoading(true)
  try {
    const data = await apiJson<FreePreviewResult>('/api/free-preview', {
      method: 'POST',
      json: payload,
      fallbackMessage: '免费预览失败',
    })
    setPreview(data)
  } catch (caught) {
    setError((caught as Error).message)
  } finally {
    setLoading(false)
  }
}

const ownedOperatorCount = operators?.filter((operator) => operator.own !== false).length ?? 0

return (
  <div className="mx-auto max-w-4xl space-y-5">
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5 sm:p-6">
      <div>
        <p className="text-sm font-medium text-brand-400">免费预览</p>
        <h2 className="mt-1 text-xl font-semibold text-ink-primary">临时查看账号优化方向</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
          上传 MAA 导出的干员识别文件并选择基建配置，生成限制级排班预览。这里不会创建游戏账号、保存数据或消耗 CDK。
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-5">
        {error && <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
        <div className="space-y-4">
          <section className="rounded-lg border border-surface-3 bg-surface-0 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-primary">干员数据</h3>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">支持 operators.json 或文本格式的干员识别导出。</p>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                {operators && <span className="rounded-md bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">已载入 {ownedOperatorCount} 名干员</span>}
                <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">
                  {operatorFileName ? `已选择：${operatorFileName}` : '选择干员识别文件'}
                  <input
                    type="file"
                    accept=".json,.txt,application/json,text/plain"
                    onChange={handleOperatorsFile}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-surface-3 bg-surface-0 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-primary">基建配置</h3>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">
                  当前：{normalizedConfig.layout || `${normalizedConfig.trading_stations_count}-${normalizedConfig.manufacturing_stations_count}-3`} / {normalizedConfig.desc || '自定义配置'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(CONFIG_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setConfig(normalizeConfig(cloneConfig(preset)))
                      clearPreviewState()
                    }}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 ${
                      normalizedConfig.desc === preset.desc ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'
                    }`}
                  >
                    {key === '243' ? '243 均衡' : key === '243-1' ? '243 搓玉' : '333 搓玉'}
                  </button>
                ))}
              </div>
            </div>
            <details className="mt-4 rounded-lg border border-surface-3 bg-surface-1">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2">
                高级配置
              </summary>
              <div className="border-t border-surface-3 p-4">
                <ConfigEditor
                  config={normalizedConfig}
                  canEdit
                  canEditIntermediateInventory
                  validation={configValidation}
                  onUpdate={updateConfig}
                  embedded
                  hideHeader
                  hidePresetActions
                />
              </div>
            </details>
          </section>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-secondary">免费预览仅展示前 3 个房间，不提供完整排班、练度建议或 MAA JSON。</p>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
        >
          {loading ? '生成预览中...' : '生成免费预览'}
        </button>
        </div>
      </form>
    </section>

    {preview && <FreePreviewResultCard preview={preview} onUseCdk={onUseCdk} />}
  </div>
)
}

function FreePreviewResultCard({ preview, onUseCdk }: { preview: FreePreviewResult; onUseCdk: () => void }) {
const schedule = preview.limited_schedule
return (
  <section className="mt-6 rounded-xl border border-brand-600/25 bg-surface-0 p-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-sm font-medium text-brand-400">免费预览已生成</p>
        <h3 className="mt-1 text-xl font-semibold text-ink-primary">限制级排班预览</h3>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          已按当前表单数据生成排班摘要。完整房间、练度建议和可导入 MAA 的 JSON 需要使用 CDK 添加正式游戏账号。
        </p>
      </div>
      <button
        type="button"
        onClick={onUseCdk}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
      >
        使用 CDK 添加游戏账号
      </button>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <PreviewMetric label="识别干员" value={`${preview.operator_count} 名`} />
      <PreviewMetric label="布局支持" value={preview.support.label} />
      <PreviewMetric label="可能提升" value={preview.potential_range.label} />
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.15fr]">
      <div className="rounded-lg bg-surface-1 p-4">
        <h4 className="text-sm font-semibold text-ink-primary">当前基建布局</h4>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{preview.support.reason}</p>
        <h4 className="mt-5 text-sm font-semibold text-ink-primary">预计可优化方向</h4>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-secondary">
          {preview.directions.map((direction) => <li key={direction}>- {direction}</li>)}
        </ul>
        <p className="mt-4 text-sm leading-6 text-ink-secondary">{preview.potential_range.note}</p>
      </div>

      <div className="rounded-lg bg-surface-1 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h4 className="text-sm font-semibold text-ink-primary">{schedule.plan_name}</h4>
          <span className="text-xs font-medium text-ink-muted">共 {schedule.plan_count} 个方案</span>
        </div>
        <div className="mt-3 divide-y divide-surface-3/70 overflow-hidden rounded-lg border border-surface-3">
          {schedule.rooms.map((room) => (
            <div key={room.key} className="grid gap-2 bg-surface-0 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-primary">{room.label} · {room.index_label}</p>
                <p className="mt-1 truncate text-sm text-ink-secondary">{room.product} / {room.operators.join('、') || '无干员'}</p>
              </div>
              <p className="text-sm font-semibold text-brand-300">{formatPreviewEfficiency(room.efficiency)}</p>
            </div>
          ))}
          {schedule.rooms.length === 0 && <p className="px-4 py-3 text-sm text-ink-secondary">当前配置暂未生成可展示房间。</p>}
        </div>
        {schedule.hidden_room_count > 0 && (
          <p className="mt-3 text-sm text-ink-muted">另有 {schedule.hidden_room_count} 个房间已隐藏。</p>
        )}
      </div>
    </div>

    {preview.notices.length > 0 && (
      <ul className="mt-5 space-y-2 rounded-lg bg-warning/10 px-4 py-3 text-sm leading-6 text-warning">
        {preview.notices.map((notice) => <li key={notice}>- {notice}</li>)}
      </ul>
    )}
  </section>
)
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
return (
  <div className="rounded-lg bg-surface-1 p-4">
    <p className="text-xs font-medium text-ink-muted">{label}</p>
    <p className="mt-1 text-lg font-semibold text-ink-primary">{value}</p>
  </div>
)
}

