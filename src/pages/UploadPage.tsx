import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import type { AnalyzeScheduleResult, Announcement, FreePreviewResult, LicenseConfig, LicenseFile, LicenseOperator, PermissionMode } from '../lib/types'
import AnnouncementBanner from '../components/AnnouncementBanner'
import ConfigEditor, { CONFIG_PRESETS, cloneConfig, normalizeConfig, validateConfig } from '../components/ConfigEditor'
import BuildMetaStrip from '../components/BuildMetaStrip'
import ResultPanel from '../components/ResultPanel'
import { downloadLicenseFile } from '../lib/download'
import { ACTIVE_PURCHASE_CHANNEL } from '../lib/purchase'
import { bindPendingActivationToken, getPendingActivationToken } from '../lib/activation-token'

interface Props {
  onFileLoaded: (content: string) => Promise<void>;
  onLicenseRedeemed: (license: LicenseFile, licenseFileContent: string) => void;
  error: string | null;
  announcement: Announcement | null;
}

type EntryMode = 'preview' | 'analysis' | 'license' | 'cdk'

const FIRST_RUN_TOUR_STORAGE_KEY = 'maa-infrast-upload-tour-seen'

type TourTarget =
  | 'announcement'
  | 'entry-mode'
  | 'cdk-code'
  | 'operator-data'
  | 'base-config'
  | 'redeem-action'

interface TourStep {
  target: TourTarget;
  title: string;
  body: string;
}

const ANNOUNCEMENT_TOUR_STEP: TourStep = {
  target: 'announcement',
  title: '先看站内公告',
  body: '如果这里有公告，请先确认维护通知、使用限制或近期变更，再继续生成授权文件。',
}

const BASE_TOUR_STEPS: TourStep[] = [
  {
    target: 'entry-mode',
    title: '先选使用方式',
    body: '可以先免费预览账号和基建配置；需要完整排班时再使用 CDK 生成授权文件。',
  },
  {
    target: 'cdk-code',
    title: '输入你的 CDK',
    body: '把收到的 CDK 填在这里。CDK 只用于本次生成授权文件，不需要提前准备授权文件。',
  },
  {
    target: 'operator-data',
    title: '上传干员数据',
    body: '从 MAA 导出 operators.json 或 txt 文件后上传，工具会按你的账号干员计算排班。',
  },
  {
    target: 'base-config',
    title: '确认基建配置',
    body: '这里选择贸易站、制造站、产物和无人机策略。提交前还能调整，提交后本次授权配置会固定。',
  },
  {
    target: 'redeem-action',
    title: '生成授权文件',
    body: '勾选确认后兑换 CDK，网站会下载授权文件并进入排班生成流程。',
  },
]

