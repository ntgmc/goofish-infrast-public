import { useEffect, useRef, useState } from 'react'
import { useAppReducedMotion } from './motion-preference'
import { projectValueClock, type GainClockSnapshot, type ValueClockSnapshot } from './value-clock'

export function useValueClockReadings(data: { snapshot: ValueClockSnapshot | GainClockSnapshot; receivedAt: number } | undefined, paused: boolean) {
  const reduced = useAppReducedMotion()
  const [calibrated, setCalibrated] = useState(false)
  const previous = useRef<typeof data>(undefined)
  const [reading, setReading] = useState<ReturnType<typeof projectValueClock> & { details: ReturnType<typeof projectValueClock> | null; stale: boolean }>({ totals: null, today: null, details: null, stale: false })
  useEffect(() => {
    if (!data) return
    const old = previous.current
    if (old && (old.snapshot.series_id !== data.snapshot.series_id || data.snapshot.revision !== old.snapshot.revision && (data.snapshot.totals?.sanity ?? 0) < (projectValueClock(old.snapshot, performance.now() - old.receivedAt).totals?.sanity ?? 0) - 0.005)) setCalibrated(true)
    previous.current = data
    const snapshot = data.snapshot
    const moving = snapshot.status === 'ready' && Object.values(snapshot.rates_per_second ?? {}).some((rate) => rate !== 0)
    let timer = 0, detailsAt = -Infinity
    const tick = () => {
      if (document.hidden) return
      const now = performance.now()
      const elapsed = now - data.receivedAt + Math.max(0, Date.parse(snapshot.server_now) - Date.parse(snapshot.as_of))
      const values = projectValueClock(snapshot, elapsed)
      const remaining = snapshot.valid_until ? Date.parse(snapshot.valid_until) - Date.parse(snapshot.as_of) - elapsed : null
      const stale = remaining !== null && remaining <= 0
      const refreshDetails = now - detailsAt >= 1000 || stale
      if (refreshDetails) detailsAt = now
      setReading((current) => paused ? current.stale === stale ? current : { ...current, stale }
        : { ...values, details: refreshDetails ? values : current.details, stale })
      if (remaining !== null && !stale) timer = window.setTimeout(tick, moving && !paused ? Math.min(reduced ? 1000 : 250, remaining) : remaining)
    }
    const visibility = () => { clearTimeout(timer); tick() }
    tick()
    document.addEventListener('visibilitychange', visibility)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) }
  }, [data, reduced, paused])
  return { reading, calibrated, reduced }
}
