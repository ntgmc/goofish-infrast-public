import { useEffect, useRef } from 'react'
import { reportToolVisit } from '../../lib/usage-tracking'

export function useToolVisitReporter(enabled: boolean): void {
  const reportedRef = useRef(false)

  useEffect(() => {
    if (!enabled || reportedRef.current) return

    reportedRef.current = true
    void reportToolVisit()
  }, [enabled])
}