export default function UploadPage({ onFileLoaded, onLicenseRedeemed, error, announcement }: Props) {
  const [mode, setMode] = useState<EntryMode>('preview')
  const [tourOpen, setTourOpen] = useState(false)
  const tourSteps = useMemo(
    () => announcement?.enabled ? [ANNOUNCEMENT_TOUR_STEP, ...BASE_TOUR_STEPS] : BASE_TOUR_STEPS,
    [announcement?.enabled],
  )

  useEffect(() => {
    try {
      if (window.localStorage.getItem(FIRST_RUN_TOUR_STORAGE_KEY) !== 'done') {
        setTourOpen(true)
      }
    } catch {
      setTourOpen(true)
    }
  }, [])

  const handleOpenTour = () => {
    setTourOpen(true)
  }

  const handleCloseTour = () => {
    try {
      window.localStorage.setItem(FIRST_RUN_TOUR_STORAGE_KEY, 'done')
    } catch {
      // Ignore storage failures; closing the tour should still work.
    }
    setTourOpen(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-5xl">
        <div className="mb-8 text-center">
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-2">
            <svg className="h-8 w-8 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="mb-3 text-3xl font-bold text-ink-primary">
            MAA 基建排班优化器
          </h1>
          <p className="text-base text-ink-secondary">
            免费预览账号方向，完整排班需使用 CDK
          </p>
          <BuildMetaStrip placement="corner" />
        </div>

        <div data-tour={announcement?.enabled ? 'announcement' : undefined}>
          <AnnouncementBanner announcement={announcement} className="mb-5" />
        </div>

        <div className="mb-5 flex justify-center">
          <div className="inline-flex rounded-lg bg-surface-1 p-1" data-tour="entry-mode">
            <ModeButton label="免费预览" active={mode === 'preview'} onClick={() => setMode('preview')} />
            <ModeButton label="分析排班表" active={mode === 'analysis'} onClick={() => setMode('analysis')} />
            <ModeButton label="上传 .maa 文件" active={mode === 'license'} onClick={() => setMode('license')} />
            <ModeButton label="使用 CDK 生成授权文件" active={mode === 'cdk'} onClick={() => setMode('cdk')} />
          </div>
        </div>

        {mode === 'preview' ? (
          <FreePreviewPanel onUseCdk={() => setMode('cdk')} />
        ) : mode === 'analysis' ? (
          <ScheduleAnalysisPanel />
        ) : mode === 'license' ? (
          <LicenseUploadPanel onFileLoaded={onFileLoaded} error={error} />
        ) : (
          <CdkRedeemPanel onLicenseRedeemed={onLicenseRedeemed} />
        )}

        <p className="mt-6 text-center text-xs text-ink-muted">
        排班表分析无需 CDK 和授权；免费预览仅展示前 3 个房间，不提供完整排班或 MAA JSON。CDK 会在本站生成授权文件，授权文件和保存进度文件通常以 .maa 结尾。
        </p>
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={handleOpenTour}
            className="text-xs font-medium text-brand-500 underline-offset-4 transition-colors duration-150 hover:text-brand-400 hover:underline"
          >
            查看首次使用导览
          </button>
        </div>
      </div>
      <FirstRunTour
        open={tourOpen}
        steps={tourSteps}
        onClose={handleCloseTour}
        onModeChange={setMode}
      />
    </div>
  )
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors duration-150 ${
        active
          ? 'bg-brand-600 text-white'
          : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'
      }`}
    >
      {label}
    </button>
  )
}

function ScheduleAnalysisPanel() {
  const [operators, setOperators] = useState<LicenseOperator[] | null>(null)
  const [schedule, setSchedule] = useState<unknown | null>(null)
  const [operatorsFileName, setOperatorsFileName] = useState<string | null>(null)
  const [scheduleFileName, setScheduleFileName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeScheduleResult | null>(null)
  const operatorsRef = useRef<HTMLInputElement>(null)
  const scheduleRef = useRef<HTMLInputElement>(null)

  const handleOperatorsFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    setError(null)
    setOperatorsFileName(file.name)
    try {
      setOperators(parseOperatorsText(await file.text()))
    } catch (caught) {
      setOperators(null)
      setError((caught as Error).message)
    }
  }

  const handleScheduleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    setError(null)
    setScheduleFileName(file.name)
    try {
      setSchedule(parseScheduleText(await file.text()))
    } catch (caught) {
      setSchedule(null)
      setError((caught as Error).message)
    }
  }

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!operators) {
      setError('请先上传 operators.json。')
      return
    }
    if (!schedule) {
      setError('请先上传排班表 JSON。')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/analyze-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operators, schedule }),
      })
      if (!resp.ok) throw new Error(await readResponseError(resp, `分析失败: ${resp.status}`))
      setResult(await resp.json() as AnalyzeScheduleResult)
    } catch (caught) {
      setResult(null)
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleAnalyze} className="mx-auto max-w-3xl rounded-xl bg-surface-1 p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">分析导入排班表</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              上传干员数据和已生成的排班 JSON，直接分析红脸风险、日产量和爆仓信息，不需要 CDK 或授权文件。
            </p>
          </div>
          <span className="rounded-full bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-300">
            免授权
          </span>
        </div>

        {error && (
          <div className="mt-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
            {error}
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <FilePickButton
            label="干员数据"
            hint="operators.json / .txt"
            fileName={operatorsFileName}
            loadedText={operators ? `已载入 ${operators.filter((operator) => operator.own !== false).length} 名干员` : ''}
            onClick={() => operatorsRef.current?.click()}
          />
          <FilePickButton
            label="排班表"
            hint="maa_schedule_optimized.json"
            fileName={scheduleFileName}
            loadedText={schedule ? '已载入排班表' : ''}
            onClick={() => scheduleRef.current?.click()}
          />
        </div>

        <input
          ref={operatorsRef}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          onChange={handleOperatorsFile}
          className="hidden"
        />
        <input
          ref={scheduleRef}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          onChange={handleScheduleFile}
          className="hidden"
        />

        <button
          type="submit"
          disabled={loading || !operators || !schedule}
          className="mt-5 w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
        >
          {loading ? '分析中...' : '分析排班表'}
        </button>
      </form>

      {result && (
        <div className="mx-auto max-w-5xl">
          <ResultPanel result={result} variant="analysis" detailDefaultOpen />
        </div>
      )}
    </div>
  )
}

function FilePickButton({
  label,
  hint,
  fileName,
  loadedText,
  onClick,
}: {
  label: string;
  hint: string;
  fileName: string | null;
  loadedText: string;
  onClick: () => void;
}) {
  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-ink-secondary">{label}</span>
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-lg bg-surface-2 px-4 py-3 text-left text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
      >
        {fileName ? `已选择：${fileName}` : hint}
      </button>
      {loadedText && <p className="mt-2 text-xs text-brand-400">{loadedText}</p>}
    </div>
  )
}

function LicenseUploadPanel({ onFileLoaded, error }: { onFileLoaded: (content: string) => Promise<void>; error: string | null }) {
  const [loading, setLoading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    setLoading(true)
    try {
      const content = await file.text()
      await onFileLoaded(content)
    } finally {
      setLoading(false)
    }
  }, [onFileLoaded])

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      fileRef.current?.click()
      return
    }
    await processFile(file)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      setSelectedFileName(file.name)
      await processFile(file)
    }
  }

  const handleFileChange = async () => {
    const file = fileRef.current?.files?.[0]
    setSelectedFileName(file?.name ?? null)
    if (file) await processFile(file)
  }

  return (
    <div className="mx-auto max-w-md rounded-xl bg-surface-1 p-8">
      {error && (
        <div className="mb-6 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-error" role="alert">
          {error}
        </div>
      )}

      <div className="space-y-6">
        <div>
          <label htmlFor="file-upload" className="mb-3 block text-sm font-medium text-ink-secondary">
            授权文件或保存进度文件
          </label>
          <div
            onDrop={handleDrop}
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileRef.current?.click() }}
            role="button"
            tabIndex={0}
            aria-label="上传授权文件或保存进度文件"
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-150 ${
              dragActive
                ? 'border-brand-400 bg-brand-500/10'
                : 'border-surface-4 hover:border-brand-500/50'
            }`}
          >
            <div className="space-y-3">
              <div className="text-ink-muted">
                <svg className="mx-auto h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-sm text-ink-secondary">
                拖拽授权文件或保存进度文件到此处，或点击选择
              </p>
              <p className="text-xs text-ink-muted">
                支持本站生成的授权文件，或本工具保存的进度文件
              </p>
              {selectedFileName && (
                <p className="text-xs font-medium text-brand-400">
                  已选择：{selectedFileName}
                </p>
              )}
            </div>
            <input
              ref={fileRef}
              id="file-upload"
              type="file"
              accept=".maa"
              onChange={handleFileChange}
              className="hidden"
              aria-label="选择授权文件或保存进度文件"
            />
          </div>
          <div className="mt-4 grid gap-3 text-left sm:grid-cols-2">
            <div className="rounded-lg bg-surface-2/60 p-3">
              <p className="text-sm font-medium text-ink-primary">第一次使用</p>
              <p className="mt-1 text-xs text-ink-secondary">
                切换到 CDK 模式，输入 CDK 并上传干员数据生成授权文件。
              </p>
            </div>
            <div className="rounded-lg bg-surface-2/60 p-3">
              <p className="text-sm font-medium text-ink-primary">继续调整</p>
              <p className="mt-1 text-xs text-ink-secondary">
                上传之前保存的进度文件，继续上次的练度和配置调整。
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleUpload}
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
        >
          {loading ? '验证中...' : selectedFileName ? '验证并进入' : '选择 .maa 文件'}
        </button>
      </div>
    </div>
  )
}

