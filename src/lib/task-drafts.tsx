import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { USER_LOGOUT_EVENT } from './auth-navigation'

const TaskDraftContext = createContext<Map<string, unknown> | null>(null)

export function TaskDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, unknown>())
  useEffect(() => {
    const clear = () => drafts.clear()
    window.addEventListener(USER_LOGOUT_EVENT, clear)
    return () => window.removeEventListener(USER_LOGOUT_EVENT, clear)
  }, [drafts])
  return <TaskDraftContext.Provider value={drafts}>{children}</TaskDraftContext.Provider>
}

// Business drafts stay in this tab's memory; authentication passwords never use this hook.
export function useTaskDraft<T>(key: string | null, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const drafts = useContext(TaskDraftContext)
  const initialize = () => key && drafts?.has(key) ? drafts.get(key) as T : typeof initial === 'function' ? (initial as () => T)() : initial
  const [value, setValue] = useState<T>(initialize)
  const previousKey = useRef(key)
  if (previousKey.current !== key) {
    previousKey.current = key
    setValue(initialize())
  }
  useEffect(() => { if (key) drafts?.set(key, value) }, [drafts, key, value])
  return [value, setValue]
}
