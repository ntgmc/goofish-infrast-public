import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { Announcement, AppStep, LicenseConfig, LicenseFile } from '../lib/types'
import { extractConfigOverride, extractEliteOverrides, extractLicense, parseFileContent } from '../lib/license'
import UploadPage from './UploadPage'

const OptimizePage = lazy(() => import('./OptimizePage'))

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
