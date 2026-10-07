import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Announcement,
  AnnouncementPublicResponse,
  AuthSuccessResponse,
  AuthUser,
  LicenseConfig,
  LicenseFile,
  LicenseOperator,
  UserGameAccount,
  UserWorkspace,
  WorkspaceSavedConfigAction,
} from '../../lib/types'
import { apiJson, apiJsonOrNull, apiVoid } from '../../lib/api-client'
import { normalizeConfig, validateConfig } from '../../lib/config'
import { createAccountLicense, isSchedulableProfile } from './tool-utils'
import { copy } from '../../copy/index'


export type WorkspacePatch = {
  operators?: LicenseOperator[] | null
  config?: LicenseConfig | null
  elite_overrides?: Record<string, number>
  saved_config_action?: WorkspaceSavedConfigAction
}
export type ConfigSyncStatus = 'idle' | 'pending' | 'saving' | 'failed'
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error'

const CONFIG_SAVE_DEBOUNCE_MS = 600

export function useToolSession(requestedProfileId?: string | null, rememberLastProfile = false) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading')
  const [authError, setAuthError] = useState<Error | null>(null)
  const [authRequestVersion, setAuthRequestVersion] = useState(0)
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
  const loadedAuthVersionRef = useRef(-1)
  const licenseRef = useRef<LicenseFile | null>(null)
  const configGenerationRef = useRef(0)
  const configSaveTimerRef = useRef<number | null>(null)
  const configSaveInFlightRef = useRef<Promise<void> | null>(null)
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
    if (rememberLastProfile && nextUser && nextProfile && isSchedulableProfile(nextProfile)) {
      try { window.localStorage.setItem(`maatool:v2:last-profile:${nextUser.id}`, nextProfile.id) } catch { /* Storage may be disabled. */ }
    }
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
  }, [cancelPendingConfigSave, rememberLastProfile])

  const applyAuthPayload = useCallback((payload: AuthSuccessResponse | null) => {
    applyAuthPayloadInternal(payload, {
      preserveConfigDraft: Boolean(payload?.active_profile && pendingConfigRef.current?.profileId === payload.active_profile.id),
    })
    setAuthError(null)
    setAuthStatus(payload ? 'authenticated' : 'anonymous')
  }, [applyAuthPayloadInternal])

  const retryAuth = useCallback(() => {
    setAuthError(null)
    setAuthStatus('loading')
    setAuthRequestVersion((current) => current + 1)
  }, [])

  useEffect(() => {
    if (requestedProfileId && activeProfileRef.current?.id === requestedProfileId && loadedAuthVersionRef.current === authRequestVersion) return
    loadedAuthVersionRef.current = authRequestVersion
    let cancelled = false
    setAuthError(null)
    setAuthStatus('loading')

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
      .then(async (data) => {
        if (cancelled) return
        if (data.user === null) {
          applyAuthPayload(null)
          return
        }
        if (!data.user) throw new Error(copy.common.pages_tool_useToolSession_001)
        if (rememberLastProfile && !requestedProfileId) {
          let remembered: string | null = null
          try { remembered = window.localStorage.getItem(`maatool:v2:last-profile:${data.user.id}`) } catch { /* Storage may be disabled. */ }
          if (remembered && remembered !== data.active_profile?.id) {
            data = await apiJson<AuthSuccessResponse>(`/api/auth/me?profile_id=${encodeURIComponent(remembered)}`, {
              fallbackMessage: copy.common.pages_tool_useToolSession_001,
            })
          }
          if (data.user && (!data.active_profile || !isSchedulableProfile(data.active_profile))) {
            const fallback = data.profiles?.find(isSchedulableProfile)
            if (fallback) data = await apiJson<AuthSuccessResponse>(`/api/auth/me?profile_id=${encodeURIComponent(fallback.id)}`, {
              fallbackMessage: copy.common.pages_tool_useToolSession_001,
            })
          }
        }
        if (!data.user && data.user !== null) throw new Error(copy.common.pages_tool_useToolSession_001)
        if (!cancelled) applyAuthPayload(data.user ? data as AuthSuccessResponse : null)
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setAuthError(caught instanceof Error ? caught : new Error(copy.common.pages_tool_useToolSession_001))
        setAuthStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [applyAuthPayload, authRequestVersion, requestedProfileId, rememberLastProfile])

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
    const targetProfile = activeProfileRef.current
    if (!targetProfile) return Promise.reject(new Error(copy.common.pages_tool_useToolSession_004))
    const runPatch = async () => {
      const data = await apiJson<AuthSuccessResponse>('/api/user/workspace', {
        method: 'PATCH',
        json: { ...patch, profile_id: targetProfile.id },
        fallbackMessage: copy.common.pages_tool_useToolSession_005,
      })
      if (activeProfileRef.current?.id === targetProfile.id) {
        applyAuthPayloadInternal(data, { preserveConfigDraft: true })
      }
      return data
    }
    const request = workspacePatchQueueRef.current.then(runPatch, runPatch)
    workspacePatchQueueRef.current = request.then(() => undefined, () => undefined)
    return request
  }, [applyAuthPayloadInternal])

  const runPendingConfigSave = useCallback((): Promise<void> => {
    if (configSaveInFlightRef.current) return configSaveInFlightRef.current
    const pending = pendingConfigRef.current
    if (!pending || !validateConfig(normalizeConfig(pending.config)).ok) return Promise.resolve()
    const savePending = async () => {
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
        if (!data.user) throw new Error(copy.common.pages_tool_useToolSession_006)
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
        configSaveInFlightRef.current = null
        const latest = pendingConfigRef.current
        if (latest && latest.generation !== pending.generation) {
          await runPendingConfigSave()
        }
      }
    }
    configSaveInFlightRef.current = savePending()
    return configSaveInFlightRef.current
  }, [applyAuthPayloadInternal])

  const applyWorkspaceSnapshot = useCallback((profileId: string, nextWorkspace: UserWorkspace) => {
    const profile = activeProfileRef.current
    if (!profile || profile.id !== profileId) return
    setWorkspace(nextWorkspace)
    setEliteOverridesState(nextWorkspace.elite_overrides ?? {})
    setLicense(nextWorkspace.operators && nextWorkspace.config
      ? createAccountLicense(profile, nextWorkspace.operators, nextWorkspace.config)
      : null)
  }, [])

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

  const flushConfigSave = useCallback(async () => {
    if (configSaveTimerRef.current !== null) {
      window.clearTimeout(configSaveTimerRef.current)
      configSaveTimerRef.current = null
    }
    await runPendingConfigSave()
    return !pendingConfigRef.current
  }, [runPendingConfigSave])

  const retryConfigSave = useCallback(() => {
    if (!pendingConfigRef.current) return
    setConfigSyncStatus('pending')
    void flushConfigSave()
  }, [flushConfigSave])

  const handleLogout = useCallback(async () => {
    if (!await flushConfigSave()) return
    cancelPendingConfigSave()
    await apiVoid('/api/auth/logout', { method: 'POST' })
    applyAuthPayload(null)
  }, [applyAuthPayload, cancelPendingConfigSave, flushConfigSave])

  const cdkProfiles = useMemo(() => profiles.filter(isSchedulableProfile), [profiles])
  const activeCdkProfile = activeProfile && isSchedulableProfile(activeProfile) ? activeProfile : cdkProfiles[0] ?? null

  return {
    authStatus,
    authError,
    retryAuth,
    authLoading: authStatus === 'loading',
    user,
    profiles,
    activeProfile,
    activeCdkProfile,
    cdkProfiles,
    workspace,
    license,
    setLicense,
    eliteOverrides,
    configOverride,
    setConfigOverride,
    configSyncStatus,
    flushConfigSave,
    retryConfigSave,
    banner,
    popups,
    announcementUnreadCount,
    setAnnouncementUnreadCount,
    openingProfileId,
    workspaceLoadError,
    applyAuthPayload,
    refreshProfileWorkspace,
    applyWorkspaceSnapshot,
    persistWorkspacePatch,
    handleLogout,
  }
}
