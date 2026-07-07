import type { RefObject } from 'react'
import type { UserGameAccount } from '../lib/types'
import { useSklandBinding, type SklandImportMode, type SklandLoginState, type SklandPayload, type SklandPreview } from '../hooks/useSklandBinding'

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
    confirmSklandLogin,
    close,
    selectMode,
    setMessage,
  } = useSklandBinding({ open, profile, context, claimProfileMeta, autoStart, onOpenChange, onPayload, onCompleted })

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6">
      <section className="max-h-[calc(100vh-3rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-surface-3 bg-surface-1 p-5 shadow-2xl" aria-labelledby="skland-binding-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="skland-binding-title" className="text-lg font-semibold text-ink-primary">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">{description}</p>
          </div>
          <button type="button" onClick={close} className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3">
            关闭
          </button>
        </div>

        <ol className="mt-5 grid gap-2 text-xs font-semibold text-ink-secondary sm:grid-cols-3">
          {['获取凭据', '预览账号', '确认保存'].map((label, index) => (
            <li key={label} className={'rounded-lg border px-3 py-2 ' + (currentStep === index + 1 ? 'border-brand-500 bg-brand-500/10 text-brand-500' : 'border-surface-3 bg-surface-0')}>
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {(Object.keys(MODE_LABELS) as SklandImportMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => selectMode(mode)}
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

        {sklandLogin.preview && (
          <PreviewPanel
            preview={sklandLogin.preview}
            status={sklandLogin.status}
            isDepot={isDepot}
          />
        )}

        {sklandLogin.message && (
          <p
            className={'mt-4 rounded-lg border px-3 py-2 text-sm leading-6 ' + (hasError ? 'border-error/30 bg-error/10 text-error' : 'border-surface-3 bg-surface-0 text-ink-secondary')}
            role={hasError ? 'alert' : 'status'}
          >
            {sklandLogin.message}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {hasError && sklandLogin.mode === 'scan' && (
            <button type="button" onClick={startSklandLogin} disabled={busy || (!profile && !canStartWithoutProfile)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
              重新生成二维码
            </button>
          )}
          {hasError && (
            <button type="button" onClick={() => selectMode('manual')} disabled={busy} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:text-ink-muted">
              改用粘贴凭据
            </button>
          )}
          {sklandLogin.status === 'waiting' && sklandLogin.scanId && (
            <button type="button" onClick={() => void completeSklandLogin(sklandLogin.scanId!)} disabled={busy} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:text-ink-muted">
              立即检查授权
            </button>
          )}
          {sklandLogin.status === 'confirm_required' && (
            <button type="button" onClick={confirmSklandLogin} disabled={confirmDisabled} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
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
    <section className="rounded-lg border border-surface-3 bg-surface-0 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-primary">扫码授权</h3>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">使用森空岛 App 扫码授权。授权后只会进入账号预览，需要再次确认才保存。</p>
        </div>
        <button type="button" onClick={onStart} disabled={busy || (!profile && !canStartWithoutProfile)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
          {waiting ? '重新生成二维码' : '生成扫码二维码'}
        </button>
      </div>
      {waiting && state.qrDataUrl && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-surface-3 bg-surface-1 p-4">
          <img src={state.qrDataUrl} alt="森空岛扫码授权二维码" className="h-[240px] w-[240px] rounded-lg bg-white p-2" />
          <button type="button" onClick={onCheck} disabled={busy} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:text-ink-muted">
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
    <section className="space-y-3 rounded-lg border border-surface-3 bg-surface-0 p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">粘贴凭据</h3>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">在森空岛网页登录后，复制本地凭据并粘贴到这里。读取后会先展示昵称和 UID。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => window.open('https://www.skland.com/index', '_blank', 'noopener,noreferrer')} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">
          打开森空岛官网
        </button>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(SKLAND_CONSOLE_CODE)} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">
          复制控制台命令
        </button>
      </div>
      <label htmlFor="skland-manual-command" className="block text-xs font-semibold text-ink-muted">控制台命令</label>
      <textarea id="skland-manual-command" readOnly value={SKLAND_CONSOLE_CODE} rows={3} className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-xs text-ink-secondary outline-none" />
      <label htmlFor="skland-manual-credential" className="block text-xs font-semibold text-ink-muted">森空岛凭据</label>
      <textarea id="skland-manual-credential" ref={inputRef} rows={4} className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-sm text-ink-primary outline-none transition-colors duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" placeholder="粘贴森空岛凭据" />
      <button type="button" onClick={onPreview} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
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
    <section className="space-y-3 rounded-lg border border-surface-3 bg-surface-0 p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">书签脚本</h3>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">把助手拖到浏览器书签栏，在森空岛网页登录后点击书签复制凭据，再回到这里粘贴预览。</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <StepBox index="1" label="显示浏览器书签栏" />
        <StepBox index="2" label="拖动助手到书签栏" />
        <StepBox index="3" label="登录森空岛后点击书签" />
      </div>
      <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-4 py-5 text-center">
        <a
          href={SKLAND_BOOKMARKLET}
          draggable
          title="森空岛凭据助手"
          onClick={(event) => {
            event.preventDefault()
            onMessage('请按住这个按钮拖到浏览器书签栏，不要直接点击。')
          }}
          onDragStart={() => onMessage('拖到浏览器书签栏后松开即可安装。')}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand-600 px-6 text-base font-bold text-white shadow-sm transition-colors duration-150 hover:bg-brand-500"
        >
          森空岛凭据助手
        </a>
        <p className="mt-3 text-xs text-ink-muted">如果浏览器禁止拖拽书签，可复制脚本手动新建书签。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void navigator.clipboard?.writeText(SKLAND_BOOKMARKLET)} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">
          复制书签脚本
        </button>
        <button type="button" onClick={() => window.open('https://www.skland.com/index', '_blank', 'noopener,noreferrer')} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">
          打开森空岛
        </button>
      </div>
      <label htmlFor="skland-bookmarklet-script" className="block text-xs font-semibold text-ink-muted">书签脚本内容</label>
      <textarea id="skland-bookmarklet-script" readOnly value={SKLAND_BOOKMARKLET} rows={4} className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-xs text-ink-secondary outline-none" />
      <label htmlFor="skland-bookmarklet-credential" className="block text-xs font-semibold text-ink-muted">书签复制出的凭据</label>
      <textarea id="skland-bookmarklet-credential" ref={inputRef} rows={4} className="w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-sm text-ink-primary outline-none transition-colors duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" placeholder="粘贴书签脚本复制出的凭据" />
      <button type="button" onClick={onPreview} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
        读取账号预览
      </button>
    </section>
  )
}

function PreviewPanel({ preview, status, isDepot }: { preview: SklandPreview; status: SklandLoginState['status']; isDepot: boolean }) {
  const isMismatch = status === 'account_mismatch'
  return (
    <section className="mt-5 rounded-lg border border-surface-3 bg-surface-0 p-4">
      <p className="text-xs font-semibold text-brand-500">仅预览，尚未保存</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <InfoTile label="昵称" value={preview.nickname} />
        <InfoTile label="UID" value={preview.uid} />
        <InfoTile label="服务器" value={preview.channel_name} />
        <InfoTile label={isDepot ? '可读取库存角色' : '可读取干员'} value={`${preview.operator_count} 名`} />
      </div>
      <p className={'mt-3 rounded-lg border px-3 py-2 text-sm leading-6 ' + (isMismatch ? 'border-error/30 bg-error/10 text-error' : 'border-warning/30 bg-warning/10 text-warning')}>
        {isMismatch ? '该账号与当前绑定 UID 不一致，没有保存任何变更。请重新登录正确账号。' : '确认后才会保存森空岛绑定；请核对昵称和 UID 后继续。'}
      </p>
    </section>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-3 bg-surface-1 px-3 py-2">
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink-primary">{value}</p>
    </div>
  )
}

function StepBox({ index, label }: { index: string; label: string }) {
  return (
    <div className="rounded-lg border border-surface-3 bg-surface-1 px-3 py-2 text-sm text-ink-secondary">
      <span className="block text-xs font-semibold text-ink-muted">{index}</span>
      <span>{label}</span>
    </div>
  )
}

function stepForStatus(status: SklandLoginState['status']): 1 | 2 | 3 {
  if (status === 'confirm_required' || status === 'account_mismatch') return 2
  if (status === 'importing' || status === 'imported') return 3
  return 1
}
