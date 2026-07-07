import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthSuccessResponse, UserGameAccount } from '../lib/types'
import { apiJson } from '../lib/api-client'

type IntermediateProduct = 'Originium Shard' | 'Pure Gold'

export type SklandPreview = {
  uid: string
  nickname: string
  channel_name: string
  operator_count: number
}

export type SklandRecoveryAction = 'rebind' | 'retry' | 'bind_first' | 'use_depot_analysis'

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
  warning?: string
  status?: string
}

export type SklandImportMode = 'scan' | 'manual' | 'bookmarklet'
export type SklandLoginStatus = 'idle' | 'starting' | 'waiting' | 'confirm_required' | 'account_mismatch' | 'importing' | 'imported' | 'frozen' | 'error'

export type SklandLoginState = {
  mode: SklandImportMode
  scanId: string | null
  qrDataUrl: string | null
  expiresAt: string | null
  confirmationId: string | null
  preview: SklandPreview | null
  status: SklandLoginStatus
  message: string | null
}

type UseSklandBindingOptions = {
  open: boolean
  profile: UserGameAccount | null
  context?: 'workspace' | 'depot'
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

  const applyCompletedPayload = useCallback((data: SklandPayload) => {
    onPayload(data)
    onCompleted?.(data)
  }, [onCompleted, onPayload])

  const showPayloadState = useCallback((data: SklandPayload, fallback: string): boolean => {
    if (data.status === 'confirm_required' && data.confirmation_id && data.skland_preview) {
      setSklandLogin((current) => ({
        ...current,
        qrDataUrl: null,
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
        confirmationId: null,
        preview: data.skland_preview ?? null,
        status: 'account_mismatch',
        message: data.warning || '该账号与当前绑定账号不一致。请重新登录正确的森空岛账号。',
      }))
      return true
    }
    if (data.status === 'frozen') {
      if (data.user) onPayload(data)
      setSklandLogin((current) => ({
        ...current,
        qrDataUrl: null,
        confirmationId: null,
        preview: data.skland_preview ?? null,
        status: 'frozen',
        message: data.warning || '当前游戏账号档案已冻结，请联系管理员处理。',
      }))
      return true
    }
    return false
  }, [onPayload])

  const completeSklandLogin = useCallback(async (scanId: string) => {
    if (!profile || busy) return
    setBusy(true)
    setSklandLogin((current) => ({
      ...current,
      status: 'waiting',
      message: '正在检查扫码状态，请在森空岛 App 中确认授权。',
    }))
    try {
      const data = await apiJson<SklandPayload>('/api/user/skland/login/complete', {
        method: 'POST',
        json: { profile_id: profile.id, scan_id: scanId },
        fallbackMessage: '森空岛导入失败',
      })
      if (data.status === 'pending') {
        setSklandLogin((current) => ({ ...current, status: 'waiting', message: '等待森空岛 App 确认授权。' }))
        return
      }
      if (showPayloadState(data, previewFallbackMessage(isDepot))) return
      if (!data.user) throw new Error(data.error || '森空岛导入失败')
      applyCompletedPayload(data)
      setSklandLogin((current) => ({
        ...current,
        status: 'imported',
        message: formatImportedMessage(data, isDepot),
      }))
    } catch (caught) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: errorWithRecovery(caught, '扫码失败，请重新生成二维码，或改用粘贴凭据。') }))
    } finally {
      setBusy(false)
    }
  }, [applyCompletedPayload, busy, isDepot, profile, showPayloadState])

  const startSklandLogin = useCallback(async () => {
    if (!profile) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: '请先创建或选择账号档案，然后再绑定森空岛。' }))
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
      confirmationId: null,
      preview: null,
      status: 'starting',
      message: '正在生成森空岛扫码授权二维码。',
    })
    try {
      const data = await apiJson<{ scan_id?: string; qr_data_url?: string; expires_at?: string }>('/api/user/skland/login/start', {
        method: 'POST',
        json: { profile_id: profile.id },
        fallbackMessage: '生成森空岛二维码失败',
      })
      if (!data.scan_id || !data.qr_data_url) throw new Error('生成森空岛二维码失败')
      if (startRequestRef.current !== requestId) return
      setSklandLogin({
        mode: 'scan',
        scanId: data.scan_id,
        qrDataUrl: data.qr_data_url,
        expiresAt: data.expires_at ?? null,
        confirmationId: null,
        preview: null,
        status: 'waiting',
        message: '请使用森空岛 App 扫码确认。确认后会先展示昵称和 UID，不会立即保存。',
      })
      pollCountRef.current = 0
    } catch (caught) {
      if (startRequestRef.current !== requestId) return
      setSklandLogin((current) => ({ ...current, status: 'error', message: errorWithRecovery(caught, '二维码生成失败，请稍后重试，或改用粘贴凭据。') }))
    } finally {
      if (startRequestRef.current === requestId) setBusy(false)
    }
  }, [profile])

  const previewCredential = useCallback(async (source: 'manual' | 'bookmarklet') => {
    if (!profile) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: '请先创建或选择账号档案，然后再绑定森空岛。' }))
      return
    }
    const credentialText = credentialInputRef.current?.value.trim() ?? ''
    if (!credentialText) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: '请先粘贴森空岛凭据，再读取账号预览。' }))
      credentialInputRef.current?.focus()
      return
    }
    setBusy(true)
    setSklandLogin((current) => ({ ...current, status: 'starting', message: '正在读取森空岛账号信息。' }))
    try {
      const data = await apiJson<SklandPayload>('/api/user/skland/credential/preview', {
        method: 'POST',
        json: { profile_id: profile.id, credential_text: credentialText, source },
        fallbackMessage: '森空岛凭据读取失败',
      })
      if (!showPayloadState(data, previewFallbackMessage(isDepot))) {
        throw new Error(data.error || '森空岛凭据已读取，但未返回可确认账号。')
      }
      if (credentialInputRef.current) credentialInputRef.current.value = ''
    } catch (caught) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: errorWithRecovery(caught, '请重新获取凭据，或改用扫码授权。') }))
    } finally {
      setBusy(false)
    }
  }, [isDepot, profile, showPayloadState])

  const confirmSklandLogin = useCallback(async () => {
    if (!profile || !sklandLogin.confirmationId) return
    setBusy(true)
    setSklandLogin((current) => ({ ...current, status: 'importing', message: isDepot ? '正在保存森空岛绑定并准备分析仓库。' : '正在保存森空岛绑定并导入干员数据。' }))
    try {
      const data = await apiJson<SklandPayload>('/api/user/skland/login/confirm', {
        method: 'POST',
        json: { profile_id: profile.id, confirmation_id: sklandLogin.confirmationId },
        fallbackMessage: '森空岛导入失败',
      })
      if (!data.user) throw new Error('森空岛导入失败')
      applyCompletedPayload(data)
      setSklandLogin((current) => ({
        ...current,
        confirmationId: null,
        preview: null,
        status: 'imported',
        message: formatImportedMessage(data, isDepot),
      }))
    } catch (caught) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: errorWithRecovery(caught, isDepot ? '请重新预览后再保存仓库绑定。' : '请重新预览后再导入。') }))
    } finally {
      setBusy(false)
    }
  }, [applyCompletedPayload, isDepot, profile, sklandLogin.confirmationId])

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
    if (autoStart && profile?.id && startedForProfileRef.current !== profile.id) {
      startedForProfileRef.current = profile.id
      void startSklandLogin()
    }
  }, [autoStart, open, profile?.id, startSklandLogin])

  useEffect(() => {
    if (!open || sklandLogin.mode !== 'scan' || !sklandLogin.scanId || sklandLogin.status !== 'waiting') return
    if (sklandLogin.expiresAt && Date.now() > Date.parse(sklandLogin.expiresAt)) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: '二维码已过期。请重新生成二维码，或改用粘贴凭据。' }))
      return
    }
    if (pollCountRef.current >= SKLAND_SCAN_MAX_POLLS) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: '扫码等待超时。请重新生成二维码，或改用粘贴凭据。',
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
    confirmationId: null,
    preview: null,
    status: 'idle',
    message: null,
  }
}

