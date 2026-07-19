import { lazy, useRef, useState, type FormEvent } from 'react'
import type { AnalyzeScheduleResult, LicenseOperator } from '../lib/types'
import { apiJson } from '../lib/api-client'
import { copy } from '../copy/index'


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
      setError(copy.tools.components_ScheduleAnalysisTool_001)
      return
    }
    if (!schedule) {
      setError(copy.tools.components_ScheduleAnalysisTool_002)
      return
    }

    setLoading(true)
    try {
      const data = await apiJson<AnalyzeScheduleResult>('/api/analyze-schedule', {
        method: 'POST',
        json: { operators, schedule },
        fallbackMessage: copy.tools.components_ScheduleAnalysisTool_003,
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
      <form onSubmit={handleAnalyze} className="tool-panel p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">{copy.tools.components_ScheduleAnalysisTool_004}</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {copy.tools.components_ScheduleAnalysisTool_005}</p>
          </div>
          <span className="tool-status tool-status--current w-fit">
            {copy.tools.components_ScheduleAnalysisTool_006}</span>
        </div>

        {error && (
          <div className="tool-alert tool-alert--error mt-5" role="alert">
            {error}
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <FilePickButton
            label={copy.tools.components_ScheduleAnalysisTool_007}
            hint="operators.json / .txt"
            fileName={operatorsFileName}
            loadedText={operators ? `${copy.tools.components_ScheduleAnalysisTool_008}${operators.filter((operator) => operator.own !== false).length}${copy.tools.components_ScheduleAnalysisTool_009}` : ''}
            onClick={() => operatorsRef.current?.click()}
          />
          <FilePickButton
            label={copy.tools.components_ScheduleAnalysisTool_010}
            hint="maa_schedule_optimized.json"
            fileName={scheduleFileName}
            loadedText={schedule ? copy.tools.components_ScheduleAnalysisTool_011 : ''}
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
          className="tool-primary-action mt-5 w-full"
        >
          {loading ? copy.tools.components_ScheduleAnalysisTool_012 : result ? copy.tools.components_ScheduleAnalysisTool_013 : copy.tools.components_ScheduleAnalysisTool_014}
        </button>
      </form>

      {result && (
        <ResultPanel
          result={result}
          operators={operators ?? undefined}
          variant="analysis"
          detailDefaultOpen={false}
        />
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
      className="tool-inset min-h-[8.5rem] p-4 text-left transition-colors duration-150 hover:border-brand-500/50 hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-brand-500/45"
    >
      <span className="block text-sm font-semibold text-ink-primary">{label}</span>
      <span className="mt-1 block text-xs text-ink-muted">{hint}</span>
      <span className="mt-4 block break-all text-sm font-medium text-ink-secondary">
        {fileName ? `${copy.tools.components_ScheduleAnalysisTool_015}${fileName}` : copy.tools.components_ScheduleAnalysisTool_016}
      </span>
      {loadedText && <span className="mt-2 block text-xs font-semibold text-success">{loadedText}</span>}
    </button>
  )
}

function parseOperatorsText(text: string): LicenseOperator[] {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (!Array.isArray(data)) {
    throw new Error(copy.tools.components_ScheduleAnalysisTool_017)
  }
  return data as LicenseOperator[]
}

function parseScheduleText(text: string): unknown {
  const data = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
  if (!Array.isArray(data) && (!data || typeof data !== 'object')) {
    throw new Error(copy.tools.components_ScheduleAnalysisTool_018)
  }
  return data
}