function FreePreviewPanel({ onUseCdk }: { onUseCdk: () => void }) {
  const [operators, setOperators] = useState<LicenseOperator[] | null>(null)
  const [operatorsFileName, setOperatorsFileName] = useState<string | null>(null)
  const [config, setConfig] = useState<LicenseConfig>(() => cloneConfig(CONFIG_PRESETS['243']))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<FreePreviewResult | null>(null)
  const operatorsRef = useRef<HTMLInputElement>(null)

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
  const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])

  const updateConfig = useCallback((mutate: (config: LicenseConfig) => void) => {
    const next = normalizeConfig(normalizedConfig)
    mutate(next)
    setConfig(next)
    setPreview(null)
  }, [normalizedConfig])

  const handleOperatorsFile = async () => {
    const file = operatorsRef.current?.files?.[0]
    setOperatorsFileName(file?.name ?? null)
    setOperators(null)
    setPreview(null)
    setError(null)
    if (!file) return
    try {
      setOperators(parseOperatorsText(await file.text()))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setPreview(null)
    if (!operators) {
      setError('请先上传 operators.json。')
      return
    }
    if (!configValidation.ok) {
      setError(configValidation.message)
      return
    }
    setLoading(true)
    try {
      const resp = await fetch('/api/free-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operators,
          config: normalizedConfig,
        }),
      })
      const data = await resp.json() as FreePreviewResult & { error?: string }
      if (!resp.ok) {
        throw new Error(data.error || `预览失败: ${resp.status}`)
      }
      setPreview(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="mx-auto max-w-3xl rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
          {error}
        </div>
      )}

      <section className="mx-auto max-w-3xl rounded-xl bg-surface-1 p-5 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <span className="mb-2 block text-sm font-medium text-ink-secondary">operators.json / .txt</span>
            <button
              type="button"
              onClick={() => operatorsRef.current?.click()}
              className="w-full rounded-lg bg-surface-2 px-4 py-2 text-left text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
            >
              {operatorsFileName ? `已选择：${operatorsFileName}` : '选择干员数据文件'}
            </button>
            {operators && (
              <p className="mt-2 text-xs text-brand-400">已载入 {operators.filter((operator) => operator.own !== false).length} 名干员</p>
            )}
            <input
              ref={operatorsRef}
              type="file"
              accept=".json,.txt,application/json,text/plain"
              onChange={handleOperatorsFile}
              className="hidden"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !operators || !configValidation.ok}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted sm:mt-7"
          >
            {loading ? '生成预览中...' : '生成免费预览'}
          </button>
        </div>
        <OperatorDataGuide />
      </section>

      <div data-tour="base-config">
        <ConfigEditor
          config={normalizedConfig}
          canEdit
          changed={false}
          validation={configValidation}
          onUpdate={updateConfig}
          note="免费预览会生成限制级排班，仅展示前 3 个房间。"
        />
      </div>

      {preview && <FreePreviewResultCard preview={preview} onUseCdk={onUseCdk} />}
    </form>
  )
}

