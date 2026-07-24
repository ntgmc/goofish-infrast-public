import { useCallback, useEffect, useRef, useState } from 'react'
import type { Announcement, AnnouncementAdminResponse, AnnouncementStats } from '../../../lib/types'
import {
  createDraftAnnouncement,
  createDraftBanner,
  normalizeAnnouncementBanner,
  normalizeAnnouncementList,
  normalizeAnnouncementStatsMap,
} from '../shared/helpers'
import {
  ANNOUNCEMENT_DRAFT_AUTOSAVE_DELAY_MS,
  announcementSnapshotsEqual,
  buildAnnouncementRevision,
  clearAnnouncementDraft,
  readAnnouncementDraft,
  writeAnnouncementDraft,
  type AnnouncementDraftStatus,
  type AnnouncementSnapshot,
} from './announcement-draft'

export function useAnnouncementDraft() {
  const [banner, setBanner] = useState<Announcement>(() => createDraftBanner())
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [stats, setStats] = useState<Record<string, AnnouncementStats>>({})
  const [status, setStatus] = useState<AnnouncementDraftStatus>('clean')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const bannerRef = useRef(banner)
  const announcementsRef = useRef(announcements)
  const publishedRef = useRef<AnnouncementSnapshot | null>(null)
  const serverRevisionRef = useRef<string | null>(null)
  const baseRevisionRef = useRef<string | null>(null)
  const ownerRef = useRef<string | null>(null)
  const hydratedRef = useRef(false)
  const dirtyRef = useRef(false)
  const recoveryPendingRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const skipNextAutosaveRef = useRef(false)

  const cancelTimer = useCallback(() => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const applySnapshot = useCallback((snapshot: AnnouncementSnapshot) => {
    bannerRef.current = snapshot.banner
    announcementsRef.current = snapshot.announcements
    setBanner(snapshot.banner)
    setAnnouncements(snapshot.announcements)
  }, [])

  const setCleanState = useCallback(() => {
    dirtyRef.current = false
    setDirty(false)
    setStatus('clean')
    setSavedAt(null)
    setRestored(false)
    setConflict(false)
    setError(null)
  }, [])

  const persist = useCallback(() => {
    const owner = ownerRef.current
    const published = publishedRef.current
    if (!owner || !published || !hydratedRef.current) return true

    const snapshot = { banner: bannerRef.current, announcements: announcementsRef.current }
    const hasChanges = !announcementSnapshotsEqual(snapshot, published)
    dirtyRef.current = hasChanges
    setDirty(hasChanges)
    cancelTimer()

    if (!hasChanges) {
      const clearError = clearAnnouncementDraft(owner)
      baseRevisionRef.current = serverRevisionRef.current
      if (clearError) {
        setStatus('error')
        setError(clearError)
        return false
      }
      setCleanState()
      return true
    }

    const result = writeAnnouncementDraft(
      owner,
      baseRevisionRef.current ?? serverRevisionRef.current ?? '',
      snapshot,
    )
    if (result.error) {
      setStatus('error')
      setError(result.error)
      return false
    }

    setStatus('saved')
    setSavedAt(result.savedAt)
    setError(null)
    return true
  }, [cancelTimer, setCleanState])

  const acceptServerData = useCallback((
    owner: string,
    data: Partial<AnnouncementAdminResponse>,
    clearStoredDraft: boolean,
  ) => {
    const nextBanner = normalizeAnnouncementBanner(data.banner)
    const nextAnnouncements = normalizeAnnouncementList(data.announcements)
    const snapshot = { banner: nextBanner, announcements: nextAnnouncements }
    const revision = buildAnnouncementRevision(data.banner ?? null, nextAnnouncements)

    cancelTimer()
    publishedRef.current = snapshot
    serverRevisionRef.current = revision
    baseRevisionRef.current = revision
    ownerRef.current = owner
    hydratedRef.current = true
    recoveryPendingRef.current = false
    skipNextAutosaveRef.current = true
    applySnapshot(snapshot)
    setStats(normalizeAnnouncementStatsMap(data.stats, nextAnnouncements))

    if (clearStoredDraft) {
      const clearError = clearAnnouncementDraft(owner)
      if (clearError) {
        dirtyRef.current = false
        setDirty(false)
        setStatus('error')
        setSavedAt(null)
        setRestored(false)
        setConflict(false)
        setError(clearError)
        return
      }
    }
    setCleanState()
  }, [applySnapshot, cancelTimer, setCleanState])

  const reconcileServerData = useCallback((owner: string, data: Partial<AnnouncementAdminResponse>) => {
    const nextBanner = normalizeAnnouncementBanner(data.banner)
    const nextAnnouncements = normalizeAnnouncementList(data.announcements)
    const serverSnapshot = { banner: nextBanner, announcements: nextAnnouncements }
    const serverRevision = buildAnnouncementRevision(data.banner ?? null, nextAnnouncements)
    const sameOwner = hydratedRef.current && ownerRef.current === owner

    publishedRef.current = serverSnapshot
    serverRevisionRef.current = serverRevision
    setStats(normalizeAnnouncementStatsMap(data.stats, nextAnnouncements))

    if (sameOwner && dirtyRef.current) {
      const currentSnapshot = { banner: bannerRef.current, announcements: announcementsRef.current }
      const stillDirty = !announcementSnapshotsEqual(currentSnapshot, serverSnapshot)
      dirtyRef.current = stillDirty
      setDirty(stillDirty)
      if (!stillDirty) {
        const clearError = clearAnnouncementDraft(owner)
        baseRevisionRef.current = serverRevision
        if (clearError) {
          setStatus('error')
          setError(clearError)
          recoveryPendingRef.current = false
          return
        }
        setCleanState()
      } else {
        setConflict(baseRevisionRef.current !== serverRevision)
        if (recoveryPendingRef.current) setRestored(true)
      }
      recoveryPendingRef.current = false
      return
    }

    recoveryPendingRef.current = false
    ownerRef.current = owner
    hydratedRef.current = true
    const readResult = readAnnouncementDraft(owner)
    if (readResult.draft) {
      const draftSnapshot = {
        banner: readResult.draft.banner,
        announcements: readResult.draft.announcements,
      }
      if (announcementSnapshotsEqual(draftSnapshot, serverSnapshot)) {
        const clearError = clearAnnouncementDraft(owner)
        baseRevisionRef.current = serverRevision
        skipNextAutosaveRef.current = true
        applySnapshot(serverSnapshot)
        if (clearError) {
          dirtyRef.current = false
          setDirty(false)
          setStatus('error')
          setSavedAt(null)
          setRestored(false)
          setConflict(false)
          setError(clearError)
          return
        }
        setCleanState()
        return
      }

      baseRevisionRef.current = readResult.draft.base_revision
      dirtyRef.current = true
      skipNextAutosaveRef.current = true
      applySnapshot(draftSnapshot)
      setDirty(true)
      setStatus('saved')
      setSavedAt(readResult.draft.saved_at)
      setRestored(true)
      setConflict(readResult.draft.base_revision !== serverRevision)
      setError(null)
      return
    }

    baseRevisionRef.current = serverRevision
    skipNextAutosaveRef.current = true
    applySnapshot(serverSnapshot)
    if (readResult.error) {
      dirtyRef.current = false
      setDirty(false)
      setStatus('error')
      setSavedAt(null)
      setRestored(false)
      setConflict(false)
      setError(readResult.error)
      return
    }
    setCleanState()
  }, [applySnapshot, setCleanState])

  useEffect(() => {
    bannerRef.current = banner
    announcementsRef.current = announcements
    if (!hydratedRef.current || !publishedRef.current) return
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false
      return
    }

    const snapshot = { banner, announcements }
    const hasChanges = !announcementSnapshotsEqual(snapshot, publishedRef.current)
    dirtyRef.current = hasChanges
    setDirty(hasChanges)
    cancelTimer()

    if (!hasChanges) {
      persist()
      return
    }

    setStatus('saving')
    setError(null)
    timerRef.current = window.setTimeout(persist, ANNOUNCEMENT_DRAFT_AUTOSAVE_DELAY_MS)
    return cancelTimer
  }, [announcements, banner, cancelTimer, persist])

  useEffect(() => {
    const flush = () => {
      persist()
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [persist])

  const prepareForAuthenticationReset = useCallback(() => {
    persist()
    recoveryPendingRef.current = dirtyRef.current
  }, [persist])

  const discardAndAcceptServerData = useCallback((owner: string, data: Partial<AnnouncementAdminResponse>) => {
    const clearError = clearAnnouncementDraft(owner)
    if (clearError) return clearError
    acceptServerData(owner, data, false)
    return null
  }, [acceptServerData])

  const currentSnapshot = useCallback((): AnnouncementSnapshot => ({
    banner: bannerRef.current,
    announcements: announcementsRef.current,
  }), [])

  const updateBanner = (patch: Partial<Pick<Announcement, 'active' | 'title' | 'body'>>) => {
    setBanner((current) => {
      const next = { ...current, ...patch, kind: 'banner' as const }
      bannerRef.current = next
      return next
    })
  }

  const addAnnouncement = () => {
    const draft = createDraftAnnouncement()
    setAnnouncements((current) => {
      const next = [draft, ...current]
      announcementsRef.current = next
      return next
    })
    return draft.id
  }

  const updateAnnouncement = (id: string, patch: Partial<Pick<Announcement, 'active' | 'title' | 'body'>>) => {
    setAnnouncements((current) => {
      const next = current.map((item) => item.id === id ? { ...item, ...patch, kind: 'popup' as const } : item)
      announcementsRef.current = next
      return next
    })
  }

  const deleteAnnouncement = (id: string) => {
    setAnnouncements((current) => {
      const next = current.filter((item) => item.id !== id)
      announcementsRef.current = next
      return next
    })
  }

  const reorderAnnouncements = (from: number, to: number) => {
    setAnnouncements((current) => {
      if (from < 0 || to < 0 || from >= current.length || to >= current.length || from === to) return current
      const next = [...current]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      announcementsRef.current = next
      return next
    })
  }

  return {
    banner,
    announcements,
    stats,
    status,
    savedAt,
    restored,
    conflict,
    error,
    dirty,
    persist,
    reconcileServerData,
    acceptServerData,
    discardAndAcceptServerData,
    prepareForAuthenticationReset,
    currentSnapshot,
    updateBanner,
    addAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    reorderAnnouncements,
  }
}
