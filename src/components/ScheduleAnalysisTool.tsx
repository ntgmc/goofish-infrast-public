import { lazy, Suspense, useRef, useState, type FormEvent } from 'react'
import type { AnalyzeScheduleResult, LicenseOperator } from '../lib/types'
import { apiJson } from '../lib/api-client'

const ResultPanel = lazy(() => import('./ResultPanel'))

const ACCEPTED_FILE_TYPES = '.json,.txt,application/json,text/plain'

interface ScheduleAnalysisToolProps {
  compact?: boolean
}

export default function ScheduleAnalysisTool({ compact = false }: ScheduleAnalysisToolProps) {
  const operatorsRef = useRef<HTMLInputElement | null>(null)
  const scheduleRef = useRef<HTMLInputElement | null>(null)
  const [operators, setOperators] = useState<LicenseOperator[] | null>(null)
  const [schedule, setSchedule] = useState<unknown | null>(null)
  const [operatorsFileName, setOperatorsFileName] = useState<string | null>(null)
  const [scheduleFileName, setScheduleFileName] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeScheduleResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOperatorsFile = async () => {
    const file = operatorsRef.current?.files?.[0]
    setOperatorsFileName(file?.name ?? null)
    setOperators(null)
    setResult(null)
    setError(null)
    if (!file) return

    try {
      setOperators(parseOperatorsText(await file.text()))
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  const handleScheduleFile = async () => {
    const file = scheduleRef.current?.files?.[0]
    setScheduleFileName(file?.name ?? null)
    setSchedule(null)
    setResult(null)
    setError(null)
    if (!file) return

    try {
      setSchedule(parseScheduleText(await file.text()))
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  const handleAnalyze = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!operators) {
      setError('请先上传 operators.json。')
      return
    }
    if (!schedule) {
      setError('请先上传排班表 JSON。')
      return
    }

    setLoading(true)
    try {
      const data = await apiJson<AnalyzeScheduleResult>('/api/analyze-schedule', {
        method: 'POST',
        json: { operators, schedule },
        fallbackMessage: '分析失败',
      })
      setResult(data)
    } catch (caught) {
      setResult(null)
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={compact ? 'space-y-6' : 'mx-auto max-w-5xl space-y-6'}>
      <form onSubmit={handleAnalyze} className="rounded-lg border border-surface-3 bg-surface-1 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">分析导入排班表</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              上传干员数据和已生成的排班 JSON，直接计算红脸风险、日产量和爆仓信息。
            </p>
          </div>
          <span className="inline-flex w-fit rounded-full bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-300">
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
          accept={ACCEPTED_FILE_TYPES}
          onChange={handleOperatorsFile}
          className="hidden"
        />
        <input
          ref={scheduleRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          onChange={handleScheduleFile}
          className="hidden"
        />

        <button
          type="submit"
          disabled={loading || !operators || !schedule}
          className="mt-5 w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
        >
          {loading ? '正在分析...' : result ? '重新分析排班表' : '开始分析排班表'}
        </button>
      </form>

      {result && <ResultPanel result={result} variant="analysis" detailDefaultOpen={false} />}
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
  label: string
  hint: string
  fileName: string | null
  loadedText: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[8.5rem] rounded-lg border border-surface-3 bg-surface-0 p-4 text-left transition-colors duration-150 hover:border-brand-500/50 hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-brand-500/45"
    >
      <span className="block text-sm font-semibold text-ink-primary">{label}</span>
      <span className="mt-1 block text-xs text-ink-muted">{hint}</span>
      <span className="mt-4 block break-all text-sm font-medium text-ink-secondary">
        {fileName ? `已选择：${fileName}` : '点击选择文件'}
      </span>
      {loadedText && <span className="mt-2 block text-xs font-semibold text-success">{loadedText}</span>}
    </button>
  )
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
