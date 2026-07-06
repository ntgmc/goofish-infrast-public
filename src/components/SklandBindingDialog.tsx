import type { UserGameAccount } from '../lib/types'
import { useSklandBinding, type SklandPayload } from '../hooks/useSklandBinding'

export type { SklandPayload } from '../hooks/useSklandBinding'

type SklandBindingDialogProps = {
  open: boolean
  profile: UserGameAccount | null
  context?: 'workspace' | 'depot'
  autoStart?: boolean
  onOpenChange: (open: boolean) => void
  onPayload: (payload: SklandPayload) => void
  onCompleted?: (payload: SklandPayload) => void
}

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
  const isDepot = context === 'depot'
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
  } = useSklandBinding({ open, profile, context, autoStart, onOpenChange, onPayload, onCompleted })

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
            <button type="button" onClick={close} className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink-secondary hover:bg-surface-3">
              关闭
            </button>
          </div>
  
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['scan', 'manual', 'bookmarklet', 'password'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => selectMode(mode)}
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
              <button type="button" onClick={() => void previewCredential('manual')} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
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
                    setMessage('不要直接点击。请按住这个按钮，拖到浏览器顶部的书签栏后松开。')
                  }}
                  onDragStart={() => {
                    setMessage('拖到浏览器书签栏后松开即可安装。')
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
              <button type="button" onClick={() => void previewCredential('bookmarklet')} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
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
                  <button type="button" onClick={startSklandLogin} disabled={busy || !profile} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
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
              <button type="button" onClick={startSklandLogin} disabled={busy || !profile} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                重新生成
              </button>
            )}
            {sklandLogin.status === 'confirm_required' && (
              <button type="button" onClick={confirmSklandLogin} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
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
