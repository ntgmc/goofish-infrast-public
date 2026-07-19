import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthSuccessResponse, UserGameAccount } from '../lib/types'
import { apiJson } from '../lib/api-client'
import { copy } from '../copy/index'


type IntermediateProduct = 'Originium Shard' | 'Pure Gold'

export type SklandPreview = {
  uid: string
  nickname: string
  channel_name: string
  operator_count: number
}

export type SklandAccountOption = {
  uid: string
  nickname: string
  channel_name: string
  is_default: boolean
}

type SklandRecoveryAction = 'rebind' | 'retry' | 'bind_first' | 'use_depot_analysis'

export type SklandPayload = AuthSuccessResponse & {
  skland_import?: {
    status: 'imported'
    uid: string
    nickname: string
    channel_name: string
    operator_count: number
    imported_at: string
    intermediate_inventory?: Record<IntermediateProduct, number>
    inventory_synced: boolean
    config_saved: boolean
    inventory_warning?: string
  }
  error?: string
  code?: 'skland_credential_invalid' | 'skland_refresh_failed' | 'skland_not_bound' | 'skland_depot_refresh_forbidden'
  recovery_action?: SklandRecoveryAction
  confirmation_id?: string
  skland_preview?: SklandPreview
  selection_id?: string
  skland_accounts?: SklandAccountOption[]
  warning?: string
  status?: string
}

export type SklandImportMode = 'scan' | 'manual' | 'bookmarklet'
type SklandLoginStatus = 'idle' | 'starting' | 'waiting' | 'account_selection_required' | 'confirm_required' | 'account_mismatch' | 'importing' | 'imported' | 'frozen' | 'error'

export type SklandLoginState = {
  mode: SklandImportMode
  scanId: string | null
  qrDataUrl: string | null
  expiresAt: string | null
  selectionId: string | null
  accountOptions: SklandAccountOption[]
  selectedUid: string | null
  confirmationId: string | null
  preview: SklandPreview | null
  status: SklandLoginStatus
  message: string | null
}

type UseSklandBindingOptions = {
  open: boolean
  profile: UserGameAccount | null
  context?: 'workspace' | 'depot' | 'free_preview_claim'
  claimProfileMeta?: {
    displayName?: string
    note?: string
  }
  autoStart?: boolean
  onOpenChange: (open: boolean) => void
  onPayload: (payload: SklandPayload) => void
  onCompleted?: (payload: SklandPayload) => void
}

const SKLAND_SCAN_POLL_DELAY_MS = 5000
const SKLAND_SCAN_MAX_POLLS = 18

