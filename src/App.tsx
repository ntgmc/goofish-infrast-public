import { lazy, Suspense, useState, useCallback } from 'react'
import type { LicenseConfig, LicenseFile, AppStep } from './lib/types'
import { parseFileContent, extractLicense, extractEliteOverrides, extractConfigOverride } from './lib/license'
import UploadPage from './pages/UploadPage'

const OptimizePage = lazy(() => import('./pages/OptimizePage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

function App() {
  const [step, setStep] = useState<AppStep>('upload')
  const [license, setLicense] = useState<LicenseFile | null>(null)
  const [eliteOverrides, setEliteOverrides] = useState<Record<string, number>>({})
  const [configOverride, setConfigOverride] = useState<LicenseConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  if (window.location.pathname === '/admin') {
    return (
      <div className="min-h-screen bg-surface-0 text-ink-primary">
        <Suspense fallback={
          <div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">
            正在载入管理后台...
          </div>
        }>
          <AdminPage />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      {step === 'upload' && (
        <UploadPage
          onFileLoaded={handleFileLoaded}
          onLicenseRedeemed={handleLicenseRedeemed}
          error={error}
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
            eliteOverrides={eliteOverrides}
            setEliteOverrides={setEliteOverrides}
            configOverride={configOverride}
            setConfigOverride={setConfigOverride}
            onReset={handleReset}
          />
        </Suspense>
      )}
    </div>
  )
}

export default App