function FreePreviewResultCard({ preview, onUseCdk }: { preview: FreePreviewResult; onUseCdk: () => void }) {
  return (
    <section className="mx-auto max-w-3xl rounded-xl bg-surface-1 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand-400">免费预览已生成</p>
          <h2 className="mt-1 text-xl font-semibold text-ink-primary">限制级排班预览</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            已按当前练度生成排班，但免费版只展示前 3 个房间。完整房间、练度建议和 MAA JSON 需使用 CDK。
          </p>
        </div>
        <button
          type="button"
          onClick={onUseCdk}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
        >
          使用 CDK 获取完整结果
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <PreviewMetric label="识别干员" value={`${preview.operator_count} 名`} />
        <PreviewMetric label="布局支持" value={preview.support.label} />
        <PreviewMetric label="可能提升" value={preview.potential_range.label} />
      </div>

      <div className="mt-5 rounded-lg bg-surface-2/60 p-4">
        <p className="text-sm font-semibold text-ink-primary">当前基建布局</p>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">{preview.support.reason}</p>
      </div>

      <LimitedSchedulePreview preview={preview} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <h3 className="text-sm font-semibold text-ink-primary">预计可优化方向</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-secondary">
            {preview.directions.map((direction) => (
              <li key={direction} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-400" />
                <span>{direction}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-4">
          <h3 className="text-sm font-semibold text-ink-primary">提升档位范围</h3>
          <p className="mt-2 text-2xl font-semibold text-brand-300">{preview.potential_range.label}</p>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">{preview.potential_range.note}</p>
        </div>
      </div>

      <div className="mt-5 space-y-2 text-xs leading-5 text-ink-muted">
        {preview.notices.map((notice) => (
          <p key={notice}>{notice}</p>
        ))}
      </div>
    </section>
  )
}

function LimitedSchedulePreview({ preview }: { preview: FreePreviewResult }) {
  const schedule = preview.limited_schedule
  const hiddenRoomCopy = schedule.hidden_room_count > 0
    ? `另有 ${schedule.hidden_room_count} 个房间和后续班次需使用 CDK 解锁。`
    : '完整结果可下载 MAA JSON 并保存进度。'

  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-brand-500/20 bg-brand-500/5">
      <div className="flex flex-col gap-2 border-b border-brand-500/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-primary">免费排班表，前 {schedule.room_limit} 个房间</h3>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {schedule.plan_name} · 共 {schedule.plan_count} 个班次。{hiddenRoomCopy}
          </p>
        </div>
        <span className="self-start rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning sm:self-auto">
          限制级预览
        </span>
      </div>
      <div className="divide-y divide-surface-3/60">
        {schedule.rooms.map((room) => (
          <div key={room.key} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(90px,0.65fr)_minmax(80px,0.5fr)_minmax(0,1.8fr)_auto] sm:items-center">
            <div className="font-medium text-ink-primary">
              {room.label}
              {room.index_label && <span className="ml-1 text-ink-muted">{room.index_label}</span>}
            </div>
            <div className="text-ink-muted">{room.product}</div>
            <div className="min-w-0 leading-6 text-ink-secondary">{room.operators.join(', ')}</div>
            <div className="font-mono text-sm font-semibold text-brand-400 sm:text-right">
              {formatPreviewEfficiency(room.efficiency)}
            </div>
          </div>
        ))}
      </div>
      {schedule.rooms.length === 0 && (
        <p className="px-4 py-3 text-sm text-ink-secondary">
          当前配置暂未生成可展示房间，请检查干员数据或基建配置后重试。
        </p>
      )}
    </div>
  )
}

function formatPreviewEfficiency(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return `${value.toFixed(1)}%`
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2/60 p-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink-primary">{value}</p>
    </div>
  )
}

