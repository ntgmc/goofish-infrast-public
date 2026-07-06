import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthSuccessResponse, UserGameAccount } from '../lib/types'
import { apiJson } from '../lib/api-client'

export type SklandPreview = {
  uid: string
  nickname: string
  channel_name: string
  operator_count: number
}

export type SklandPayload = AuthSuccessResponse & {
  skland_import?: {
    status: 'imported'
    uid: string
    nickname: string
    channel_name: string
    operator_count: number
    imported_at: string
  }
  error?: string
  confirmation_id?: string
  skland_preview?: SklandPreview
  warning?: string
  status?: string
}

export type SklandLoginState = {
  mode: 'scan' | 'manual' | 'bookmarklet' | 'password'
  scanId: string | null
  qrDataUrl: string | null
  expiresAt: string | null
  confirmationId: string | null
  preview: SklandPreview | null
  status: 'idle' | 'starting' | 'waiting' | 'confirm_required' | 'account_mismatch' | 'importing' | 'imported' | 'frozen' | 'error'
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
  const credentialInputRef = useRef<HTMLTextAreaElement | null>(null)
  const startedForProfileRef = useRef<string | null>(null)
  const isDepot = context === 'depot'

  const applyCompletedPayload = useCallback((data: SklandPayload) => {
    onPayload(data)
    onCompleted?.(data)
  }, [onCompleted, onPayload])

  const completeSklandLogin = useCallback(async (scanId: string) => {
    if (!profile || busy) return
    setBusy(true)
    setSklandLogin((current) => ({
      ...current,
      status: 'waiting',
      message: '正在检查扫码状态，请在森空岛 App 中确认扫码...',
    }))
    try {
      const data = await apiJson<SklandPayload>('/api/user/skland/login/complete', {
        method: 'POST',
        json: { profile_id: profile.id, scan_id: scanId },
        fallbackMessage: '森空岛导入失败',
      })
      if (data.status === 'pending') {
        setSklandLogin((current) => ({ ...current, status: 'waiting', message: '等待森空岛 App 确认扫码...' }))
        return
      }
      if (data.status === 'confirm_required' && data.confirmation_id && data.skland_preview) {
        setSklandLogin((current) => ({
          ...current,
          qrDataUrl: null,
          confirmationId: data.confirmation_id ?? null,
          preview: data.skland_preview ?? null,
          status: 'confirm_required',
          message: data.warning || (isDepot ? '请确认森空岛账号信息，确认后将用于仓库价值分析。' : '请确认森空岛账号信息，确认后将导入干员数据。'),
        }))
        return
      }
      if (data.status === 'account_mismatch' && data.skland_preview) {
        setSklandLogin((current) => ({
          ...current,
          qrDataUrl: null,
          confirmationId: null,
          preview: data.skland_preview ?? null,
          status: 'account_mismatch',
          message: data.warning || '该账号与当前绑定账号不一致，请确认是否扫错账号。',
        }))
        return
      }
      if (data.status === 'frozen') {
        if (data.user) onPayload(data)
        setSklandLogin((current) => ({
          ...current,
          qrDataUrl: null,
          confirmationId: null,
          preview: null,
          status: 'frozen',
          message: data.warning || '当前游戏账号档案已冻结。',
        }))
        return
      }
      if (!data.user) throw new Error(data.error || '森空岛导入失败')
      applyCompletedPayload(data)
      setSklandLogin((current) => ({
        ...current,
        status: 'imported',
        message: formatImportedMessage(data, isDepot),
      }))
    } catch (caught) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: (caught as Error).message }))
    } finally {
      setBusy(false)
    }
  }, [applyCompletedPayload, busy, isDepot, onPayload, profile])

  const startSklandLogin = useCallback(async () => {
    if (!profile) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: '请先创建或选择账号档案。' }))
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
      message: '正在生成森空岛扫码登录二维码...',
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
        message: '请使用森空岛 App 扫码确认，二维码约 2 分钟内有效。',
      })
      pollCountRef.current = 0
    } catch (caught) {
      if (startRequestRef.current !== requestId) return
      setSklandLogin((current) => ({ ...current, status: 'error', message: (caught as Error).message }))
    } finally {
      if (startRequestRef.current === requestId) setBusy(false)
    }
  }, [profile])

  const previewCredential = useCallback(async (source: 'manual' | 'bookmarklet') => {
    if (!profile) return
    const credentialText = credentialInputRef.current?.value.trim() ?? ''
    if (!credentialText) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: '请先粘贴森空岛凭据。' }))
      return
    }
    setBusy(true)
    setSklandLogin((current) => ({ ...current, status: 'starting', message: '正在读取森空岛账号信息...' }))
    try {
      const data = await apiJson<SklandPayload>('/api/user/skland/credential/preview', {
        method: 'POST',
        json: { profile_id: profile.id, credential_text: credentialText, source },
        fallbackMessage: '森空岛凭据读取失败',
      })
      if (credentialInputRef.current) credentialInputRef.current.value = ''
      if (data.status === 'account_mismatch') {
        setSklandLogin((current) => ({
          ...current,
          confirmationId: null,
          preview: data.skland_preview ?? null,
          status: 'account_mismatch',
          message: data.warning || '该账号与当前绑定账号不一致，请确认是否登录错账号。',
        }))
        return
      }
      if (data.status === 'frozen') {
        if (data.user) onPayload(data)
        setSklandLogin((current) => ({
          ...current,
          confirmationId: null,
          preview: data.skland_preview ?? null,
          status: 'frozen',
          message: data.warning || '当前游戏账号档案已冻结。',
        }))
        return
      }
      if (data.status !== 'confirm_required' || !data.confirmation_id || !data.skland_preview) {
        throw new Error(data.error || '森空岛凭据已读取，但未返回可确认账号。')
      }
      setSklandLogin((current) => ({
        ...current,
        confirmationId: data.confirmation_id ?? null,
        preview: data.skland_preview ?? null,
        status: 'confirm_required',
        message: data.warning || (isDepot ? '请确认森空岛账号信息，确认后将用于仓库价值分析。' : '请确认森空岛账号信息，确认后将导入干员数据。'),
      }))
    } catch (caught) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: (caught as Error).message }))
    } finally {
      setBusy(false)
    }
  }, [isDepot, onPayload, profile])

  const confirmSklandLogin = useCallback(async () => {
    if (!profile || !sklandLogin.confirmationId) return
    setBusy(true)
    setSklandLogin((current) => ({ ...current, status: 'importing', message: isDepot ? '正在保存森空岛绑定...' : '正在导入森空岛干员数据...' }))
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
      setSklandLogin((current) => ({ ...current, status: 'error', message: (caught as Error).message }))
    } finally {
      setBusy(false)
    }
  }, [applyCompletedPayload, isDepot, profile, sklandLogin.confirmationId])

  const close = useCallback(() => {
    startRequestRef.current += 1
    setBusy(false)
    onOpenChange(false)
  }, [onOpenChange])

  const selectMode = useCallback((mode: SklandLoginState['mode']) => {
    if (mode === 'password') return
    startRequestRef.current += 1
    setBusy(false)
    setSklandLogin((current) => {
      const keepWaitingScan = mode === 'scan' && current.status === 'waiting' && Boolean(current.scanId && current.qrDataUrl)
      return {
        ...current,
        mode,
        scanId: keepWaitingScan ? current.scanId : null,
        qrDataUrl: keepWaitingScan ? current.qrDataUrl : null,
        expiresAt: keepWaitingScan ? current.expiresAt : null,
        confirmationId: null,
        preview: null,
        status: keepWaitingScan ? 'waiting' : 'idle',
        message: mode === 'scan'
          ? keepWaitingScan
            ? current.message
            : '点击生成二维码后，使用森空岛 App 扫码确认。'
          : mode === 'manual'
            ? '粘贴森空岛凭据后读取账号信息。'
            : '复制书签脚本，在森空岛网页点击后回到这里粘贴。',
      }
    })
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
      setSklandLogin((current) => ({ ...current, status: 'error', message: '二维码已过期，请重新生成。' }))
      return
    }
    if (pollCountRef.current >= SKLAND_SCAN_MAX_POLLS) {
      setSklandLogin((current) => ({
        ...current,
        status: 'error',
        message: '扫码等待超时，请重新生成二维码后再试。',
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

function formatImportedMessage(data: SklandPayload, isDepot: boolean): string {
  if (isDepot) return '森空岛已绑定，正在读取仓库库存...'
  return data.skland_import
    ? `已导入 ${data.skland_import.operator_count} 名干员：${data.skland_import.nickname}`
    : '森空岛干员数据已导入。'
}
