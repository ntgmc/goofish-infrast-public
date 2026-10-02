import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { X } from 'lucide-react'
import { copy } from '../../copy/index'
import { dashboardPath, profileScopedPath, resolveToolRoute, workspaceSetupPath } from '../../lib/app-routes'
import type { UserGameAccount } from '../../lib/types'
import { isSchedulableProfile } from './tool-utils'
import { clearToolBehaviorEvents, exportToolBehaviorData, recordToolBehavior } from '../../lib/tool-behavior-observation'

const STORAGE_PREFIX = 'maatool:workspace-entry:v1:'
const OBSERVATION_PREFIX = 'maatool:workspace-entry-observation:v1:'
const DAY = 24 * 60 * 60 * 1000
const REMINDER_DELAY = 7 * 24 * 60 * 60 * 1000
// ponytail: quick repeated opens approximate friction; tune thresholds if suggestions are often dismissed.
const OBSERVATION_PERIOD = 3 * DAY
const OBSERVATION_WINDOW = 14 * DAY
const QUICK_OPEN_WINDOW = 60 * 1000
const MIN_OPEN_INTERVAL = 30 * 60 * 1000
const DEFAULT_PREFERENCE: EntryPreference = { target: null, remindAfter: 0 }

interface EntryPreference {
  target: string | null
  remindAfter: number | 'never'
}

interface EntryObservation {
  target: string
  opens: number[]
}

function singleGameAccount(profiles: UserGameAccount[], activeProfile: UserGameAccount | null) {
  const accounts = profiles.filter(isSchedulableProfile)
  if (!accounts.length) return null
  const uid = accounts[0].skland_binding?.uid
  if (accounts.length > 1 && (!uid || accounts.some((profile) => profile.skland_binding?.uid !== uid))) return null
  const available = accounts.filter((profile) => profile.status === 'active'
    && (!profile.expires_at || Date.parse(profile.expires_at) > Date.now()))
  const paid = available.filter((profile) => profile.kind !== 'free_preview')
  const preferred = paid.length ? paid : available
  const profile = preferred.find((account) => account.id === activeProfile?.id) ?? preferred[0]
  return profile ? { profile, target: uid ? `uid:${uid}` : `profile:${profile.id}` } : null
}

