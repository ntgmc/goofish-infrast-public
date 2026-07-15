import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { UserGameAccount } from '../lib/types'
import { useSklandBinding, type SklandAccountOption, type SklandImportMode, type SklandLoginState, type SklandPayload, type SklandPreview } from '../hooks/useSklandBinding'

export type { SklandPayload } from '../hooks/useSklandBinding'

type SklandBindingDialogProps = {
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

const SKLAND_CONSOLE_CODE = `(()=>{const raw=localStorage.getItem('SK_OAUTH_CRED_KEY');let cred=raw;try{const data=JSON.parse(raw||'null');cred=data?.cred||data?.value||raw;}catch{}copy(encodeURIComponent(cred||''));console.log(cred?'已复制到粘贴板':'未找到森空岛凭据');})()`
const SKLAND_BOOKMARKLET = `javascript:(()=>{const raw=localStorage.getItem("SK_OAUTH_CRED_KEY");if(!raw){alert("未找到森空岛凭据，请先登录森空岛网页。");return;}let cred=raw;try{const data=JSON.parse(raw);cred=data.cred||data.value||raw;}catch{}const text=encodeURIComponent(cred);const done=()=>alert("森空岛凭据已复制，请回到工具页粘贴。");navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(text).then(done).catch(()=>prompt("复制下面的森空岛凭据",text)):prompt("复制下面的森空岛凭据",text);})()`

const MODE_LABELS: Record<SklandImportMode, string> = {
  scan: '扫码授权',
  manual: '粘贴凭据',
  bookmarklet: '书签脚本',
}

export default function SklandBindingDialog({
  open,
  profile,
  context = 'workspace',
  claimProfileMeta,
  autoStart = false,
  onOpenChange,
  onPayload,
  onCompleted,
}: SklandBindingDialogProps) {
  const isDepot = context === 'depot'
  const isFreePreviewClaim = context === 'free_preview_claim'
  const canStartWithoutProfile = isFreePreviewClaim
  const {
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
  } = useSklandBinding({ open, profile, context, claimProfileMeta, autoStart, onOpenChange, onPayload, onCompleted })
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const firstAccountRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)

    return () => {
      window.clearTimeout(focusTimer)
      if (previousActiveElement?.isConnected) previousActiveElement.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open || sklandLogin.status !== 'account_selection_required') return
    const focusTimer = window.setTimeout(() => firstAccountRef.current?.focus(), 0)
    return () => window.clearTimeout(focusTimer)
  }, [open, sklandLogin.status])

  if (!open) return null

  const currentStep = stepForStatus(sklandLogin.status)
  const hasError = sklandLogin.status === 'error' || sklandLogin.status === 'account_mismatch' || sklandLogin.status === 'frozen'
  const confirmDisabled = busy || sklandLogin.status !== 'confirm_required' || !sklandLogin.confirmationId
  const title = isFreePreviewClaim ? '领取免费个人排班' : '森空岛导入'
  const description = isDepot
    ? '先预览游戏昵称和 UID，确认后才会保存绑定并分析仓库。'
    : isFreePreviewClaim
      ? '先确认游戏 UID，确认后才会创建免费档案并导入干员。'
      : '先预览游戏昵称和 UID，确认后才会保存绑定并导入干员。'

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (!focusable || focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skland-binding-title"
        aria-describedby="skland-binding-description"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="tool-panel max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="skland-binding-title" className="text-lg font-semibold text-ink-primary">{title}</h2>
            <p id="skland-binding-description" className="mt-1 text-sm leading-6 text-ink-secondary">{description}</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={close} className="tool-secondary-action shrink-0 px-3 py-2 text-sm" aria-label="关闭森空岛导入">
            关闭
          </button>
        </div>

        <ol className="mt-5 grid gap-2 text-xs font-semibold text-ink-secondary sm:grid-cols-3">
          {['获取凭据', '预览账号', '确认保存'].map((label, index) => (
            <li key={label} className={'tool-inset px-3 py-2 ' + (currentStep === index + 1 ? 'border-brand-500 bg-brand-500/10 text-brand-300' : 'text-ink-secondary')}>
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        <div className="mt-5 grid grid-cols-3 gap-2" role="group" aria-label="森空岛导入方式">
          {(Object.keys(MODE_LABELS) as SklandImportMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => selectMode(mode)}
              aria-pressed={sklandLogin.mode === mode}
              className={'min-h-11 rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 ' + (sklandLogin.mode === mode ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary')}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">推荐使用扫码授权；无法扫码时，可粘贴凭据或使用书签脚本辅助复制。</p>

        <div className="mt-5">
          {sklandLogin.mode === 'scan' && (
            <ScanModePanel
              busy={busy}
              profile={profile}
              canStartWithoutProfile={canStartWithoutProfile}
              state={sklandLogin}
              onStart={startSklandLogin}
              onCheck={() => {
                if (sklandLogin.scanId) void completeSklandLogin(sklandLogin.scanId)
              }}
            />
          )}
          {sklandLogin.mode === 'manual' && (
            <ManualModePanel
              busy={busy}
              inputRef={credentialInputRef}
              onPreview={() => void previewCredential('manual')}
            />
          )}
          {sklandLogin.mode === 'bookmarklet' && (
            <BookmarkletModePanel
              busy={busy}
              inputRef={credentialInputRef}
              onPreview={() => void previewCredential('bookmarklet')}
              onMessage={setMessage}
            />
          )}
        </div>

        {sklandLogin.status === 'account_selection_required' && sklandLogin.accountOptions.length > 0 && (
          <AccountSelectionPanel
            accounts={sklandLogin.accountOptions}
            selectedUid={sklandLogin.selectedUid}
            firstAccountRef={firstAccountRef}
            onSelect={selectAccount}
          />
        )}

        {sklandLogin.preview && (
          <PreviewPanel
            preview={sklandLogin.preview}
            status={sklandLogin.status}
            isDepot={isDepot}
          />
        )}

        {sklandLogin.message && (
          <p
            className={'tool-alert mt-4 ' + (hasError ? 'tool-alert--error' : '')}
            role={hasError ? 'alert' : 'status'}
            aria-live={hasError ? 'assertive' : 'polite'}
          >
            {sklandLogin.message}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {hasError && sklandLogin.mode === 'scan' && (
            <button type="button" onClick={startSklandLogin} disabled={busy || (!profile && !canStartWithoutProfile)} className="tool-primary-action">
              重新生成二维码
            </button>
          )}
          {hasError && (
            <button type="button" onClick={() => selectMode('manual')} disabled={busy} className="tool-secondary-action">
              改用粘贴凭据
            </button>
          )}
          {sklandLogin.status === 'waiting' && sklandLogin.scanId && (
            <button type="button" onClick={() => void completeSklandLogin(sklandLogin.scanId!)} disabled={busy} className="tool-secondary-action">
              立即检查授权
            </button>
          )}
          {sklandLogin.status === 'account_selection_required' && (
            <button type="button" onClick={previewSelectedAccount} disabled={busy || !sklandLogin.selectedUid} className="tool-primary-action">
              {busy ? '正在读取所选账号' : '读取所选账号'}
            </button>
          )}
          {sklandLogin.status === 'confirm_required' && (
            <button type="button" onClick={confirmSklandLogin} disabled={confirmDisabled} className="tool-primary-action">
              {isDepot ? '确认保存并分析仓库' : '确认保存并导入'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function ScanModePanel({
  busy,
  profile,
  canStartWithoutProfile,
  state,
  onStart,
  onCheck,
}: {
  busy: boolean
  profile: UserGameAccount | null
  canStartWithoutProfile: boolean
  state: SklandLoginState
  onStart: () => void
  onCheck: () => void
}) {
  const waiting = state.status === 'waiting' && Boolean(state.scanId && state.qrDataUrl)
  return (
    <section className="tool-inset p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-primary">扫码授权</h3>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">使用森空岛 App 扫码授权。授权后只会进入账号预览，需要再次确认才保存。</p>
        </div>
        <button type="button" onClick={onStart} disabled={busy || (!profile && !canStartWithoutProfile)} className="tool-primary-action">
          {waiting ? '重新生成二维码' : '生成扫码二维码'}
        </button>
      </div>
      {waiting && state.qrDataUrl && (
        <div className="tool-inset mt-4 flex flex-col items-center gap-3 p-4">
          <img src={state.qrDataUrl} alt="森空岛扫码授权二维码" className="h-[240px] w-[240px] rounded-lg bg-white p-2" />
          <button type="button" onClick={onCheck} disabled={busy} className="tool-secondary-action">
            立即检查授权
          </button>
        </div>
      )}
    </section>
  )
}

function ManualModePanel({
  busy,
  inputRef,
  onPreview,
}: {
  busy: boolean
  inputRef: RefObject<HTMLTextAreaElement>
  onPreview: () => void
}) {
  return (
    <section className="tool-inset space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">粘贴凭据</h3>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">在森空岛网页登录后，复制本地凭据并粘贴到这里。读取后会先展示昵称和 UID。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => window.open('https://www.skland.com/index', '_blank', 'noopener,noreferrer')} className="tool-secondary-action">
          打开森空岛官网
        </button>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(SKLAND_CONSOLE_CODE)} className="tool-secondary-action">
          复制控制台命令
        </button>
      </div>
      <label htmlFor="skland-manual-command" className="block text-xs font-semibold text-ink-muted">控制台命令</label>
      <textarea id="skland-manual-command" readOnly value={SKLAND_CONSOLE_CODE} rows={3} className="tool-field resize-y font-mono text-xs text-ink-secondary" />
      <label htmlFor="skland-manual-credential" className="block text-xs font-semibold text-ink-muted">森空岛凭据</label>
      <textarea id="skland-manual-credential" ref={inputRef} rows={4} className="tool-field resize-y font-mono text-sm" placeholder="粘贴森空岛凭据" />
      <button type="button" onClick={onPreview} disabled={busy} className="tool-primary-action">
        读取账号预览
      </button>
    </section>
  )
}

function BookmarkletModePanel({
  busy,
  inputRef,
  onPreview,
  onMessage,
}: {
  busy: boolean
  inputRef: RefObject<HTMLTextAreaElement>
  onPreview: () => void
  onMessage: (message: string) => void
}) {
  return (
    <section className="tool-inset space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">书签脚本</h3>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">把助手拖到浏览器书签栏，在森空岛网页登录后点击书签复制凭据，再回到这里粘贴预览。</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <StepBox index="1" label="显示浏览器书签栏" />
        <StepBox index="2" label="拖动助手到书签栏" />
        <StepBox index="3" label="登录森空岛后点击书签" />
      </div>
      <div className="tool-inset border-brand-500/30 bg-brand-500/10 px-4 py-5 text-center">
        <a
          href={SKLAND_BOOKMARKLET}
          draggable
          title="森空岛凭据助手"
          onClick={(event) => {
            event.preventDefault()
            onMessage('请按住这个按钮拖到浏览器书签栏，不要直接点击。')
          }}
          onDragStart={() => onMessage('拖到浏览器书签栏后松开即可安装。')}
          className="tool-secondary-action px-6 text-base"
        >
          森空岛凭据助手
        </a>
        <p className="mt-3 text-xs text-ink-muted">如果浏览器禁止拖拽书签，可复制脚本手动新建书签。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void navigator.clipboard?.writeText(SKLAND_BOOKMARKLET)} className="tool-secondary-action">
          复制书签脚本
        </button>
        <button type="button" onClick={() => window.open('https://www.skland.com/index', '_blank', 'noopener,noreferrer')} className="tool-secondary-action">
          打开森空岛
        </button>
      </div>
      <label htmlFor="skland-bookmarklet-script" className="block text-xs font-semibold text-ink-muted">书签脚本内容</label>
      <textarea id="skland-bookmarklet-script" readOnly value={SKLAND_BOOKMARKLET} rows={4} className="tool-field resize-y font-mono text-xs text-ink-secondary" />
      <label htmlFor="skland-bookmarklet-credential" className="block text-xs font-semibold text-ink-muted">书签复制出的凭据</label>
      <textarea id="skland-bookmarklet-credential" ref={inputRef} rows={4} className="tool-field resize-y font-mono text-sm" placeholder="粘贴书签脚本复制出的凭据" />
      <button type="button" onClick={onPreview} disabled={busy} className="tool-primary-action">
        读取账号预览
      </button>
    </section>
  )
}

function PreviewPanel({ preview, status, isDepot }: { preview: SklandPreview; status: SklandLoginState['status']; isDepot: boolean }) {
  const isMismatch = status === 'account_mismatch'
  return (
    <section className="tool-inset mt-5 p-4">
      <p className="tool-status tool-status--current">仅预览，尚未保存</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <InfoTile label="昵称" value={preview.nickname} />
        <InfoTile label="UID" value={preview.uid} />
        <InfoTile label="服务器" value={preview.channel_name} />
        <InfoTile label={isDepot ? '可读取库存角色' : '可读取干员'} value={`${preview.operator_count} 名`} />
      </div>
      <p className={'tool-alert mt-3 ' + (isMismatch ? 'tool-alert--error' : 'tool-alert--warning')} role={isMismatch ? 'alert' : 'status'}>
        {isMismatch ? '该账号与当前绑定 UID 不一致，没有保存任何变更。请重新登录正确账号。' : '确认后才会保存森空岛绑定；请核对昵称和 UID 后继续。'}
      </p>
    </section>
  )
}

function AccountSelectionPanel({
  accounts,
  selectedUid,
  firstAccountRef,
  onSelect,
}: {
  accounts: SklandAccountOption[]
  selectedUid: string | null
  firstAccountRef: RefObject<HTMLInputElement>
  onSelect: (uid: string) => void
}) {
  return (
    <fieldset className="tool-inset mt-5 p-4">
      <legend className="px-1 text-sm font-semibold text-ink-primary">选择要导入的明日方舟账号</legend>
      <p className="mt-1 text-xs leading-5 text-ink-muted">每个档案只能绑定一个 UID，请主动选择并核对后继续。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {accounts.map((account, index) => {
          const selected = selectedUid === account.uid
          return (
            <label
              key={account.uid}
              className={'tool-inset flex min-h-24 cursor-pointer items-start gap-3 p-3 transition-colors duration-150 ' + (selected ? 'border-brand-500 bg-brand-500/10' : 'hover:bg-surface-3')}
            >
              <input
                ref={index === 0 ? firstAccountRef : undefined}
                type="radio"
                name="skland-account"
                value={account.uid}
                checked={selected}
                onChange={() => onSelect(account.uid)}
                className="mt-1 h-5 w-5 shrink-0 accent-brand-500 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="break-words text-sm font-semibold text-ink-primary">{account.nickname}</span>
                  {account.is_default && (
                    <span className="rounded-full border border-brand-500/50 bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-300">默认账号</span>
                  )}
                </span>
                <span className="mt-1 block break-all text-xs text-ink-secondary">UID {account.uid}</span>
                <span className="mt-1 block text-xs text-ink-muted">{account.channel_name}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tool-inset px-3 py-2">
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink-primary">{value}</p>
    </div>
  )
}

function StepBox({ index, label }: { index: string; label: string }) {
  return (
    <div className="tool-inset px-3 py-2 text-sm text-ink-secondary">
      <span className="block text-xs font-semibold text-ink-muted">{index}</span>
      <span>{label}</span>
    </div>
  )
}

function stepForStatus(status: SklandLoginState['status']): 1 | 2 | 3 {
  if (status === 'account_selection_required' || status === 'confirm_required' || status === 'account_mismatch') return 2
  if (status === 'importing' || status === 'imported') return 3
  return 1
}
