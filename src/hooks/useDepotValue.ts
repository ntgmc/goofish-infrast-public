import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTaskDraft } from '../lib/task-drafts'
import { type SklandPayload } from '../components/SklandBindingDialog'
import { getCurrentSiteUrl } from '../lib/site-url'
import { apiJson } from '../lib/api-client'
import { useSklandSnapshot } from './useSklandSnapshot'
import { syncSklandSnapshotSession } from '../lib/skland-snapshot-client'
import { MAX_DEPOT_ITEM_COUNT, MAX_DEPOT_ITEM_TYPES } from '../lib/depot-value-constraints'
import type { AuthMeResponse, DepotValueItem, DepotValueProfileResponse, DepotValueRequest, DepotValueResponse, UserGameAccount } from '../lib/types'
import { copy, CURRENT_LOCALE } from '../copy/index'
import type { useToolSession } from '../pages/tool/useToolSession'


const LMD_ITEM_ID = '4001'
const DEPOT_REQUEST_MAX_BYTES = 1024 * 1024

export function useDepotValue(session: ReturnType<typeof useToolSession>) {
  const updateSession = useCallback((payload: AuthMeResponse) => {
    if (!payload.user) return
    session.applyAuthPayload({
      user: payload.user, profiles: payload.profiles ?? session.profiles,
      active_profile: session.user ? session.activeProfile : payload.active_profile ?? null,
      workspace: session.user ? session.workspace : payload.workspace,
      announcement_unread_count: payload.announcement_unread_count ?? session.announcementUnreadCount,
    })
  }, [session.user, session.profiles, session.activeProfile, session.workspace, session.announcementUnreadCount, session.applyAuthPayload])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [depotText, setDepotText] = useTaskDraft('depot:upload', '')
  const [auth, setAuth] = useState<AuthMeResponse | null>(null)
  const authLoading = session.authLoading
  const authError = session.authError?.message ?? null
  const [depotProfile, setDepotProfile] = useState<UserGameAccount | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [result, setResult] = useState<DepotValueResponse | null>(null)
  const [loading, setLoading] = useState<DepotValueRequest['source'] | null>(null)
  const [profilePreparing, setProfilePreparing] = useState(false)
  const [sklandDialogOpen, setSklandDialogOpen] = useState(false)
  const [sampleConsent, setSampleConsent] = useTaskDraft('depot:consent', true)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const analyzedVersion = useRef('')
  const selectedAccount = useRef('')

  const applyAuthData = useCallback((data: AuthMeResponse | null) => {
    if (data?.user) syncSklandSnapshotSession({ user: data.user, profiles: data.profiles ?? [] })
    setAuth(data)
    const profiles = data?.profiles ?? []
    const firstSklandProfile = profiles.find((profile) => profile.skland_binding)
    setDepotProfile(profiles.find((profile) => profile.kind === 'depot_value') ?? null)
    setSelectedProfileId((current) => {
      if (current && profiles.some((profile) => profile.id === current && profile.skland_binding)) return current
      return firstSklandProfile?.id ?? ''
    })
  }, [])

  useEffect(() => {
    applyAuthData({ user: session.user, profiles: session.profiles, active_profile: session.activeProfile, workspace: session.workspace })
  }, [applyAuthData, session.user, session.profiles, session.activeProfile, session.workspace])

  useEffect(() => {
    if (!result) return
    drawShareCard(canvasRef.current, result)
    const timer = window.setTimeout(() => document.getElementById('depot-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    return () => window.clearTimeout(timer)
  }, [result])

  const sklandProfiles = useMemo(
    () => auth?.profiles?.filter((profile) => profile.skland_binding) ?? [],
    [auth],
  )
  const selectedSklandProfile = useMemo(
    () => sklandProfiles.find((profile) => profile.id === selectedProfileId) ?? sklandProfiles[0] ?? null,
    [selectedProfileId, sklandProfiles],
  )

  const selectionKey = `${auth?.user?.id}:${selectedSklandProfile?.id}`
  selectedAccount.current = selectionKey
  const snapshot = useSklandSnapshot(auth?.user?.id, selectedSklandProfile)
  useEffect(() => {
    request.current?.abort()
    analyzedVersion.current = ''
    setResult((value) => value?.source === 'skland' ? null : value)
    setLoading(null)
    setError(null)
    return () => request.current?.abort()
  }, [auth?.user?.id, selectedSklandProfile?.id, snapshot.available])

  const analyze = useCallback(async (payload: DepotValueRequest) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(payload.source)
    setError(null)
    try {
      const data = await apiJson<DepotValueResponse>('/api/depot-value', {
        method: 'POST',
        json: payload, signal: controller.signal,
        fallbackMessage: copy.tools.pages_DepotValuePage_001,
      })
      if (!controller.signal.aborted) setResult(data)
    } catch (caught) {
      if (!controller.signal.aborted) setError((caught as Error).message)
    } finally {
      if (!controller.signal.aborted) setLoading(null)
    }
  }, [])

  useEffect(() => {
    const version = snapshot.data?.version
    const profileId = selectedSklandProfile?.id
    const key = `${profileId}:${version}`
    if (!version || !profileId || snapshot.busy || loading || result?.source === 'upload' || depotText.trim()
      || result?.snapshot_version === version || analyzedVersion.current === key) return
    analyzedVersion.current = key
    void analyze({ source: 'skland', profile_id: profileId, sample_consent: false })
  }, [snapshot.data?.version, snapshot.busy, loading, selectedSklandProfile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const ensureDepotProfile = useCallback(async (): Promise<UserGameAccount> => {
    setProfilePreparing(true)
    setError(null)
    try {
      const data = await apiJson<DepotValueProfileResponse>('/api/user/profiles/depot-value', {
        method: 'POST',
        fallbackMessage: copy.tools.pages_DepotValuePage_002,
      })
      if (!data.user || !data.depot_profile) {
        throw new Error(copy.tools.pages_DepotValuePage_003)
      }
      applyAuthData(data)
      updateSession(data)
      setDepotProfile(data.depot_profile)
      setSelectedProfileId(data.depot_profile.id)
      return data.depot_profile
    } finally {
      setProfilePreparing(false)
    }
  }, [applyAuthData, updateSession])

  const openSklandBinding = useCallback(async () => {
    setResult(null)
    setError(null)
    try {
      const profile = depotProfile ?? await ensureDepotProfile()
      setDepotProfile(profile)
      setSelectedProfileId(profile.id)
      setSklandDialogOpen(true)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [depotProfile, ensureDepotProfile])

  const readClipboard = async () => {
    setResult(null)
    setError(null)
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error(copy.tools.pages_DepotValuePage_004)
      }
      const text = await navigator.clipboard.readText()
      if (!text.trim()) throw new Error(copy.tools.pages_DepotValuePage_005)
      setDepotText(text)
    } catch (caught) {
      setError((caught as Error).message || copy.tools.pages_DepotValuePage_006)
    }
  }

  const analyzeUpload = async (event: FormEvent) => {
    event.preventDefault()
    let inventory: unknown
    try {
      inventory = parseDepotText(depotText)
    } catch (caught) {
      setError((caught as Error).message)
      return
    }
    await analyze({ source: 'upload', inventory })
  }

  const analyzeSkland = async () => {
    const profileId = selectedSklandProfile?.id
    if (profileId) {
      setSelectedProfileId(profileId)
      if (selectedSklandProfile?.skland_binding?.credential_status === 'invalid') {
        await openSklandBinding()
        return
      }
      const next = await snapshot.refresh()
      if (selectedAccount.current !== selectionKey) return
      if (next) analyzedVersion.current = `${profileId}:${next.version}`
      await analyze({ source: 'skland', profile_id: profileId, sample_consent: sampleConsent })
      return
    }
    if (!auth?.user) {
      setError(copy.tools.pages_DepotValuePage_007)
      return
    }
    await openSklandBinding()
  }

  const handleSklandPayload = (payload: SklandPayload) => {
    applyAuthData(payload)
    updateSession(payload)
    const profile = payload.active_profile ?? payload.profiles?.find((item) => item.kind === 'depot_value') ?? null
    if (profile?.kind === 'depot_value') setDepotProfile(profile)
  }

  const handleSklandCompleted = (payload: SklandPayload) => {
    handleSklandPayload(payload)
    const completedProfile = payload.active_profile?.skland_binding
      ? payload.active_profile
      : payload.profiles?.find((profile) => profile.kind === 'depot_value' && profile.skland_binding)
    if (!completedProfile?.skland_binding) {
      setError(copy.tools.pages_DepotValuePage_008)
      return
    }
    setSklandDialogOpen(false)
    setSelectedProfileId(completedProfile.id)
    void analyze({ source: 'skland', profile_id: completedProfile.id, sample_consent: sampleConsent })
  }

  const downloadShareImage = () => {
    const canvas = canvasRef.current
    if (!canvas || !result) return
    const link = document.createElement('a')
    link.download = `maa-depot-value-${result.percentile}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return { canvasRef, depotText, setDepotText, auth, authLoading, authError, depotProfile,
    selectedProfileId, setSelectedProfileId, result, setResult, loading: loading ?? (snapshot.busy ? 'skland' as const : null), profilePreparing, sklandDialogOpen, setSklandDialogOpen,
    sampleConsent, setSampleConsent, error: error || snapshot.error || null, setError, sklandProfiles, selectedSklandProfile, openSklandBinding,
    readClipboard, analyzeUpload, analyzeSkland, handleSklandPayload, handleSklandCompleted, downloadShareImage }
}

function drawShareCard(canvas: HTMLCanvasElement | null, result: DepotValueResponse) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const width = 900
  const height = 1600
  canvas.width = width
  canvas.height = height
  const colors = getShareCardColors()

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, colors.backgroundStart)
  gradient.addColorStop(0.52, colors.backgroundMid)
  gradient.addColorStop(1, colors.backgroundEnd)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  drawCircle(ctx, 720, 170, 220, colors.orbit)
  drawCircle(ctx, 160, 1220, 260, colors.orbitAlt)

  ctx.fillStyle = colors.ink
  ctx.font = `600 34px ${colors.displayFont}`
  ctx.fillText(copy.tools.pages_DepotValuePage_057, 72, 96)
  ctx.font = `400 24px ${colors.bodyFont}`
  ctx.fillStyle = colors.muted
  ctx.fillText(result.ranking.mode === 'sample_adjusted'
    ? `${copy.tools.pages_DepotValuePage_058}${formatNumber(result.ranking.sample_count)}${copy.tools.pages_DepotValuePage_059}`
    : copy.tools.pages_DepotValuePage_060, 72, 136)

  ctx.fillStyle = colors.ink
  ctx.font = `700 60px ${colors.displayFont}`
  ctx.fillText(copy.tools.pages_DepotValuePage_061, 72, 260)
  ctx.font = `700 70px ${colors.displayFont}`
  ctx.fillText(`${copy.tools.pages_DepotValuePage_062}${result.percentile}${copy.tools.pages_DepotValuePage_063}`, 72, 350)

  drawRoundedRect(ctx, 72, 430, 756, 220, 28, colors.panel)
  ctx.fillStyle = colors.muted
  ctx.font = `500 28px ${colors.bodyFont}`
  ctx.fillText(copy.tools.pages_DepotValuePage_064, 112, 502)
  ctx.fillStyle = colors.accentAlt
  ctx.font = `700 82px ${colors.displayFont}`
  ctx.fillText(formatNumber(result.total_equivalent_sanity), 112, 596)

  ctx.fillStyle = colors.ink
  ctx.font = `700 34px ${colors.displayFont}`
  ctx.fillText(copy.tools.pages_DepotValuePage_065, 72, 740)

  result.top_items.slice(0, 5).forEach((item, index) => {
    const y = 804 + index * 116
    drawRoundedRect(ctx, 72, y, 756, 88, 18, colors.panelSubtle)
    ctx.fillStyle = colors.accent
    ctx.font = `700 28px ${colors.bodyFont}`
    ctx.fillText(String(index + 1).padStart(2, '0'), 104, y + 54)
    ctx.fillStyle = colors.ink
    ctx.font = `600 28px ${colors.displayFont}`
    ctx.fillText(truncateText(ctx, item.name, 380), 166, y + 40)
    ctx.fillStyle = colors.muted
    ctx.font = `400 22px ${colors.bodyFont}`
    ctx.fillText(`${copy.tools.pages_DepotValuePage_066}${formatNumber(item.count)}`, 166, y + 70)
    ctx.fillStyle = colors.accentAlt
    ctx.font = `700 28px ${colors.bodyFont}`
    ctx.textAlign = 'right'
    ctx.fillText(formatNumber(item.equivalent_sanity), 790, y + 54)
    ctx.textAlign = 'left'
  })

  drawRoundedRect(ctx, 72, 1380, 756, 154, 24, colors.panel)
  ctx.fillStyle = colors.ink
  ctx.font = `600 28px ${colors.displayFont}`
  ctx.fillText(copy.tools.pages_DepotValuePage_067, 112, 1426)
  ctx.fillStyle = colors.muted
  ctx.font = `400 22px ${colors.bodyFont}`
  ctx.fillText(`${copy.tools.pages_DepotValuePage_068}${getCurrentSiteUrl()}`, 112, 1464)
  ctx.font = `400 18px ${colors.bodyFont}`
  ctx.fillText(truncateText(
    ctx,
    `${result.sources.yituliu} · ${result.sources.pricing_snapshot_id?.slice(0, 12) ?? 'no-snapshot'} · ${result.build_meta.data_version}`,
    676,
  ), 112, 1504)
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
  ctx.fillStyle = fill
  ctx.fill()
}

function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string) {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let next = text
  while (next.length > 1 && ctx.measureText(`${next}…`).width > maxWidth) {
    next = next.slice(0, -1)
  }
  return `${next}…`
}

function getShareCardColors() {
  const styles = window.getComputedStyle(document.documentElement)
  const read = (name: string) => styles.getPropertyValue(name).trim()
  return {
    backgroundStart: read('--share-bg-start'),
    backgroundMid: read('--share-bg-mid'),
    backgroundEnd: read('--share-bg-end'),
    ink: read('--share-ink'),
    muted: read('--share-muted'),
    accent: read('--share-accent'),
    accentAlt: read('--share-accent-alt'),
    orbit: read('--share-orbit'),
    orbitAlt: read('--share-orbit-alt'),
    panel: read('--share-panel'),
    panelSubtle: read('--share-panel-subtle'),
    displayFont: read('--font-display'),
    bodyFont: read('--font-body'),
  }
}

export function formatProfileLabel(profile: UserGameAccount): string {
  const binding = profile.skland_binding
  return binding
    ? `${profile.display_name} · ${binding.nickname} (${binding.uid})${binding.credential_status === 'invalid' ? copy.tools.pages_DepotValuePage_069 : ''}`
    : profile.display_name
}

function parseDepotText(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) throw new Error(copy.tools.pages_DepotValuePage_070)
  if (getUtf8ByteLength(trimmed) > DEPOT_REQUEST_MAX_BYTES) {
    throw new Error(copy.tools.pages_DepotValuePage_099)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    throw new Error(copy.tools.pages_DepotValuePage_071)
  }
  if (getUtf8ByteLength(JSON.stringify({ source: 'upload', inventory: parsed })) > DEPOT_REQUEST_MAX_BYTES) {
    throw new Error(copy.tools.pages_DepotValuePage_099)
  }
  validateDepotInventoryForClient(parsed)
  return parsed
}

function validateDepotInventoryForClient(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(copy.tools.pages_DepotValuePage_071)
  const record = value as Record<string, unknown>
  const entries = Array.isArray(record.items)
    ? record.items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(copy.tools.pages_DepotValuePage_071)
      const itemRecord = item as Record<string, unknown>
      return itemRecord.have ?? itemRecord.count ?? itemRecord.quantity
    })
    : Object.values(record)
  if (entries.length === 0 || entries.length > MAX_DEPOT_ITEM_TYPES) throw new Error(copy.tools.pages_DepotValuePage_071)
  for (const count of entries) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > MAX_DEPOT_ITEM_COUNT) {
      throw new Error(copy.tools.pages_DepotValuePage_100)
    }
  }
}

export function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function formatPricingStatus(status: DepotValueResponse['sources']['yituliu']): string {
  return {
    fresh: copy.tools.pages_DepotValuePage_101,
    stale: copy.tools.pages_DepotValuePage_102,
    unavailable: copy.tools.pages_DepotValuePage_103,
    invalid: copy.tools.pages_DepotValuePage_104,
  }[status]
}

export function formatContributionStatus(status: DepotValueResponse['ranking']['contribution_status']): string {
  return {
    saved: copy.tools.pages_DepotValuePage_105,
    declined: copy.tools.pages_DepotValuePage_106,
    skipped: copy.tools.pages_DepotValuePage_107,
    not_applicable: copy.tools.pages_DepotValuePage_108,
    unavailable: copy.tools.pages_DepotValuePage_109,
  }[status]
}

export function formatOptionalDate(value: string | null): string {
  if (!value) return copy.tools.pages_DepotValuePage_093
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString(CURRENT_LOCALE) : value
}

export function formatRankingNote(result: DepotValueResponse): string {
  if (result.ranking.mode === 'sample_adjusted') {
    const weightText = `${Math.round(result.ranking.sample_weight * 100)}%`
    return `${copy.tools.pages_DepotValuePage_072}${formatNumber(result.ranking.sample_count)}${copy.tools.pages_DepotValuePage_073}${weightText}。`
  }
  if (result.ranking.sample_count > 0) {
    return copy.tools.pages_DepotValuePage_074
  }
  return copy.tools.pages_DepotValuePage_075
}

export function formatUnitSanityLabel(item: DepotValueItem): string {
  if (item.id === LMD_ITEM_ID) return `${copy.tools.pages_DepotValuePage_076}${formatNumber(item.unit_sanity * 10000)}${copy.tools.pages_DepotValuePage_077}`
  return `${copy.tools.pages_DepotValuePage_078}${formatNumber(item.unit_sanity)}${copy.tools.pages_DepotValuePage_079}`
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat(CURRENT_LOCALE, {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}
