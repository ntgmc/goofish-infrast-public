import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthSuccessResponse, UserGameAccount } from '../lib/types'

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

type SklandLoginState = {
  mode: 'scan' | 'manual' | 'bookmarklet' | 'password'
  scanId: string | null
  qrDataUrl: string | null
  expiresAt: string | null
  confirmationId: string | null
  preview: SklandPreview | null
  status: 'idle' | 'starting' | 'waiting' | 'confirm_required' | 'account_mismatch' | 'importing' | 'imported' | 'frozen' | 'error'
  message: string | null
}

type SklandBindingDialogProps = {
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
const SKLAND_CONSOLE_CODE = `(()=>{const raw=localStorage.getItem('SK_OAUTH_CRED_KEY');let cred=raw;try{const data=JSON.parse(raw||'null');cred=data?.cred||data?.value||raw;}catch{}copy(encodeURIComponent(cred||''));console.log(cred?'已复制到粘贴板':'未找到森空岛凭据');})()`
const SKLAND_BOOKMARKLET = `javascript:(()=>{const raw=localStorage.getItem("SK_OAUTH_CRED_KEY");if(!raw){alert("未找到森空岛凭据，请先登录森空岛网页。");return;}let cred=raw;try{const data=JSON.parse(raw);cred=data.cred||data.value||raw;}catch{}const text=encodeURIComponent(cred);const done=()=>alert("森空岛凭据已复制，请回到工具页粘贴。");navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(text).then(done).catch(()=>prompt("复制下面的森空岛凭据",text)):prompt("复制下面的森空岛凭据",text);})()`

export default function SklandBindingDialog({
  open,
  profile,
  context = 'workspace',
  autoStart = false,
  onOpenChange,
  onPayload,
  onCompleted,
}: SklandBindingDialogProps) {
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
      const resp = await fetch('/api/user/skland/login/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id, scan_id: scanId }),
      })
      const data = await resp.json() as SklandPayload
      if (resp.status === 202 || data.status === 'pending') {
        setSklandLogin((current) => ({ ...current, status: 'waiting', message: '等待森空岛 App 确认扫码...' }))
        return
      }
      if (!resp.ok) throw new Error(data.error || `森空岛导入失败: ${resp.status}`)
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
      if (!data.user) throw new Error(data.error || `森空岛导入失败: ${resp.status}`)
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

  const handleStartSklandLogin = useCallback(async () => {
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
      const resp = await fetch('/api/user/skland/login/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id }),
      })
      const data = await resp.json() as { scan_id?: string; qr_data_url?: string; expires_at?: string; error?: string }
      if (!resp.ok || !data.scan_id || !data.qr_data_url) throw new Error(data.error || `生成森空岛二维码失败: ${resp.status}`)
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

  const handlePreviewSklandCredential = useCallback(async (source: 'manual' | 'bookmarklet') => {
    if (!profile) return
    const credentialText = credentialInputRef.current?.value.trim() ?? ''
    if (!credentialText) {
      setSklandLogin((current) => ({ ...current, status: 'error', message: '请先粘贴森空岛凭据。' }))
      return
    }
    setBusy(true)
    setSklandLogin((current) => ({ ...current, status: 'starting', message: '正在读取森空岛账号信息...' }))
    try {
      const resp = await fetch('/api/user/skland/credential/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id, credential_text: credentialText, source }),
      })
      const data = await resp.json() as SklandPayload
      if (!resp.ok) throw new Error(data.error || `森空岛凭据读取失败: ${resp.status}`)
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

  const handleConfirmSklandLogin = useCallback(async () => {
    if (!profile || !sklandLogin.confirmationId) return
    setBusy(true)
    setSklandLogin((current) => ({ ...current, status: 'importing', message: isDepot ? '正在保存森空岛绑定...' : '正在导入森空岛干员数据...' }))
    try {
      const resp = await fetch('/api/user/skland/login/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id, confirmation_id: sklandLogin.confirmationId }),
      })
      const data = await resp.json() as SklandPayload
      if (!resp.ok || !data.user) throw new Error(data.error || `森空岛导入失败: ${resp.status}`)
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

  const handleClose = useCallback(() => {
    startRequestRef.current += 1
    setBusy(false)
    onOpenChange(false)
  }, [onOpenChange])

  const handleSelectMode = useCallback((mode: SklandLoginState['mode']) => {
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

  useEffect(() => {
    if (!open) {
      setSklandLogin(createInitialState())
      startedForProfileRef.current = null
      return
    }
    if (autoStart && profile?.id && startedForProfileRef.current !== profile.id) {
      startedForProfileRef.current = profile.id
      void handleStartSklandLogin()
    }
  }, [autoStart, handleStartSklandLogin, open, profile?.id])

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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6">
      <section className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-surface-3 bg-surface-1 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">森空岛导入</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {isDepot ? '先确认游戏昵称和 UID，确认后即可读取养成库存做仓库价值分析。' : '先展示游戏昵称和 UID，确认无误后才会导入。'}
            </p>
          </div>
          <button type="button" onClick={handleClose} className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
            关闭
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['scan', 'manual', 'bookmarklet', 'password'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleSelectMode(mode)}
              disabled={mode === 'password'}
              className={'rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ' + (sklandLogin.mode === mode ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3')}
            >
              {mode === 'scan' ? '扫码登录' : mode === 'manual' ? '手动凭据' : mode === 'bookmarklet' ? '书签脚本' : '模拟登录'}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">推荐使用扫码登录，无法扫码时可更换其他方式。</p>

        {sklandLogin.mode === 'manual' && (
          <div className="mt-5 space-y-3 rounded-lg border border-surface-3 bg-surface-0 p-4">
            <ol className="space-y-3 text-sm leading-6 text-ink-secondary">
              <li><span className="font-semibold text-ink-primary">1. 登录森空岛网页：</span>点击下方按钮打开森空岛官网，在网页中完成登录。</li>
              <li><span className="font-semibold text-ink-primary">2. 复制凭据：</span>登录后按 F12 打开开发者工具，切到 Console/控制台，执行下方一图流命令。</li>
              <li><span className="font-semibold text-ink-primary">3. 粘贴导入：</span>把剪贴板中的凭据粘贴到输入框，读取账号信息后再确认。</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => window.open('https://www.skland.com/index', '_blank', 'noopener,noreferrer')} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
                打开森空岛官网
              </button>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(SKLAND_CONSOLE_CODE)} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
                复制一图流命令
              </button>
            </div>
            <textarea readOnly value={SKLAND_CONSOLE_CODE} rows={3} className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-xs text-ink-secondary outline-none" />
            <textarea ref={credentialInputRef} rows={4} className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-sm text-ink-primary outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" placeholder="粘贴森空岛凭据" />
            <button type="button" onClick={() => void handlePreviewSklandCredential('manual')} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
              读取账号信息
            </button>
          </div>
        )}

        {sklandLogin.mode === 'bookmarklet' && (
          <div className="mt-5 space-y-3 rounded-lg border border-surface-3 bg-surface-0 p-4">
            <div className="space-y-2 text-sm leading-6 text-ink-secondary">
              <p>按住下面的书签按钮拖到浏览器书签栏。在森空岛登录后点击该书签，它会复制凭据，回到这里粘贴即可。</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <StepBox index="1" label="显示浏览器书签栏" />
                <StepBox index="2" label="拖动按钮到书签栏" />
                <StepBox index="3" label="在森空岛页面点击书签" />
              </div>
            </div>
            <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-4 py-5 text-center">
              <a
                href={SKLAND_BOOKMARKLET}
                draggable
                title="森空岛凭据助手"
                onClick={(event) => {
                  event.preventDefault()
                  setSklandLogin((current) => ({
                    ...current,
                    message: '不要直接点击。请按住这个按钮，拖到浏览器顶部的书签栏后松开。',
                  }))
                }}
                onDragStart={() => {
                  setSklandLogin((current) => ({
                    ...current,
                    message: '拖到浏览器书签栏后松开即可安装。',
                  }))
                }}
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand-600 px-6 text-base font-bold text-white shadow-sm hover:bg-brand-500"
              >
                森空岛凭据助手
              </a>
              <p className="mt-3 text-xs text-ink-muted">如果浏览器禁止拖拽书签，可复制下面脚本手动新建书签。</p>
            </div>
            <textarea readOnly value={SKLAND_BOOKMARKLET} rows={4} className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-xs text-ink-secondary outline-none" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void navigator.clipboard?.writeText(SKLAND_BOOKMARKLET)} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
                复制书签脚本
              </button>
              <button type="button" onClick={() => window.open('https://www.skland.com/index', '_blank', 'noopener,noreferrer')} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
                打开森空岛
              </button>
            </div>
            <textarea ref={credentialInputRef} rows={4} className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-sm text-ink-primary outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" placeholder="粘贴书签脚本复制出的凭据" />
            <button type="button" onClick={() => void handlePreviewSklandCredential('bookmarklet')} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
              读取账号信息
            </button>
          </div>
        )}

        {sklandLogin.mode === 'password' && (
          <div className="mt-5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-6 text-warning">
            推荐使用扫码登录，无法扫码时可更换其他方式。
          </div>
        )}

        <div className="mt-5 flex min-h-[260px] items-center justify-center rounded-lg border border-surface-3 bg-surface-0 p-4">
          {sklandLogin.mode === 'scan' && sklandLogin.qrDataUrl && sklandLogin.status === 'waiting' ? (
            <img src={sklandLogin.qrDataUrl} alt="森空岛扫码登录二维码" className="h-[240px] w-[240px] rounded-lg bg-white p-2" />
          ) : (sklandLogin.status === 'confirm_required' || sklandLogin.status === 'account_mismatch') && sklandLogin.preview ? (
            <div className="w-full space-y-3 text-sm">
              <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">待确认账号</p>
                <p className="mt-2 text-lg font-semibold text-ink-primary">{sklandLogin.preview.nickname}</p>
                <p className="mt-1 text-ink-secondary">UID {sklandLogin.preview.uid} · {sklandLogin.preview.channel_name}</p>
                <p className="mt-1 text-ink-secondary">可读取 {sklandLogin.preview.operator_count} 名干员信息</p>
              </div>
              {sklandLogin.status === 'confirm_required' ? (
                <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-warning">绑定后不可解绑，请确认账号无误。</p>
              ) : (
                <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-error">该账号与当前绑定账号不一致，请重新选择正确账号。</p>
              )}
            </div>
          ) : (
            <div className="space-y-3 text-center text-sm text-ink-secondary">
              <p>{sklandLogin.message || '请选择一种森空岛登录方式。'}</p>
              {sklandLogin.mode === 'scan' && sklandLogin.status !== 'waiting' && (
                <button type="button" onClick={handleStartSklandLogin} disabled={busy || !profile} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                  生成扫码二维码
                </button>
              )}
            </div>
          )}
        </div>

        {sklandLogin.message && sklandLogin.status !== 'confirm_required' && (
          <p className={'mt-3 text-sm ' + (sklandLogin.status === 'error' || sklandLogin.status === 'account_mismatch' || sklandLogin.status === 'frozen' ? 'text-error' : 'text-ink-secondary')}>{sklandLogin.message}</p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {(sklandLogin.status === 'error' || sklandLogin.status === 'account_mismatch') && sklandLogin.mode === 'scan' && (
            <button type="button" onClick={handleStartSklandLogin} disabled={busy || !profile} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
              重新生成
            </button>
          )}
          {sklandLogin.status === 'confirm_required' && (
            <button type="button" onClick={handleConfirmSklandLogin} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
              {isDepot ? '确认绑定并分析仓库' : '确认绑定并导入'}
            </button>
          )}
          {sklandLogin.status === 'waiting' && sklandLogin.scanId && (
            <button type="button" onClick={() => void completeSklandLogin(sklandLogin.scanId!)} disabled={busy} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3 disabled:text-ink-muted">
              立即检查
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function StepBox({ index, label }: { index: string; label: string }) {
  return (
    <div className="rounded-lg border border-surface-3 bg-surface-1 px-3 py-2">
      <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">{index}</span>
      <span>{label}</span>
    </div>
  )
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
