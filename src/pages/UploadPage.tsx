import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import type { Announcement, LicenseConfig, LicenseFile, LicenseOperator } from '../lib/types'
import AnnouncementBanner from '../components/AnnouncementBanner'
import ConfigEditor, { CONFIG_PRESETS, cloneConfig, normalizeConfig, validateConfig } from '../components/ConfigEditor'
import BuildMetaStrip from '../components/BuildMetaStrip'

interface Props {
  onFileLoaded: (content: string) => Promise<void>;
  onLicenseRedeemed: (license: LicenseFile) => void;
  error: string | null;
  announcement: Announcement | null;
}

type EntryMode = 'license' | 'cdk'

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
    body: '第一次使用请选择 CDK，网站会生成授权文件；已有 .maa 文件时选择上传继续使用。',
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
  const [mode, setMode] = useState<EntryMode>('license')
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
            输入 CDK 生成授权文件，或上传已有 .maa 文件
          </p>
          <BuildMetaStrip placement="corner" />
        </div>

        <div data-tour={announcement?.enabled ? 'announcement' : undefined}>
          <AnnouncementBanner announcement={announcement} className="mb-5" />
        </div>

        <div className="mb-5 flex justify-center">
          <div className="inline-flex rounded-lg bg-surface-1 p-1" data-tour="entry-mode">
            <ModeButton label="上传 .maa 文件" active={mode === 'license'} onClick={() => setMode('license')} />
            <ModeButton label="使用 CDK 生成授权文件" active={mode === 'cdk'} onClick={() => setMode('cdk')} />
          </div>
        </div>

        {mode === 'license' ? (
          <LicenseUploadPanel onFileLoaded={onFileLoaded} error={error} />
        ) : (
          <CdkRedeemPanel onLicenseRedeemed={onLicenseRedeemed} />
        )}

        <p className="mt-6 text-center text-xs text-ink-muted">
          CDK 会在本站生成授权文件。授权文件和保存进度文件通常以 .maa 结尾，下次可直接上传继续调整。
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

function CdkRedeemPanel({ onLicenseRedeemed }: { onLicenseRedeemed: (license: LicenseFile) => void }) {
  const [code, setCode] = useState('')
  const [operators, setOperators] = useState<LicenseOperator[] | null>(null)
  const [operatorsFileName, setOperatorsFileName] = useState<string | null>(null)
  const [config, setConfig] = useState<LicenseConfig>(() => cloneConfig(CONFIG_PRESETS['243']))
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const operatorsRef = useRef<HTMLInputElement>(null)

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
  const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])

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
      const data = JSON.parse(await file.text()) as unknown
      if (!Array.isArray(data)) {
        throw new Error('operators.json 顶层必须是数组。')
      }
      setOperators(data as LicenseOperator[])
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!operators) {
      setError('请先上传 operators.json。')
      return
    }
    if (!confirmed) {
      setError('请先确认 CDK 仅可使用一次。')
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
      downloadLicense(data.license_file_content, data.license.order_hash)
      onLicenseRedeemed(data.license)
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
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">CDK</span>
            <input
              data-tour="cdk-code"
              type="text"
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
              className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 font-mono text-sm uppercase tracking-wide text-ink-primary placeholder:text-ink-muted"
              placeholder="MAA-XXXX-XXXX-XXXX"
              required
            />
          </label>
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
          note="提交前可选择或调整基建配置；提交成功后本次导入的干员和配置不能再次修改。"
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
            我确认 CDK 仅可使用一次，提交后本次导入的干员和配置不能再次修改。
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
    </form>
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

function downloadLicense(content: string, orderHash: string) {
  const blob = new Blob([content], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `maa-license-${orderHash.slice(0, 8)}.maa`
  a.click()
  URL.revokeObjectURL(url)
}
