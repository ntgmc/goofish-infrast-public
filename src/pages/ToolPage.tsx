import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { Announcement, AnnouncementPublicResponse, AppStep, LicenseConfig, LicenseFile } from '../lib/types'
import { extractConfigOverride, extractEliteOverrides, extractLicense, parseFileContent } from '../lib/license'
import { downloadLicenseFile } from '../lib/download'
import AnnouncementPopup from '../components/AnnouncementPopup'
import UploadPage from './UploadPage'

const OptimizePage = lazy(() => import('./OptimizePage'))
const VISITOR_ID_KEY = 'maa_visitor_id'

export default function ToolPage() {
  const [step, setStep] = useState<AppStep>('upload')
  const [license, setLicense] = useState<LicenseFile | null>(null)
  const [eliteOverrides, setEliteOverrides] = useState<Record<string, number>>({})
  const [configOverride, setConfigOverride] = useState<LicenseConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<Announcement | null>(null)
  const [popups, setPopups] = useState<Announcement[]>([])
  const [redeemedNotice, setRedeemedNotice] = useState<string | null>(null)
  const [redeemedLicenseContent, setRedeemedLicenseContent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/announcement')
      .then(async (resp) => {
        if (!resp.ok) return null
        return await resp.json() as AnnouncementPublicResponse
      })
      .then((data) => {
        if (cancelled) return
        setBanner(data?.banner ?? null)
        setPopups(Array.isArray(data?.popups) ? data.popups : [])
      })
      .catch(() => {
        if (!cancelled) {
          setBanner(null)
          setPopups([])
        }
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
    setRedeemedNotice(null)
    setRedeemedLicenseContent(null)
    setStep('optimize')
  }, [])

  const handleReset = useCallback(() => {
    setStep('upload')
    setLicense(null)
    setEliteOverrides({})
    setConfigOverride(null)
    setError(null)
    setRedeemedNotice(null)
    setRedeemedLicenseContent(null)
  }, [])

  const handleLicenseRedeemed = useCallback((redeemedLicense: LicenseFile, licenseFileContent: string) => {
    setError(null)
    setLicense(redeemedLicense)
    setEliteOverrides({})
    setConfigOverride(null)
    setRedeemedNotice('CDK 已兑换完成，授权文件已开始下载。请务必保存该授权文件，后续可凭它继续使用或恢复进度。')
    setRedeemedLicenseContent(licenseFileContent)
    setStep('optimize')
  }, [])

  const handleRedownloadLicense = useCallback(() => {
    if (!license || !redeemedLicenseContent) return
    downloadLicenseFile(redeemedLicenseContent, license.order_hash)
  }, [license, redeemedLicenseContent])

  return (
    <>
      <AnnouncementPopup announcements={popups} />
      <a
        href="/announcements"
        className="fixed bottom-4 right-4 z-30 rounded-lg border border-surface-3 bg-surface-0 px-3 py-2 text-sm font-semibold text-ink-secondary shadow-sm transition-colors duration-150 hover:bg-surface-1 hover:text-ink-primary"
      >
        公告
      </a>
      {step === 'upload' && (
        <UploadPage
          onFileLoaded={handleFileLoaded}
          onLicenseRedeemed={handleLicenseRedeemed}
          error={error}
          announcement={banner}
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
            announcement={banner}
            redeemedNotice={redeemedNotice}
            onRedownloadLicense={redeemedLicenseContent ? handleRedownloadLicense : null}
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
