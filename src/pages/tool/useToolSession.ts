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

export type WorkspaceMode = 'dashboard' | 'setup' | 'optimize'
export type WorkspacePatch = Partial<UserWorkspace> & { saved_config_action?: WorkspaceSavedConfigAction }

export function useToolSession() {
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profiles, setProfiles] = useState<UserGameAccount[]>([])
  const [activeProfile, setActiveProfile] = useState<UserGameAccount | null>(null)
  const [workspace, setWorkspace] = useState<UserWorkspace | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('dashboard')
  const [license, setLicense] = useState<LicenseFile | null>(null)
  const [eliteOverrides, setEliteOverridesState] = useState<Record<string, number>>({})
  const [configOverride, setConfigOverrideState] = useState<LicenseConfig | null>(null)
  const [banner, setBanner] = useState<Announcement | null>(null)
  const [popups, setPopups] = useState<Announcement[]>([])
  const [announcementUnreadCount, setAnnouncementUnreadCount] = useState(0)
  const [openingProfileId, setOpeningProfileId] = useState<string | null>(null)
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null)
  const workspacePatchQueueRef = useRef<Promise<void>>(Promise.resolve())

  const applyAuthPayload = useCallback((payload: AuthSuccessResponse | null, nextMode?: WorkspaceMode) => {
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
    setConfigOverrideState(null)
    setLicense(nextProfile && nextWorkspace?.operators && nextWorkspace.config
      ? createAccountLicense(nextProfile, nextWorkspace.operators, nextWorkspace.config)
      : null)
    setWorkspaceMode(nextMode ?? 'dashboard')
  }, [])

  useEffect(() => {
    let cancelled = false

    void apiJsonOrNull<AnnouncementPublicResponse>('/api/announcement')
      .then((data) => {
        if (cancelled) return
        setBanner(data?.banner ?? null)
        setPopups(Array.isArray(data?.popups) ? data.popups : [])
      })
      .catch(console.error)

    void apiJson<Partial<AuthSuccessResponse> & { user: AuthUser | null }>('/api/auth/me', { fallbackMessage: '确认登录信息失败' })
      .then((data) => {
        if (cancelled) return
        if (!data.user) {
          applyAuthPayload(null)
          return
        }
        applyAuthPayload(data as AuthSuccessResponse, 'dashboard')
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
  }, [applyAuthPayload])

  const refreshProfileWorkspace = useCallback(async (profile: UserGameAccount, mode: WorkspaceMode) => {
    setOpeningProfileId(profile.id)
    setWorkspaceLoadError(null)
    try {
      const data = await apiJson<AuthSuccessResponse>(`/api/user/workspace?profile_id=${encodeURIComponent(profile.id)}`, {
        fallbackMessage: '加载账号资料失败',
      })
      applyAuthPayload(data, mode)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '加载账号资料失败，请稍后重试。'
      setWorkspaceLoadError(message)
      throw caught
    } finally {
      setOpeningProfileId(null)
    }
  }, [applyAuthPayload])

  const persistWorkspacePatch = useCallback((patch: WorkspacePatch) => {
    if (!activeProfile) return Promise.reject(new Error('请先选择游戏账号。'))
    const runPatch = async () => {
      const data = await apiJson<AuthSuccessResponse>('/api/user/workspace', {
        method: 'PATCH',
        json: { ...patch, profile_id: activeProfile.id },
        fallbackMessage: '保存失败',
      })
      applyAuthPayload(data, workspaceMode)
      return data
    }
    const request = workspacePatchQueueRef.current.then(runPatch, runPatch)
    workspacePatchQueueRef.current = request.then(() => undefined, () => undefined)
    return request
  }, [activeProfile, applyAuthPayload, workspaceMode])

  const setEliteOverrides = useCallback((next: Record<string, number>) => {
    setEliteOverridesState(next)
    void persistWorkspacePatch({ elite_overrides: next }).catch(console.error)
  }, [persistWorkspacePatch])

  const setConfigOverride = useCallback((next: LicenseConfig | null) => {
    setConfigOverrideState(next)
    const nextConfig = next ?? license?.config ?? null
    if (nextConfig) void persistWorkspacePatch({ config: nextConfig }).catch(console.error)
  }, [license, persistWorkspacePatch])

  const handleLogout = useCallback(async () => {
    await apiVoid('/api/auth/logout', { method: 'POST' })
    applyAuthPayload(null)
  }, [applyAuthPayload])

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
    workspaceMode,
    setWorkspaceMode,
    license,
    setLicense,
    eliteOverrides,
    setEliteOverrides,
    configOverride,
    setConfigOverride,
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