function CdkRedeemPanel({ onLicenseRedeemed }: { onLicenseRedeemed: (license: LicenseFile, licenseFileContent: string) => void }) {
  const [code, setCode] = useState('')
  const [validatedCdk, setValidatedCdk] = useState<{ permission: PermissionMode; permission_label: string } | null>(null)
  const [operators, setOperators] = useState<LicenseOperator[] | null>(null)
  const [operatorsFileName, setOperatorsFileName] = useState<string | null>(null)
  const [config, setConfig] = useState<LicenseConfig>(() => cloneConfig(CONFIG_PRESETS['243']))
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const operatorsRef = useRef<HTMLInputElement>(null)

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
  const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])
  const cdkCanEditConfig = validatedCdk ? canEditCdkConfig(validatedCdk.permission) : false
  const cdkCanEditLimitedConfig = validatedCdk ? canEditCdkLimitedConfig(validatedCdk.permission) : false

  const updateConfig = useCallback((mutate: (config: LicenseConfig) => void) => {
    const next = normalizeConfig(normalizedConfig)
    mutate(next)
    setConfig(next)
  }, [normalizedConfig])

  const handleOperatorsFile = async () => {
    const file = operatorsRef.current?.files?.[0]
    setOperatorsFileName(file?.name ?? null)
    setOperators(null)
    setError(null)
    if (!file) return
    try {
      setOperators(parseOperatorsText(await file.text()))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleCodeChange = (value: string) => {
    setCode(value)
    setValidatedCdk(null)
    setConfirmed(false)
    setError(null)
  }

  const handleValidateCdk = async () => {
    const trimmedCode = code.trim()
    setError(null)
    setValidatedCdk(null)
    if (!trimmedCode) {
      setError('请先填写 CDK。')
      return
    }
    setValidating(true)
    try {
      const resp = await fetch('/api/redeem-cdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: trimmedCode,
          validate_only: true,
        }),
      })
      const data = await resp.json() as {
        error?: string;
        permission?: string;
        permission_label?: string;
      }
      if (!resp.ok) {
        throw new Error(data.error || `CDK 校验失败: ${resp.status}`)
      }
      if (!data.permission || !data.permission_label) {
        throw new Error('CDK 校验响应缺少版本信息。')
      }
      setValidatedCdk({ permission: normalizeCdkPermission(data.permission), permission_label: data.permission_label })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setValidating(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!validatedCdk) {
      setError('请先校验 CDK。')
      return
    }
    if (!operators) {
      setError('请先上传 operators.json。')
      return
    }
    if (!confirmed) {
      setError('请先确认 CDK 使用规则。')
      return
    }
    if (!configValidation.ok) {
      setError(configValidation.message)
      return
    }
    setLoading(true)
    try {
      const resp = await fetch('/api/redeem-cdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          operators,
          config: normalizedConfig,
          activation_token: getPendingActivationToken(),
        }),
      })
      const data = await resp.json() as {
        error?: string;
        license_file_content?: string;
        license?: LicenseFile;
      }
      if (!resp.ok) {
        throw new Error(data.error || `兑换失败: ${resp.status}`)
      }
      if (!data.license_file_content || !data.license) {
        throw new Error('兑换响应缺少授权文件。')
      }
      bindPendingActivationToken(data.license)
      downloadLicenseFile(data.license_file_content, data.license.order_hash)
      onLicenseRedeemed(data.license, data.license_file_content)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="mx-auto max-w-3xl rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
          {error}
        </div>
      )}

      <section className="mx-auto max-w-3xl rounded-xl bg-surface-1 p-5 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK</span>
            <input
              data-tour="cdk-code"
              type="text"
              value={code}
              onChange={(event) => handleCodeChange(event.currentTarget.value)}
              className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink-primary placeholder:text-ink-muted"
              placeholder="MAA-XXXX-XXXX-XXXX"
              required
            />
          </label>
          <button
            type="button"
            onClick={handleValidateCdk}
            disabled={validating || !code.trim()}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
          >
            {validating ? '校验中...' : '校验 CDK'}
          </button>
        </div>
        {validatedCdk && (
          <p className="mt-3 text-sm text-success">
            CDK 可用，版本：{validatedCdk.permission_label}
          </p>
        )}
        {ACTIVE_PURCHASE_CHANNEL?.href && (
          <p className="mt-3 text-sm text-ink-secondary">
            还没有 CDK？
            <a
              href={ACTIVE_PURCHASE_CHANNEL.href}
              target="_blank"
              rel="noreferrer"
              className="ml-1 font-semibold text-brand-500 underline-offset-4 transition-colors duration-150 hover:text-brand-400 hover:underline"
            >
              {ACTIVE_PURCHASE_CHANNEL.actionLabel}
            </a>
          </p>
        )}
      </section>

      {validatedCdk ? (
        <>
          <section className="mx-auto max-w-3xl rounded-xl bg-surface-1 p-5 sm:p-6">
            <div>
              <span className="mb-2 block text-sm font-medium text-ink-secondary">operators.json / .txt</span>
              <button
                data-tour="operator-data"
                type="button"
                onClick={() => operatorsRef.current?.click()}
                className="w-full rounded-lg bg-surface-2 px-4 py-2 text-left text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
              >
                {operatorsFileName ? `已选择：${operatorsFileName}` : '选择干员数据文件'}
              </button>
              {operators && (
                <p className="mt-2 text-xs text-brand-400">已载入 {operators.length} 名干员</p>
              )}
              <input
                ref={operatorsRef}
                type="file"
                accept=".json,.txt,application/json,text/plain"
                onChange={handleOperatorsFile}
                className="hidden"
              />
            </div>
            <OperatorDataGuide />
          </section>

          <div data-tour="base-config">
            <ConfigEditor
              config={normalizedConfig}
              canEdit={cdkCanEditConfig}
              canEditIntermediateInventory={cdkCanEditLimitedConfig}
              canEditShiftHours={cdkCanEditLimitedConfig}
              canSelectPreset
              changed={false}
              permission={validatedCdk.permission}
              validation={configValidation}
              onUpdate={updateConfig}
              note={cdkCanEditConfig
                ? `${validatedCdk.permission_label}可在生成授权文件前调整基建配置。`
                : cdkCanEditLimitedConfig
                  ? `${validatedCdk.permission_label}可选择预设、填写中间产物库存并修改换班间隔；库存不足时仅微调一个制造站产物。`
          : `${validatedCdk.permission_label}仅支持预设配置，单账号终身版以上可自定义基建配置。`}
      />
          </div>

          <section className="mx-auto max-w-3xl rounded-xl bg-surface-1 p-5 sm:p-6" data-tour="redeem-action">
            <label className="flex items-start gap-3 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
                className="mt-1 h-4 w-4 flex-shrink-0 accent-brand-500"
              />
              <span>
            我确认 CDK 仅可首次兑换一次；单账号终身版后续可更新干员数据，但受每 7 天 2 次与账号绑定风控限制。
          </span>
            </label>
            <button
              type="submit"
              disabled={loading || !confirmed || !operators || !code.trim() || !configValidation.ok}
              className="mt-5 w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
            >
              {loading ? '正在生成授权文件...' : '兑换 CDK 并生成授权文件'}
            </button>
          </section>
        </>
      ) : (
        <>
          <LockedStep
            tourTarget="operator-data"
            title="先校验 CDK"
            body="CDK 可用后再导入干员数据，避免提前处理无效或已使用的兑换码。"
          />
          <LockedStep
            tourTarget="base-config"
            title="配置选择暂未开放"
            body="完成 CDK 校验后再选择预设配置。"
          />
          <LockedStep
            tourTarget="redeem-action"
            title="生成授权文件暂未开放"
            body="完成 CDK 校验、干员导入和配置选择后再生成授权文件。"
          />
        </>
      )}
    </form>
  )
}

