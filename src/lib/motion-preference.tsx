import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { copy } from '../copy/index'

const STORAGE_KEY = 'maatool-reduce-motion'
const SYSTEM_QUERY = '(prefers-reduced-motion: reduce)'

type MotionPreference = {
  reducedMotion: boolean
  systemReducedMotion: boolean
  storageError: boolean
  setReduceAnimations: (enabled: boolean) => void
}

const MotionPreferenceContext = createContext<MotionPreference | null>(null)

function readPreference() {
  try { return window.localStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
}

export function MotionPreferenceProvider({ children }: { children: ReactNode }) {
  const [reduceAnimations, setReduceAnimations] = useState(readPreference)
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(SYSTEM_QUERY).matches))
  const [storageError, setStorageError] = useState(false)
  const [autoDetect, setAutoDetect] = useState(true)
  const [showAutoReducedToast, setShowAutoReducedToast] = useState(false)
  const reducedMotion = reduceAnimations || systemReducedMotion

  useEffect(() => {
    if (!showAutoReducedToast) return
    const timeout = window.setTimeout(() => setShowAutoReducedToast(false), 5000)
    return () => window.clearTimeout(timeout)
  }, [showAutoReducedToast])

  useEffect(() => {
    const query = window.matchMedia?.(SYSTEM_QUERY)
    if (!query) return
    const onChange = (event: MediaQueryListEvent) => setSystemReducedMotion(event.matches)
    setSystemReducedMotion(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-reduced-motion', reducedMotion)
    return () => document.documentElement.removeAttribute('data-reduced-motion')
  }, [reducedMotion])

  const setPreference = useCallback((enabled: boolean) => {
    setReduceAnimations(enabled)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(enabled))
      setStorageError(false)
    } catch { setStorageError(true) }
  }, [])

  useEffect(() => {
    if (reducedMotion || !autoDetect) return
    let frame: number | null = null
    let startedAt = 0
    let previousTime = 0
    let slowFrames = 0
    let slowTime = 0
    let smoothTime = 0
    const events = ['click', 'keydown', 'scroll', 'animationstart', 'transitionrun'] as const

    const stop = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = null
    }
    const sample = (time: number) => {
      frame = null
      if (document.visibilityState !== 'visible') return
      const elapsed = time - previousTime
      previousTime = time
      // Require prolonged severe stuttering, discarding pauses once rendering recovers.
      if (elapsed >= 100) {
        slowFrames += 1
        slowTime += elapsed
        smoothTime = 0
      } else {
        smoothTime += elapsed
        if (smoothTime >= 1000) slowFrames = slowTime = 0
      }
      if (slowFrames >= 5 && slowTime >= 5000) {
        setPreference(true)
        setShowAutoReducedToast(true)
        return
      }
      if (time - startedAt < 10000) frame = window.requestAnimationFrame(sample)
    }
    const start = () => {
      if (frame !== null || document.visibilityState !== 'visible') return
      startedAt = previousTime = performance.now()
      slowFrames = slowTime = smoothTime = 0
      frame = window.requestAnimationFrame(sample)
    }
    for (const event of events) document.addEventListener(event, start, { capture: true, passive: true })
    document.addEventListener('visibilitychange', stop)
    return () => {
      stop()
      for (const event of events) document.removeEventListener(event, start, true)
      document.removeEventListener('visibilitychange', stop)
    }
  }, [reducedMotion, autoDetect, setPreference])

  const value = useMemo(() => ({
    reducedMotion, systemReducedMotion, storageError,
    setReduceAnimations: (enabled: boolean) => {
      setAutoDetect(false)
      setPreference(enabled)
    },
  }), [reducedMotion, systemReducedMotion, storageError, setPreference])
  return <MotionPreferenceContext.Provider value={value}>
    {children}
    {showAutoReducedToast && <div className="pointer-events-none fixed inset-x-4 top-4 z-[70] flex justify-center sm:inset-x-auto sm:right-6 sm:top-6" role="status" aria-live="polite" aria-atomic="true">
      <div className="tool-alert tool-alert--info pointer-events-auto flex w-full max-w-md items-center gap-3 bg-surface-1 shadow-lg">
        <p className="min-w-0 flex-1 text-sm font-medium leading-6">{copy.common.animationAutoReduced}</p>
        <button type="button" className="-my-2 -mr-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-lg text-ink-muted hover:bg-surface-2 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          onClick={() => setShowAutoReducedToast(false)} aria-label={copy.common.animationDismissToast}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>}
  </MotionPreferenceContext.Provider>
}

export function useMotionPreference() {
  return useContext(MotionPreferenceContext)
}

export function useAppReducedMotion() {
  const preference = useMotionPreference()
  const systemReducedMotion = useReducedMotion()
  return preference?.reducedMotion ?? Boolean(systemReducedMotion)
}
