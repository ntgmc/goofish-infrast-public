import { useMemo, useState, useRef, useCallback } from 'react'
import type { LicenseConfig, LicenseFile, LicenseOperator } from '../lib/types'
import ConfigEditor, { CONFIG_PRESETS, cloneConfig, normalizeConfig, validateConfig } from '../components/ConfigEditor'
import BuildMetaStrip from '../components/BuildMetaStrip'

interface Props {
  onFileLoaded: (content: string) => Promise<void>;
  onLicenseRedeemed: (license: LicenseFile) => void;
  error: string | null;
}

type EntryMode = 'license' | 'cdk'

export default function UploadPage({ onFileLoaded, onLicenseRedeemed, error }: Props) {
  const [mode, setMode] = useState<EntryMode>('license')

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
            上传授权文件或使用 CDK 生成排班
          </p>
          <BuildMetaStrip placement="corner" />
        </div>

        <div className="mb-5 flex justify-center">
          <div className="inline-flex rounded-lg bg-surface-1 p-1">
            <ModeButton label="上传授权文件" active={mode === 'license'} onClick={() => setMode('license')} />
            <ModeButton label="使用 CDK 生成工作文件" active={mode === 'cdk'} onClick={() => setMode('cdk')} />
          </div>
        </div>

        {mode === 'license' ? (
          <LicenseUploadPanel onFileLoaded={onFileLoaded} error={error} />
        ) : (
          <CdkRedeemPanel onLicenseRedeemed={onLicenseRedeemed} />
        )}

        <p className="mt-6 text-center text-xs text-ink-muted">
          授权文件和工作文件通常以 .maa 结尾，文件内容已加密，无需打开查看。
        </p>
      </div>
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
            授权文件或工作文件
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
            aria-label="上传授权文件或工作文件"
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
                拖拽授权文件或工作文件到此处，或点击选择
              </p>
              <p className="text-xs text-ink-muted">
                支持卖家下发的授权文件，或本工具保存的工作文件
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
              aria-label="选择授权文件或工作文件"
            />
          </div>
          <div className="mt-4 grid gap-3 text-left sm:grid-cols-2">
            <div className="rounded-lg bg-surface-2/60 p-3">
              <p className="text-sm font-medium text-ink-primary">第一次使用</p>
              <p className="mt-1 text-xs text-ink-secondary">
                上传卖家给你的授权文件，用于生成排班。
              </p>
            </div>
            <div className="rounded-lg bg-surface-2/60 p-3">
              <p className="text-sm font-medium text-ink-primary">继续调整</p>
              <p className="mt-1 text-xs text-ink-secondary">
                上传之前保存的工作文件，继续上次的练度调整。
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleUpload}
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
        >
          {loading ? '验证中...' : selectedFileName ? '验证并进入' : '选择授权文件'}
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

      <ConfigEditor
        config={normalizedConfig}
        canEdit
        changed={false}
        validation={configValidation}
        onUpdate={updateConfig}
        note="提交前可选择或调整基建配置；提交成功后本次导入的干员和配置不能再次修改。"
      />

      <section className="mx-auto max-w-3xl rounded-xl bg-surface-1 p-5 sm:p-6">
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
          {loading ? '正在生成工作文件...' : '兑换并生成工作文件'}
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

function downloadLicense(content: string, orderHash: string) {
  const blob = new Blob([content], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `maa-license-${orderHash.slice(0, 8)}.maa`
  a.click()
  URL.revokeObjectURL(url)
}
