import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Announcement,
  AnnouncementPublicResponse,
  AuthSuccessResponse,
  AuthUser,
  LicenseConfig,
  LicenseFile,
  UserGameAccount,
  UserWorkspace,
  WorkspaceSavedConfigAction,
} from '../../lib/types'
import { apiJson, apiJsonOrNull, apiVoid } from '../../lib/api-client'
import { createAccountLicense, isSchedulableProfile } from './tool-utils'
import { copy } from '../../copy/index'


export type WorkspacePatch = Partial<UserWorkspace> & { saved_config_action?: WorkspaceSavedConfigAction }
export type ConfigSyncStatus = 'idle' | 'pending' | 'saving' | 'failed'

const CONFIG_SAVE_DEBOUNCE_MS = 600

export function useToolSession(requestedProfileId?: string | null) {
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profiles, setProfiles] = useState<UserGameAccount[]>([])
  const [activeProfile, setActiveProfile] = useState<UserGameAccount | null>(null)
  const [workspace, setWorkspace] = useState<UserWorkspace | null>(null)
  const [license, setLicense] = useState<LicenseFile | null>(null)
  const [eliteOverrides, setEliteOverridesState] = useState<Record<string, number>>({})
  const [configOverride, setConfigOverrideState] = useState<LicenseConfig | null>(null)
  const [banner, setBanner] = useState<Announcement | null>(null)
  const [popups, setPopups] = useState<Announcement[]>([])
  const [announcementUnreadCount, setAnnouncementUnreadCount] = useState(0)
  const [openingProfileId, setOpeningProfileId] = useState<string | null>(null)
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null)
  const [configSyncStatus, setConfigSyncStatus] = useState<ConfigSyncStatus>('idle')
  const workspacePatchQueueRef = useRef<Promise<void>>(Promise.resolve())
  const activeProfileRef = useRef<UserGameAccount | null>(null)
  const licenseRef = useRef<LicenseFile | null>(null)
  const configGenerationRef = useRef(0)
  const configSaveTimerRef = useRef<number | null>(null)
  const configSaveInFlightRef = useRef(false)
  const pendingConfigRef = useRef<{ profileId: string; generation: number; config: LicenseConfig } | null>(null)

  activeProfileRef.current = activeProfile
  licenseRef.current = license

  const cancelPendingConfigSave = useCallback(() => {
    configGenerationRef.current += 1
    pendingConfigRef.current = null
    if (configSaveTimerRef.current !== null) {
      window.clearTimeout(configSaveTimerRef.current)
      configSaveTimerRef.current = null
    }
    setConfigSyncStatus('idle')
  }, [])

  const applyAuthPayloadInternal = useCallback((
    payload: AuthSuccessResponse | null,
    options: { preserveConfigDraft?: boolean } = {},
  ) => {
    const nextUser = payload?.user ?? null
    const nextProfiles = payload?.profiles ?? []
    const nextProfile = payload?.active_profile ?? null
    const nextWorkspace = payload?.workspace ?? null
    setUser(nextUser)
    setProfiles(nextProfiles)
    setActiveProfile(nextProfile)
    setWorkspace(nextWorkspace)
    setAnnouncementUnreadCount(payload?.announcement_unread_count ?? 0)
    setEliteOverridesState(nextWorkspace?.elite_overrides ?? {})
    if (!options.preserveConfigDraft) {
      cancelPendingConfigSave()
      setConfigOverrideState(null)
    }
    setLicense(nextProfile && nextWorkspace?.operators && nextWorkspace.config
      ? createAccountLicense(nextProfile, nextWorkspace.operators, nextWorkspace.config)
      : null)
  }, [cancelPendingConfigSave])

  const applyAuthPayload = useCallback((payload: AuthSuccessResponse | null) => {
    applyAuthPayloadInternal(payload)
  }, [applyAuthPayloadInternal])

  useEffect(() => {
    let cancelled = false

    void apiJsonOrNull<AnnouncementPublicResponse>('/api/announcement')
      .then((data) => {
        if (cancelled) return
        setBanner(data?.banner ?? null)
        setPopups(Array.isArray(data?.popups) ? data.popups : [])
      })
      .catch(console.error)

    const authUrl = requestedProfileId
      ? `/api/auth/me?profile_id=${encodeURIComponent(requestedProfileId)}`
      : '/api/auth/me'
    void apiJson<Partial<AuthSuccessResponse> & { user: AuthUser | null }>(authUrl, { fallbackMessage: copy.common.pages_tool_useToolSession_001 })
      .then((data) => {
        if (cancelled) return
        if (!data.user) {
          applyAuthPayload(null)
          return
        }
        applyAuthPayload(data as AuthSuccessResponse)
      })
      .catch(() => {
        if (!cancelled) applyAuthPayload(null)
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [applyAuthPayload, requestedProfileId])

  useEffect(() => () => {
    pendingConfigRef.current = null
    if (configSaveTimerRef.current !== null) window.clearTimeout(configSaveTimerRef.current)
  }, [])

  const refreshProfileWorkspace = useCallback(async (profile: UserGameAccount) => {
    cancelPendingConfigSave()
    setOpeningProfileId(profile.id)
    setWorkspaceLoadError(null)
    try {
      const data = await apiJson<AuthSuccessResponse>(`/api/user/workspace?profile_id=${encodeURIComponent(profile.id)}`, {
        fallbackMessage: copy.common.pages_tool_useToolSession_002,
      })
      applyAuthPayload(data)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : copy.common.pages_tool_useToolSession_003
      setWorkspaceLoadError(message)
      throw caught
    } finally {
      setOpeningProfileId(null)
    }
  }, [applyAuthPayload, cancelPendingConfigSave])

  const persistWorkspacePatch = useCallback((patch: WorkspacePatch) => {
    if (!activeProfile) return Promise.reject(new Error(copy.common.pages_tool_useToolSession_004))
    const runPatch = async () => {
      const data = await apiJson<AuthSuccessResponse>('/api/user/workspace', {
        method: 'PATCH',
        json: { ...patch, profile_id: activeProfile.id },
        fallbackMessage: copy.common.pages_tool_useToolSession_005,
      })
      applyAuthPayloadInternal(data, { preserveConfigDraft: true })
      return data
    }
    const request = workspacePatchQueueRef.current.then(runPatch, runPatch)
    workspacePatchQueueRef.current = request.then(() => undefined, () => undefined)
    return request
  }, [activeProfile, applyAuthPayloadInternal])

  const runPendingConfigSave = useCallback(async () => {
    if (configSaveInFlightRef.current) return
    const pending = pendingConfigRef.current
    if (!pending) return
    configSaveInFlightRef.current = true
    setConfigSyncStatus('saving')
    try {
      const save = () => apiJson<AuthSuccessResponse>('/api/user/workspace', {
          method: 'PATCH',
          json: { config: pending.config, profile_id: pending.profileId },
          fallbackMessage: copy.common.pages_tool_useToolSession_006,
        })
      const request = workspacePatchQueueRef.current.then(save, save)
      workspacePatchQueueRef.current = request.then(() => undefined, () => undefined)
      const data = await request
      const latest = pendingConfigRef.current
      if (latest?.profileId === pending.profileId && latest.generation === pending.generation) {
        applyAuthPayloadInternal(data, { preserveConfigDraft: true })
        pendingConfigRef.current = null
        setConfigOverrideState(null)
        setConfigSyncStatus('idle')
      }
    } catch (error) {
      const latest = pendingConfigRef.current
      if (latest?.profileId === pending.profileId && latest.generation === pending.generation) {
        setConfigSyncStatus('failed')
      }
      console.error(error)
    } finally {
      configSaveInFlightRef.current = false
      const latest = pendingConfigRef.current
      if (latest && latest.generation !== pending.generation) {
        void runPendingConfigSave()
      }
    }
  }, [applyAuthPayloadInternal])

  const setEliteOverrides = useCallback((next: Record<string, number>) => {
    setEliteOverridesState(next)
    void persistWorkspacePatch({ elite_overrides: next }).catch(console.error)
  }, [persistWorkspacePatch])

  const setConfigOverride = useCallback((next: LicenseConfig | null) => {
    setConfigOverrideState(next)
    const profile = activeProfileRef.current
    const nextConfig = next ?? licenseRef.current?.config ?? null
    if (!profile || !nextConfig) return
    const generation = ++configGenerationRef.current
    pendingConfigRef.current = { profileId: profile.id, generation, config: nextConfig }
    setConfigSyncStatus('pending')
    if (configSaveTimerRef.current !== null) window.clearTimeout(configSaveTimerRef.current)
    configSaveTimerRef.current = window.setTimeout(() => {
      configSaveTimerRef.current = null
      void runPendingConfigSave()
    }, CONFIG_SAVE_DEBOUNCE_MS)
  }, [runPendingConfigSave])

  const flushConfigSave = useCallback(() => {
    if (configSaveTimerRef.current !== null) {
      window.clearTimeout(configSaveTimerRef.current)
      configSaveTimerRef.current = null
    }
    void runPendingConfigSave()
  }, [runPendingConfigSave])

  const retryConfigSave = useCallback(() => {
    if (!pendingConfigRef.current) return
    setConfigSyncStatus('pending')
    flushConfigSave()
  }, [flushConfigSave])

  const handleLogout = useCallback(async () => {
    cancelPendingConfigSave()
    await apiVoid('/api/auth/logout', { method: 'POST' })
    applyAuthPayload(null)
  }, [applyAuthPayload, cancelPendingConfigSave])

  const cdkProfiles = useMemo(() => profiles.filter(isSchedulableProfile), [profiles])
  const activeCdkProfile = activeProfile && isSchedulableProfile(activeProfile) ? activeProfile : cdkProfiles[0] ?? null

  return {
    authLoading,
    user,
    profiles,
    activeProfile,
    activeCdkProfile,
    cdkProfiles,
    workspace,
    license,
    setLicense,
    eliteOverrides,
    setEliteOverrides,
    configOverride,
    setConfigOverride,
    configSyncStatus,
    flushConfigSave,
    retryConfigSave,
    banner,
    popups,
    announcementUnreadCount,
    openingProfileId,
    workspaceLoadError,
    applyAuthPayload,
    refreshProfileWorkspace,
    persistWorkspacePatch,
    handleLogout,
  }
}