function LockedStep({ tourTarget, title, body }: { tourTarget: TourTarget; title: string; body: string }) {
  return (
    <section className="mx-auto max-w-3xl rounded-xl bg-surface-1 p-5 sm:p-6" data-tour={tourTarget}>
      <p className="text-sm font-semibold text-ink-primary">{title}</p>
      <p className="mt-1 text-sm leading-6 text-ink-secondary">{body}</p>
    </section>
  )
}

function OperatorDataGuide() {
  return (
    <div className="mt-5 rounded-lg bg-surface-2/60 p-4 text-sm text-ink-secondary">
      <p className="font-medium text-ink-primary">1. 导出干员数据</p>
      <p className="mt-2">
        通过 <a className="text-brand-400 underline-offset-4 hover:underline" href="https://github.com/MaaAssistantArknights/MaaAssistantArknights" target="_blank" rel="noreferrer">MAA</a> 导出干员数据到 <span className="font-mono text-ink-primary">operators.json</span>。
      </p>
      <details className="mt-3 rounded-lg border border-surface-3 bg-surface-1/70">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-brand-500 transition-colors duration-150 hover:text-brand-400">
          找不到干员识别入口？展开查看
        </summary>
        <div className="border-t border-surface-3 px-3 pb-3 pt-3">
          <ol className="list-decimal space-y-1 pl-5">
            <li>打开 MAA 顶部的 <span className="font-medium text-ink-primary">小工具</span> 页签。</li>
            <li>进入 <span className="font-medium text-ink-primary">干员识别</span>，点击开始识别并等待识别完成。</li>
            <li>导出到剪贴板后粘贴到新建的 <span className="font-mono text-ink-primary">TXT/JSON</span> 文件，或直接导出 JSON 文件。</li>
          </ol>
          <div className="mt-3 overflow-hidden rounded-lg border border-surface-3 bg-surface-0">
            <img
              src="/assets/maa-operator-recognition-guide.png"
              alt="MAA 小工具页签中的干员识别入口和导出位置示意图"
              className="block h-auto w-full"
              loading="lazy"
            />
          </div>
        </div>
      </details>
    </div>
  )
}