function modeIntro(mode: SklandImportMode): string {
  if (mode === 'scan') return '生成二维码后，使用森空岛 App 授权。授权后会先预览昵称和 UID。'
  if (mode === 'manual') return '粘贴森空岛凭据后读取账号预览，确认前不会保存。'
  return '安装书签脚本后复制凭据，粘贴后读取账号预览。'
}

function previewFallbackMessage(isDepot: boolean): string {
  return isDepot ? '请确认森空岛账号信息，确认后将保存绑定并分析仓库。' : '请确认森空岛账号信息，确认后将保存绑定并导入干员数据。'
}

function errorWithRecovery(caught: unknown, fallback: string): string {
  const message = caught instanceof Error ? caught.message : ''
  return message ? `${message} ${fallback}` : fallback
}

function formatImportedMessage(data: SklandPayload, isDepot: boolean): string {
  if (isDepot) return '森空岛已保存，正在读取仓库库存。'
  if (!data.skland_import) return '森空岛干员数据已导入。'
  const inventoryMessage = formatSklandInventoryMessage(data.skland_import)
  return `已导入 ${data.skland_import.operator_count} 名干员：${data.skland_import.nickname}${inventoryMessage ? `。${inventoryMessage}` : ''}`
}

function formatSklandInventoryMessage(imported: NonNullable<SklandPayload['skland_import']>): string {
  if (imported.inventory_synced && imported.intermediate_inventory) {
    return `已同步${formatInventoryAmount('Pure Gold', imported.intermediate_inventory['Pure Gold'])}、${formatInventoryAmount('Originium Shard', imported.intermediate_inventory['Originium Shard'])}到基建配置`
  }
  if (imported.inventory_warning) return '干员已导入，库存同步失败，可稍后刷新'
  return ''
}

function formatInventoryAmount(product: IntermediateProduct, value: number | undefined): string {
  const label = product === 'Pure Gold' ? '赤金' : '源石碎片'
  const count = Number(value ?? 0)
  return `${label} ${Number.isFinite(count) ? count : 0}`
}