function readPreference(userId: string | null): EntryPreference {
  if (!userId) return DEFAULT_PREFERENCE
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`) ?? 'null')
    if (stored && typeof stored === 'object' && 'target' in stored && 'remindAfter' in stored
      && (stored.target === null || typeof stored.target === 'string')
      && (stored.remindAfter === 'never' || (typeof stored.remindAfter === 'number' && Number.isFinite(stored.remindAfter)))) {
      return { target: stored.target, remindAfter: stored.remindAfter }
    }
  } catch {
    // Keep the default entry available when browser storage cannot be read.
  }
  return DEFAULT_PREFERENCE
}

function readObservation(userId: string | null): EntryObservation | null {
  if (!userId) return null
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(`${OBSERVATION_PREFIX}${userId}`) ?? 'null')
    if (stored && typeof stored === 'object' && 'target' in stored && typeof stored.target === 'string'
      && 'opens' in stored && Array.isArray(stored.opens)
      && stored.opens.every((value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
      return { target: stored.target, opens: stored.opens.slice(-100).sort((left, right) => left - right) }
    }
  } catch {
    // Observation is optional and must not interrupt opening a workspace.
  }
  return null
}

export function useWorkspaceEntryPreference(
  userId: string | null,
  profiles: UserGameAccount[],
  activeProfile: UserGameAccount | null,
  ready: boolean,
  profilesEnabled: boolean,
) {
  const location = useLocation()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(() => ({ userId, preference: readPreference(userId) }))
  const [observed, setObserved] = useState(() => ({ userId, observation: readObservation(userId) }))
  const [storageError, setStorageError] = useState(false)
  const entryUserRef = useRef<string | null>(null)
  const visitRef = useRef<{ key: string; enteredAt: number; recorded: boolean } | null>(null)
  const shownPromptRef = useRef<string | null>(null)
  const candidate = singleGameAccount(profiles, activeProfile)
  const preference = saved.userId === userId ? saved.preference : readPreference(userId)
  const observation = observed.userId === userId ? observed.observation : readObservation(userId)
  const now = Date.now()
  const recentOpens = observation?.target === candidate?.target
    ? observation?.opens.filter((openedAt) => openedAt >= now - OBSERVATION_WINDOW && openedAt <= now) ?? []
    : []
  const repeatedEntry = recentOpens.length >= 5 && now - recentOpens[0] >= OBSERVATION_PERIOD
    && new Set(recentOpens.map((openedAt) => new Date(openedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }))).size >= 3
  const enabled = Boolean(candidate && (preference.target === candidate.target
    || preference.target === `profile:${candidate.profile.id}`))
  const path = candidate ? profileScopedPath(workspaceSetupPath('operators'), candidate.profile.id) : null
  const showPrompt = Boolean(ready && userId && profilesEnabled && candidate && !enabled && repeatedEntry
    && preference.remindAfter !== 'never' && preference.remindAfter <= Date.now())

  useEffect(() => {
    const key = `${userId}:${location.key}:${candidate?.profile.id}`
    if (!showPrompt || location.pathname !== dashboardPath('profiles')) {
      shownPromptRef.current = null
    } else if (shownPromptRef.current !== key && recordToolBehavior({ name: 'entry_prompt_shown', profile: candidate?.profile.id })) {
      shownPromptRef.current = key
    }
  }, [userId, showPrompt, location.key, location.pathname, candidate?.profile.id])

  useEffect(() => {
    const query = new URLSearchParams(location.search)
    if (!ready || !userId || location.pathname !== dashboardPath('profiles')
      || query.has('profile_id') || query.has('recovery')) {
      visitRef.current = null
    } else if (visitRef.current?.key !== location.key) {
      visitRef.current = { key: location.key, enteredAt: Date.now(), recorded: false }
    }
  }, [userId, ready, location.key, location.pathname, location.search])

  useEffect(() => {
    if (!userId) {
      entryUserRef.current = null
      return
    }
    if (!ready || !resolveToolRoute(location.pathname) || entryUserRef.current === userId) return
    entryUserRef.current = userId
    const query = new URLSearchParams(location.search)
    if (profilesEnabled && enabled && path && location.pathname === dashboardPath('profiles')
      && !query.has('profile_id') && !query.has('recovery')) {
      recordToolBehavior({ name: 'entry_auto_open', profile: candidate?.profile.id })
      void navigate(path, { replace: true })
    }
  }, [userId, ready, profilesEnabled, enabled, path, location.pathname, location.search, navigate])

  function updatePreference(next: EntryPreference) {
    if (!userId) return false
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(next))
      setSaved({ userId, preference: next })
      setStorageError(false)
      recordToolBehavior({ name: next.target ? 'entry_enable' : next.remindAfter === 'never' ? 'entry_disable' : 'entry_snooze' })
      return true
    } catch {
      setStorageError(true)
      return false
    }
  }

  function recordOpen(profile: UserGameAccount, openedAt: number) {
    const visit = visitRef.current
    if (!userId || !profilesEnabled || !candidate || enabled || preference.remindAfter === 'never'
      || !visit || visit.key !== location.key || visit.recorded
      || openedAt < visit.enteredAt || openedAt - visit.enteredAt > QUICK_OPEN_WINDOW
      || (profile.id !== candidate.profile.id && `uid:${profile.skland_binding?.uid}` !== candidate.target)) return
    const history = readObservation(userId)
    const opens = history?.target === candidate.target
      ? history.opens.filter((time) => time >= openedAt - OBSERVATION_WINDOW && time <= openedAt)
      : []
    visit.recorded = true
    if (opens.length && openedAt - opens[opens.length - 1] < MIN_OPEN_INTERVAL) return
    const next = { target: candidate.target, opens: [...opens, openedAt].slice(-100) }
    try {
      window.localStorage.setItem(`${OBSERVATION_PREFIX}${userId}`, JSON.stringify(next))
      setObserved({ userId, observation: next })
    } catch {
      // A failed local observation must not interrupt the user's action.
    }
  }

  return {
    userId,
    candidate,
    enabled,
    profilesEnabled,
    storageError,
    showPrompt,
    recordOpen,
    enable: () => candidate && updatePreference({ target: candidate.target, remindAfter: 0 }),
    disable: () => updatePreference({ target: null, remindAfter: 'never' }),
    snooze: () => updatePreference({ target: null, remindAfter: Date.now() + REMINDER_DELAY }),
    open: () => { if (path) void navigate(path) },
  }
}

export type WorkspaceEntryState = ReturnType<typeof useWorkspaceEntryPreference>

export function WorkspaceEntryPrompt({ entry }: { entry: WorkspaceEntryState }) {
  if (!entry.showPrompt || !entry.candidate) return null
  const text = copy.dashboard.workspace_entry
  return (
    <aside
      className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-lg rounded-xl border border-surface-3 bg-surface-1 p-5 shadow-xl sm:left-auto sm:right-6 sm:bottom-6"
      aria-labelledby="workspace-entry-title"
    >
      <button type="button" onClick={entry.snooze} aria-label={text.snooze} title={text.snooze} className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-lg text-ink-muted hover:text-ink-primary">
        <X className="size-4" aria-hidden="true" />
      </button>
      <div role="status" className="pr-8">
        <h2 id="workspace-entry-title" className="font-semibold text-ink-primary">{text.prompt_title}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{text.prompt_body}</p>
        <p className="mt-2 text-sm text-ink-primary">{entry.candidate.profile.display_name}</p>
      </div>
      {entry.storageError && <p role="alert" className="tool-alert tool-alert--error mt-3">{text.storage_error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => { if (entry.enable()) entry.open() }} className="tool-primary-action">{text.enable}</button>
        <button type="button" onClick={entry.snooze} className="tool-secondary-action">{text.snooze}</button>
        <button type="button" onClick={entry.disable} className="tool-secondary-action">{text.never}</button>
      </div>
    </aside>
  )
}

export function WorkspaceEntrySettings({ entry }: { entry: WorkspaceEntryState }) {
  const text = copy.dashboard.workspace_entry
  const observationText = copy.dashboard.behavior_observation
  const [observationNotice, setObservationNotice] = useState<string | null>(null)
  function exportObservations() {
    if (!entry.userId) return
    try {
      const blob = new Blob([exportToolBehaviorData(entry.userId)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'maatool-behavior-observation.json'
      try {
        document.body.append(link)
        link.click()
      } finally {
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
      }
    } catch {
      setObservationNotice(observationText.export_failed)
    }
  }
  return (
    <section className="tool-panel p-6">
      <h2 className="text-lg font-semibold text-ink-primary">{text.settings_title}</h2>
      <label className="mt-4 flex items-start gap-3">
        <input
          type="checkbox"
          checked={entry.enabled}
          disabled={!entry.candidate || !entry.profilesEnabled}
          onChange={(event) => { if (event.target.checked) entry.enable(); else entry.disable() }}
          className="mt-1 size-4 shrink-0 accent-brand-500"
        />
        <span>
          <span className="block text-sm font-medium text-ink-primary">{text.setting_label}</span>
          <span className="mt-1 block text-sm leading-6 text-ink-secondary">{text.setting_help}</span>
        </span>
      </label>
      {(!entry.candidate || !entry.profilesEnabled) && <p className="mt-3 text-sm text-ink-muted">{text.unavailable}</p>}
      {entry.storageError && <p role="alert" className="tool-alert tool-alert--error mt-3">{text.storage_error}</p>}
      <details className="mt-5 border-t border-surface-3 pt-4">
        <summary className="cursor-pointer text-sm font-medium text-ink-secondary">{observationText.title}</summary>
        <p className="mt-3 text-sm leading-6 text-ink-secondary">{observationText.description}</p>
        {observationNotice && <p role="status" className="mt-3 text-sm text-ink-secondary">{observationNotice}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={exportObservations} className="tool-secondary-action">{observationText.export}</button>
          <button type="button" onClick={() => {
            if (entry.userId) setObservationNotice(clearToolBehaviorEvents(entry.userId) ? observationText.cleared : observationText.clear_failed)
          }} className="tool-secondary-action">{observationText.clear}</button>
        </div>
      </details>
    </section>
  )
}
