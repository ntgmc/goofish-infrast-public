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

  const value = useMemo(() => ({ reducedMotion, systemReducedMotion, storageError, setReduceAnimations: setPreference }), [reducedMotion, systemReducedMotion, storageError, setPreference])
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