export function useSklandBinding({
  open,
  profile,
  context = 'workspace',
  claimProfileMeta,
  autoStart = false,
  onOpenChange,
  onPayload,
  onCompleted,
}: UseSklandBindingOptions) {
  const [sklandLogin, setSklandLogin] = useState<SklandLoginState>(() => createInitialState())
  const [busy, setBusy] = useState(false)
  const pollCountRef = useRef(0)
  const startRequestRef = useRef(0)
  const credentialInputRef = useRef<HTMLTextAreaElement>(null)
  const startedForProfileRef = useRef<string | null>(null)
  const isDepot = context === 'depot'
  const isFreePreviewClaim = context === 'free_preview_claim'
  const endpointPrefix = isFreePreviewClaim ? '/api/user/skland/free-preview' : '/api/user/skland'

  const profilePayload = useCallback(() => (
    isFreePreviewClaim
      ? { display_name: claimProfileMeta?.displayName ?? '', note: claimProfileMeta?.note ?? '' }
      : { profile_id: profile?.id }
  ), [claimProfileMeta?.displayName, claimProfileMeta?.note, isFreePreviewClaim, profile?.id])

  const applyCompletedPayload = useCallback((data: SklandPayload) => {
    onPayload(data)
    onCompleted?.(data)
  }, [onCompleted, onPayload])

  const showPayloadState = useCallback((data: SklandPayload, fallback: string): boolean => {
    if (data.status === 'account_selection_required' && data.selection_id && data.skland_accounts?.length) {
      setSklandLogin((current) => ({
        ...current,
        qrDataUrl: null,
        selectionId: data.selection_id ?? null,
        accountOptions: data.skland_accounts ?? [],
        selectedUid: null,
        confirmationId: null,
        preview: null,
        status: 'account_selection_required',
        message: data.warning || copy.workspace.hooks_useSklandBinding_001,
      }))
      return true
    }
    if (data.status === 'confirm_required' && data.confirmation_id && data.skland_preview) {
      setSklandLogin((current) => ({
        ...current,
        qrDataUrl: null,
        selectionId: null,
        accountOptions: [],
        selectedUid: null,
        confirmationId: data.confirmation_id ?? null,
        preview: data.skland_preview ?? null,
        status: 'confirm_required',
        message: data.warning || fallback,
      }))
      return true
    }
    if (data.status === 'account_mismatch' && data.skland_preview) {
      setSklandLogin((current) => ({
        ...current,
        qrDataUrl: null,
        selectionId: null,
        accountOptions: [],
        selectedUid: null,
        confirmationId: null,
        preview: data.skland_preview ?? null,
        status: 'account_mismatch',
        message: data.warning || copy.workspace.hooks_useSklandBinding_002,
      }))
      return true
    }
    if (data.status === 'frozen') {
      if (data.user) onPayload(data)
      setSklandLogin((current) => ({
        ...current,
        qrDataUrl: null,
        selectionId: null,
        accountOptions: [],
        selectedUid: null,
        confirmationId: null,
        preview: data.skland_preview ?? null,
        status: 'frozen',
        message: data.warning || copy.workspace.hooks_useSklandBinding_003,
      }))
      return true
    }
    return false
  }, [onPayload])

  const completeSklandLogin = useCallback(async (scanId: string) => {
    if ((!profile && !isFreePreviewClaim) || busy) return
    setBusy(true)
    setSklandLogin((current) => ({
      ...current,
      status: 'waiting',
      message: copy.workspace.hooks_useSklandBinding_004,
    }))
    try {
      const data = await apiJson<SklandPayload>(`${endpointPrefix}/login/complete`, {
        method: 'POST',
        json: { ...profilePayload(), scan_id: scanId },
        fallbackMessage: copy.workspace.hooks_useSklandBinding_005,
      })
      if (data.status === 'pending') {
        setSklandLogin((current) => ({ ...current, status: 'waiting', message: copy.workspace.hooks_useSklandBinding_006 }))
        return
      }
      if (showPayloadState(data, previewFallbackMessage(isDepot))) return
      if (!data.user) throw new Error(data.error || copy.workspace.hooks_useSklandBinding_007)
      applyCompletedPayload(data)
      setSklandLogin((current) => ({
        ...current,
        status: 'imported',
        message: formatImportedMessage(data, isDepot),
      }))
    } catch (caught) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: errorWithRecovery(caught, copy.workspace.hooks_useSklandBinding_008),
      }))
    } finally {
      setBusy(false)
    }
  }, [applyCompletedPayload, busy, endpointPrefix, isDepot, isFreePreviewClaim, profile, profilePayload, showPayloadState])

  const startSklandLogin = useCallback(async () => {
    if (!profile && !isFreePreviewClaim) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: copy.workspace.hooks_useSklandBinding_009,
      }))
      return
    }
    const requestId = startRequestRef.current + 1
    startRequestRef.current = requestId
    setBusy(true)
    setSklandLogin({
      mode: 'scan',
      scanId: null,
      qrDataUrl: null,
      expiresAt: null,
      selectionId: null,
      accountOptions: [],
      selectedUid: null,
      confirmationId: null,
      preview: null,
      status: 'starting',
      message: copy.workspace.hooks_useSklandBinding_010,
    })
    try {
      const data = await apiJson<{ scan_id?: string; qr_data_url?: string; expires_at?: string }>(`${endpointPrefix}/login/start`, {
        method: 'POST',
        json: profilePayload(),
        fallbackMessage: copy.workspace.hooks_useSklandBinding_011,
      })
      if (!data.scan_id || !data.qr_data_url) throw new Error(copy.workspace.hooks_useSklandBinding_012)
      if (startRequestRef.current !== requestId) return
      setSklandLogin({
        mode: 'scan',
        scanId: data.scan_id,
        qrDataUrl: data.qr_data_url,
        expiresAt: data.expires_at ?? null,
        selectionId: null,
        accountOptions: [],
        selectedUid: null,
        confirmationId: null,
        preview: null,
        status: 'waiting',
        message: copy.workspace.hooks_useSklandBinding_013,
      })
      pollCountRef.current = 0
    } catch (caught) {
      if (startRequestRef.current !== requestId) return
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: errorWithRecovery(caught, copy.workspace.hooks_useSklandBinding_014),
      }))
    } finally {
      if (startRequestRef.current === requestId) setBusy(false)
    }
  }, [endpointPrefix, isFreePreviewClaim, profile, profilePayload])

  const previewCredential = useCallback(async (source: 'manual' | 'bookmarklet') => {
    if (!profile && !isFreePreviewClaim) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: copy.workspace.hooks_useSklandBinding_015,
      }))
      return
    }
    const credentialText = credentialInputRef.current?.value.trim() ?? ''
    if (!credentialText) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: copy.workspace.hooks_useSklandBinding_016,
      }))
      credentialInputRef.current?.focus()
      return
    }
    setBusy(true)
    setSklandLogin((current) => ({ ...current, status: 'starting', message: copy.workspace.hooks_useSklandBinding_017 }))
    try {
      const data = await apiJson<SklandPayload>(`${endpointPrefix}/credential/preview`, {
        method: 'POST',
        json: { ...profilePayload(), credential_text: credentialText, source },
        fallbackMessage: copy.workspace.hooks_useSklandBinding_018,
      })
      if (!showPayloadState(data, previewFallbackMessage(isDepot))) {
        throw new Error(data.error || copy.workspace.hooks_useSklandBinding_019)
      }
      if (credentialInputRef.current) credentialInputRef.current.value = ''
    } catch (caught) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: errorWithRecovery(caught, copy.workspace.hooks_useSklandBinding_020),
      }))
    } finally {
      setBusy(false)
    }
  }, [endpointPrefix, isDepot, isFreePreviewClaim, profile, profilePayload, showPayloadState])

  const selectAccount = useCallback((uid: string) => {
    setSklandLogin((current) => ({ ...current, selectedUid: uid }))
  }, [])

  const previewSelectedAccount = useCallback(async () => {
    if ((!profile && !isFreePreviewClaim) || !sklandLogin.selectionId || !sklandLogin.selectedUid || busy) return
    setBusy(true)
    setSklandLogin((current) => ({ ...current, message: copy.workspace.hooks_useSklandBinding_021 }))
    try {
      const data = await apiJson<SklandPayload>(`${endpointPrefix}/account/select`, {
        method: 'POST',
        json: {
          ...profilePayload(),
          selection_id: sklandLogin.selectionId,
          uid: sklandLogin.selectedUid,
        },
        fallbackMessage: copy.workspace.hooks_useSklandBinding_022,
      })
      if (!showPayloadState(data, previewFallbackMessage(isDepot))) {
        throw new Error(data.error || copy.workspace.hooks_useSklandBinding_023)
      }
    } catch (caught) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: errorWithRecovery(caught, copy.workspace.hooks_useSklandBinding_024),
      }))
    } finally {
      setBusy(false)
    }
  }, [busy, endpointPrefix, isDepot, isFreePreviewClaim, profile, profilePayload, showPayloadState, sklandLogin.selectedUid, sklandLogin.selectionId])

  const confirmSklandLogin = useCallback(async () => {
    if ((!profile && !isFreePreviewClaim) || !sklandLogin.confirmationId) return
    setBusy(true)
    setSklandLogin((current) => ({
      ...current,
      status: 'importing',
      message: isDepot ? copy.workspace.hooks_useSklandBinding_025 : copy.workspace.hooks_useSklandBinding_026,
    }))
    try {
      const data = await apiJson<SklandPayload>(`${endpointPrefix}/login/confirm`, {
        method: 'POST',
        json: { ...profilePayload(), confirmation_id: sklandLogin.confirmationId },
        fallbackMessage: copy.workspace.hooks_useSklandBinding_027,
      })
      if (!data.user) throw new Error(copy.workspace.hooks_useSklandBinding_028)
      applyCompletedPayload(data)
      setSklandLogin((current) => ({
        ...current,
        selectionId: null,
        accountOptions: [],
        selectedUid: null,
        confirmationId: null,
        preview: null,
        status: 'imported',
        message: formatImportedMessage(data, isDepot),
      }))
    } catch (caught) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: errorWithRecovery(caught, isDepot ? copy.workspace.hooks_useSklandBinding_029 : copy.workspace.hooks_useSklandBinding_030),
      }))
    } finally {
      setBusy(false)
    }
  }, [applyCompletedPayload, endpointPrefix, isDepot, isFreePreviewClaim, profile, profilePayload, sklandLogin.confirmationId])

  const close = useCallback(() => {
    startRequestRef.current += 1
    setBusy(false)
    onOpenChange(false)
  }, [onOpenChange])

  const selectMode = useCallback((mode: SklandImportMode) => {
    startRequestRef.current += 1
    setBusy(false)
    setSklandLogin((current) => {
      const keepWaitingScan = mode === 'scan' && current.status === 'waiting' && Boolean(current.scanId && current.qrDataUrl)
      return {
        mode,
        scanId: keepWaitingScan ? current.scanId : null,
        qrDataUrl: keepWaitingScan ? current.qrDataUrl : null,
        expiresAt: keepWaitingScan ? current.expiresAt : null,
        selectionId: null,
        accountOptions: [],
        selectedUid: null,
        confirmationId: null,
        preview: null,
        status: keepWaitingScan ? 'waiting' : 'idle',
        message: keepWaitingScan ? current.message : modeIntro(mode),
      }
    })
    window.setTimeout(() => credentialInputRef.current?.focus(), 0)
  }, [])

  const setMessage = useCallback((message: string) => {
    setSklandLogin((current) => ({ ...current, message }))
  }, [])

  useEffect(() => {
    if (!open) {
      setSklandLogin(createInitialState())
      startedForProfileRef.current = null
      return
    }
    const startKey = profile?.id ?? (isFreePreviewClaim ? 'free-preview-claim' : null)
    if (autoStart && startKey && startedForProfileRef.current !== startKey) {
      startedForProfileRef.current = startKey
      void startSklandLogin()
    }
  }, [autoStart, isFreePreviewClaim, open, profile?.id, startSklandLogin])

  useEffect(() => {
    if (!open || sklandLogin.mode !== 'scan' || !sklandLogin.scanId || sklandLogin.status !== 'waiting') return
    if (sklandLogin.expiresAt && Date.now() > Date.parse(sklandLogin.expiresAt)) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: copy.workspace.hooks_useSklandBinding_031,
      }))
      return
    }
    if (pollCountRef.current >= SKLAND_SCAN_MAX_POLLS) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: copy.workspace.hooks_useSklandBinding_032,
      }))
      return
    }
    const timer = window.setTimeout(() => {
      if (!sklandLogin.scanId) return
      pollCountRef.current += 1
      void completeSklandLogin(sklandLogin.scanId)
    }, SKLAND_SCAN_POLL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [completeSklandLogin, open, sklandLogin.expiresAt, sklandLogin.mode, sklandLogin.scanId, sklandLogin.status])

  return {
    sklandLogin,
    busy,
    credentialInputRef,
    completeSklandLogin,
    startSklandLogin,
    previewCredential,
    selectAccount,
    previewSelectedAccount,
    confirmSklandLogin,
    close,
    selectMode,
    setMessage,
  }
}

