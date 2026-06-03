import { useState, useCallback } from 'react'
import type { LicenseFile, AppStep } from './lib/types'
import { parseFileContent, extractLicense, extractEliteOverrides } from './lib/license'
import UploadPage from './pages/UploadPage'
import OptimizePage from './pages/OptimizePage'

function App() {
  const [step, setStep] = useState<AppStep>('upload')
  const [license, setLicense] = useState<LicenseFile | null>(null)
  const [eliteOverrides, setEliteOverrides] = useState<Record<string, number>>({})
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
    setStep('optimize')
  }, [])

  const handleReset = useCallback(() => {
    setStep('upload')
    setLicense(null)
    setEliteOverrides({})
    setError(null)
  }, [])

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {step === 'upload' && (
        <UploadPage onFileLoaded={handleFileLoaded} error={error} />
      )}
      {step === 'optimize' && license && (
        <OptimizePage
          license={license}
          eliteOverrides={eliteOverrides}
          setEliteOverrides={setEliteOverrides}
          onReset={handleReset}
        />
      )}
    </div>
  )
}

export default App


