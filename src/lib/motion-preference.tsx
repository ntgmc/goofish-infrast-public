import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'

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
  const reducedMotion = reduceAnimations || systemReducedMotion

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
      // Require several slow frames so a single loading pause cannot change the preference.
      if (elapsed >= 50) {
        slowFrames += 1
        slowTime += elapsed
      }
      if (slowFrames >= 3 && slowTime >= 300) {
        setPreference(true)
        return
      }
      if (time - startedAt < 1000) frame = window.requestAnimationFrame(sample)
    }
    const start = () => {
      if (frame !== null || document.visibilityState !== 'visible') return
      startedAt = previousTime = performance.now()
      slowFrames = slowTime = 0
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
  return <MotionPreferenceContext.Provider value={value}>{children}</MotionPreferenceContext.Provider>
}

export function useMotionPreference() {
  return useContext(MotionPreferenceContext)
}

export function useAppReducedMotion() {
  const preference = useMotionPreference()
  const systemReducedMotion = useReducedMotion()
  return preference?.reducedMotion ?? Boolean(systemReducedMotion)
}