function FirstRunTour({
  open,
  steps,
  onClose,
  onModeChange,
}: {
  open: boolean;
  steps: TourStep[];
  onClose: () => void;
  onModeChange: (mode: EntryMode) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const activeStep = steps[activeIndex]
  const isLastStep = activeIndex === steps.length - 1

  useEffect(() => {
    if (!open) return
    setActiveIndex(0)
  }, [open])

  useEffect(() => {
    if (activeIndex > steps.length - 1) {
      setActiveIndex(0)
    }
  }, [activeIndex, steps.length])

  useEffect(() => {
    if (!open || !activeStep) return
    if (!['announcement', 'entry-mode'].includes(activeStep.target)) onModeChange('cdk')

    let frame = 0
    let settleTimer = 0
    const measureTarget = () => {
      const target = document.querySelector<HTMLElement>(`[data-tour="${activeStep.target}"]`)
      if (!target) return false
      setTargetRect(target.getBoundingClientRect())
      return true
    }
    const focusTarget = () => {
      setTargetRect(null)
      const target = document.querySelector<HTMLElement>(`[data-tour="${activeStep.target}"]`)
      if (!target) {
        frame = window.requestAnimationFrame(focusTarget)
        return
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      frame = window.requestAnimationFrame(measureTarget)
      settleTimer = window.setTimeout(measureTarget, 280)
    }

    focusTarget()
    window.addEventListener('resize', measureTarget)
    window.addEventListener('scroll', measureTarget, true)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      window.removeEventListener('resize', measureTarget)
      window.removeEventListener('scroll', measureTarget, true)
    }
  }, [activeIndex, activeStep, onModeChange, open])

  if (!open || !activeStep) return null

  const paddedRect = targetRect
    ? {
      top: Math.max(12, targetRect.top - 10),
      left: Math.max(12, targetRect.left - 10),
      width: Math.min(window.innerWidth - 24, targetRect.width + 20),
      height: targetRect.height + 20,
    }
    : null
  const panelStyle = getTourPanelStyle(paddedRect)

  const handleNext = () => {
    if (isLastStep) {
      onClose()
      return
    }
    setActiveIndex((index) => Math.min(index + 1, steps.length - 1))
  }

  const handlePrevious = () => {
    setActiveIndex((index) => Math.max(index - 1, 0))
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="first-run-tour-title">
      {paddedRect ? (
        <>
          <div className="fixed inset-x-0 top-0 bg-black/68 backdrop-blur-[1px]" style={{ height: paddedRect.top }} />
          <div
            className="fixed left-0 bg-black/68 backdrop-blur-[1px]"
            style={{ top: paddedRect.top, width: paddedRect.left, height: paddedRect.height }}
          />
          <div
            className="fixed right-0 bg-black/68 backdrop-blur-[1px]"
            style={{
              top: paddedRect.top,
              left: paddedRect.left + paddedRect.width,
              height: paddedRect.height,
            }}
          />
          <div
            className="fixed inset-x-0 bottom-0 bg-black/68 backdrop-blur-[1px]"
            style={{ top: paddedRect.top + paddedRect.height }}
          />
          <div
            className="pointer-events-none fixed rounded-xl border-2 border-brand-300"
            style={{
              top: paddedRect.top,
              left: paddedRect.left,
              width: paddedRect.width,
              height: paddedRect.height,
            }}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-black/68 backdrop-blur-[1px]" />
      )}

      <div
        className="fixed w-[min(22rem,calc(100vw-2rem))] rounded-xl bg-surface-1 p-5 text-left"
        style={panelStyle}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-brand-500">
            {activeIndex + 1} / {steps.length}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm font-medium text-ink-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink-primary"
          >
            跳过
          </button>
        </div>
        <h2 id="first-run-tour-title" className="text-lg font-semibold text-ink-primary">
          {activeStep.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{activeStep.body}</p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={activeIndex === 0}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-2 hover:text-ink-primary disabled:pointer-events-none disabled:text-ink-muted/60"
          >
            上一步
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
          >
            {isLastStep ? '知道了' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}

function getTourPanelStyle(rect: { top: number; left: number; width: number; height: number } | null) {
  const margin = 16
  const panelWidth = Math.min(352, window.innerWidth - margin * 2)
  const panelHeight = 230
  if (!rect) {
    return {
      top: `calc(50vh - ${panelHeight / 2}px)`,
      left: `calc(50vw - ${panelWidth / 2}px)`,
    }
  }

  const belowTop = rect.top + rect.height + margin
  const aboveTop = rect.top - panelHeight - margin
  const top = belowTop + panelHeight <= window.innerHeight - margin
    ? belowTop
    : Math.max(margin, aboveTop)
  const preferredLeft = rect.left + rect.width / 2 - panelWidth / 2
  const left = Math.min(window.innerWidth - panelWidth - margin, Math.max(margin, preferredLeft))

  return {
    top,
    left,
  }
}

function parseOperatorsText(text: string): LicenseOperator[] {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (!Array.isArray(data)) {
    throw new Error('operators.json 顶层必须是数组。')
  }
  return data as LicenseOperator[]
}

function parseScheduleText(text: string): unknown {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (!Array.isArray(data) && (!data || typeof data !== 'object')) {
    throw new Error('排班表 JSON 需要是对象或数组。')
  }
  return data
}

async function readResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json() as { error?: string }
    return data.error || fallback
  } catch {
    return fallback
  }
}

function normalizeCdkPermission(permission: string): PermissionMode {
  if (permission === 'recommended' || permission === 'growth' || permission === 'advanced' || permission === 'ultimate' || permission === 'admin') {
    return permission
  }
  if (permission === 'premium') return 'advanced'
  return 'growth'
}

function canEditCdkConfig(permission: PermissionMode): boolean {
  return permission === 'advanced' || permission === 'ultimate' || permission === 'admin'
}

function canEditCdkLimitedConfig(permission: PermissionMode): boolean {
  return permission === 'recommended' || permission === 'growth'
}