function createInitialState(): SklandLoginState {
  return {
    mode: 'scan',
    scanId: null,
    qrDataUrl: null,
    expiresAt: null,
    selectionId: null,
    accountOptions: [],
    selectedUid: null,
    confirmationId: null,
    preview: null,
    status: 'idle',
    message: null,
  }
}

function modeIntro(mode: SklandImportMode): string {
  if (mode === 'scan') return copy.workspace.hooks_useSklandBinding_033
  if (mode === 'manual') return copy.workspace.hooks_useSklandBinding_034
  return copy.workspace.hooks_useSklandBinding_035
}

function previewFallbackMessage(isDepot: boolean): string {
  return isDepot
    ? copy.workspace.hooks_useSklandBinding_036
    : copy.workspace.hooks_useSklandBinding_037
}

function errorWithRecovery(caught: unknown, fallback: string): string {
  const message = caught instanceof Error ? caught.message : ''
  return message ? `${message} ${fallback}` : fallback
}

function formatImportedMessage(data: SklandPayload, isDepot: boolean): string {
  if (isDepot) return copy.workspace.hooks_useSklandBinding_038
  if (!data.skland_import) return copy.workspace.hooks_useSklandBinding_039
  const inventoryMessage = formatSklandInventoryMessage(data.skland_import)
  return `${copy.workspace.hooks_useSklandBinding_040}${data.skland_import.operator_count}${copy.workspace.hooks_useSklandBinding_041}${data.skland_import.nickname}${inventoryMessage ? `。${inventoryMessage}` : ''}`
}

function formatSklandInventoryMessage(imported: NonNullable<SklandPayload['skland_import']>): string {
  if (imported.inventory_synced && imported.intermediate_inventory) {
    return `${copy.workspace.hooks_useSklandBinding_042}${formatInventoryAmount('Pure Gold', imported.intermediate_inventory['Pure Gold'])}、${formatInventoryAmount('Originium Shard', imported.intermediate_inventory['Originium Shard'])}${copy.workspace.hooks_useSklandBinding_043}`
  }
  if (imported.inventory_warning) return copy.workspace.hooks_useSklandBinding_044
  return ''
}

function formatInventoryAmount(product: IntermediateProduct, value: number | undefined): string {
  const label = product === 'Pure Gold' ? copy.workspace.hooks_useSklandBinding_045 : copy.workspace.hooks_useSklandBinding_046
  const count = Number(value ?? 0)
  return `${label} ${Number.isFinite(count) ? count : 0}`
}
