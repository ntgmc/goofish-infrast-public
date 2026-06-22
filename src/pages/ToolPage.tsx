import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { Announcement, AppStep, LicenseConfig, LicenseFile } from '../lib/types'
import { extractConfigOverride, extractEliteOverrides, extractLicense, parseFileContent } from '../lib/license'
import UploadPage from './UploadPage'

const OptimizePage = lazy(() => import('./OptimizePage'))
const VISITOR_ID_KEY = 'maa_visitor_id'

export default function ToolPage() {
  const [step, setStep] = useState<AppStep>('upload')
  const [license, setLicense] = useState<LicenseFile | null>(null)
  const [eliteOverrides, setEliteOverrides] = useState<Record<string, number>>({})
  const [configOverride, setConfigOverride] = useState<LicenseConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/announcement')
      .then(async (resp) => {
        if (!resp.ok) return null
        return await resp.json() as Partial<Announcement>
      })
      .then((data) => {
        if (cancelled) return
        if (data?.enabled && typeof data.title === 'string' && typeof data.body === 'string') {
          setAnnouncement({
            enabled: true,
            title: data.title,
            body: data.body,
            updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
          })
        } else {
          setAnnouncement(null)
        }
      })
      .catch(() => {
        if (!cancelled) setAnnouncement(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const visitorId = getOrCreateVisitorId()
    if (!visitorId) return

    fetch('/api/usage-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'tool_visit', visitor_id: visitorId }),
    }).catch(() => {
      // Usage stats must never block the short tool flow.
    })
  }, [])

  const handleFileLoaded = useCallback(async (content: string) => {
    setError(null)
    const result = await parseFileContent(content)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setLicense(extractLicense(result.data))
    setEliteOverrides(extractEliteOverrides(result.data))
    setConfigOverride(extractConfigOverride(result.data))
    setStep('optimize')
  }, [])

  const handleReset = useCallback(() => {
    setStep('upload')
    setLicense(null)
    setEliteOverrides({})
    setConfigOverride(null)
    setError(null)
  }, [])

  const handleLicenseRedeemed = useCallback((redeemedLicense: LicenseFile) => {
    setError(null)
    setLicense(redeemedLicense)
    setEliteOverrides({})
    setConfigOverride(null)
    setStep('optimize')
  }, [])

  return (
    <>
      {step === 'upload' && (
        <UploadPage
          onFileLoaded={handleFileLoaded}
          onLicenseRedeemed={handleLicenseRedeemed}
          error={error}
          announcement={announcement}
        />
      )}
      {step === 'optimize' && license && (
        <Suspense fallback={
          <div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">
            正在载入排班工具...
          </div>
        }>
          <OptimizePage
            license={license}
            setLicense={setLicense}
            eliteOverrides={eliteOverrides}
            setEliteOverrides={setEliteOverrides}
            configOverride={configOverride}
            setConfigOverride={setConfigOverride}
            onReset={handleReset}
            announcement={announcement}
          />
        </Suspense>
      )}
    </>
  )
}

function getOrCreateVisitorId(): string | null {
  try {
    const existing = window.localStorage.getItem(VISITOR_ID_KEY)
    if (existing) return existing

    const next = `maa_${createRandomId()}`
    window.localStorage.setItem(VISITOR_ID_KEY, next)
    return next
  } catch {
    return `maa_${createRandomId()}`
  }
}

function createRandomId(): string {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}
