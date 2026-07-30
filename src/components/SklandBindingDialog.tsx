import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { UserGameAccount } from '../lib/types'
import { useSklandBinding, type SklandAccountOption, type SklandImportMode, type SklandLoginState, type SklandPayload, type SklandPreview } from '../hooks/useSklandBinding'
import { copy } from '../copy/index'


export type { SklandPayload } from '../hooks/useSklandBinding'

type SklandBindingDialogProps = {
  open: boolean
  profile: UserGameAccount | null
  context?: 'workspace' | 'depot' | 'free_preview_claim' | 'lifetime_voucher_use'
  claimProfileMeta?: {
    displayName?: string
    note?: string
  }
  autoStart?: boolean
  onOpenChange: (open: boolean) => void
  onPayload: (payload: SklandPayload) => void
  onCompleted?: (payload: SklandPayload) => void
}

const SKLAND_CONSOLE_CODE = copy.workspace.components_SklandBindingDialog_001
const SKLAND_BOOKMARKLET = copy.workspace.components_SklandBindingDialog_002

const MODE_LABELS: Record<SklandImportMode, string> = {
  scan: copy.workspace.components_SklandBindingDialog_003,
  manual: copy.workspace.components_SklandBindingDialog_004,
  bookmarklet: copy.workspace.components_SklandBindingDialog_005,
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
  const isLifetimeVoucherUse = context === 'lifetime_voucher_use'
  const canStartWithoutProfile = isFreePreviewClaim || isLifetimeVoucherUse
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
  const title = isFreePreviewClaim
    ? copy.workspace.components_SklandBindingDialog_006
    : isLifetimeVoucherUse ? copy.workspace.components_SklandBindingDialog_lifetime_title : copy.workspace.components_SklandBindingDialog_007
  const description = isDepot
    ? copy.workspace.components_SklandBindingDialog_008
    : isFreePreviewClaim
      ? copy.workspace.components_SklandBindingDialog_009
      : isLifetimeVoucherUse
        ? copy.workspace.components_SklandBindingDialog_lifetime_description
        : copy.workspace.components_SklandBindingDialog_010

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
          <button ref={closeButtonRef} type="button" onClick={close} className="tool-secondary-action shrink-0 px-3 py-2 text-sm" aria-label={copy.workspace.components_SklandBindingDialog_011}>
            {copy.workspace.components_SklandBindingDialog_012}</button>
        </div>

        <ol className="mt-5 grid gap-2 text-xs font-semibold text-ink-secondary sm:grid-cols-3">
          {[copy.workspace.components_SklandBindingDialog_013, copy.workspace.components_SklandBindingDialog_014, copy.workspace.components_SklandBindingDialog_015].map((label, index) => (
            <li key={label} className={'tool-inset px-3 py-2 ' + (currentStep === index + 1 ? 'border-brand-500 bg-brand-500/10 text-brand-300' : 'text-ink-secondary')}>
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        <div className="mt-5 grid grid-cols-3 gap-2" role="group" aria-label={copy.workspace.components_SklandBindingDialog_016}>
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
        <p className="mt-2 text-xs text-ink-muted">{copy.workspace.components_SklandBindingDialog_017}</p>

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
              {copy.workspace.components_SklandBindingDialog_018}</button>
          )}
          {hasError && (
            <button type="button" onClick={() => selectMode('manual')} disabled={busy} className="tool-secondary-action">
              {copy.workspace.components_SklandBindingDialog_019}</button>
          )}
          {sklandLogin.status === 'waiting' && sklandLogin.scanId && (
            <button type="button" onClick={() => void completeSklandLogin(sklandLogin.scanId!)} disabled={busy} className="tool-secondary-action">
              {copy.workspace.components_SklandBindingDialog_020}</button>
          )}
          {sklandLogin.status === 'account_selection_required' && (
            <button type="button" onClick={previewSelectedAccount} disabled={busy || !sklandLogin.selectedUid} className="tool-primary-action">
              {busy ? copy.workspace.components_SklandBindingDialog_021 : copy.workspace.components_SklandBindingDialog_022}
            </button>
          )}
          {sklandLogin.status === 'confirm_required' && (
            <button type="button" onClick={confirmSklandLogin} disabled={confirmDisabled} className="tool-primary-action">
              {isDepot ? copy.workspace.components_SklandBindingDialog_023 : copy.workspace.components_SklandBindingDialog_024}
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
          <h3 className="text-sm font-semibold text-ink-primary">{copy.workspace.components_SklandBindingDialog_025}</h3>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">{copy.workspace.components_SklandBindingDialog_026}</p>
        </div>
        <button type="button" onClick={onStart} disabled={busy || (!profile && !canStartWithoutProfile)} className="tool-primary-action">
          {waiting ? copy.workspace.components_SklandBindingDialog_027 : copy.workspace.components_SklandBindingDialog_028}
        </button>
      </div>
      {waiting && state.qrDataUrl && (
        <div className="tool-inset mt-4 flex flex-col items-center gap-3 p-4">
          <img src={state.qrDataUrl} alt={copy.workspace.components_SklandBindingDialog_029} className="h-[240px] w-[240px] rounded-lg bg-white p-2" />
          <button type="button" onClick={onCheck} disabled={busy} className="tool-secondary-action">
            {copy.workspace.components_SklandBindingDialog_030}</button>
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
  inputRef: RefObject<HTMLTextAreaElement | null>
  onPreview: () => void
}) {
  return (
    <section className="tool-inset space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">{copy.workspace.components_SklandBindingDialog_031}</h3>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">{copy.workspace.components_SklandBindingDialog_032}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => window.open('https://www.skland.com/index', '_blank', 'noopener,noreferrer')} className="tool-secondary-action">
          {copy.workspace.components_SklandBindingDialog_033}</button>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(SKLAND_CONSOLE_CODE)} className="tool-secondary-action">
          {copy.workspace.components_SklandBindingDialog_034}</button>
      </div>
      <details className="tool-inset group overflow-hidden" open>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-3 py-2 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/55 [&::-webkit-details-marker]:hidden">
          <span>{copy.workspace.components_SklandBindingDialog_066}</span>
          <span className="text-lg leading-none text-brand-300 transition-transform duration-150 group-open:rotate-45" aria-hidden="true">+</span>
        </summary>
        <div className="space-y-3 border-t border-surface-3/60 px-3 py-3">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-secondary">
            <li>{copy.workspace.components_SklandBindingDialog_067}</li>
            <li>{copy.workspace.components_SklandBindingDialog_068}</li>
            <li>{copy.workspace.components_SklandBindingDialog_069}</li>
          </ol>
          <p className="tool-alert tool-alert--warning text-xs leading-5" role="note">
            {copy.workspace.components_SklandBindingDialog_070}
          </p>
        </div>
      </details>
      <label htmlFor="skland-manual-command" className="block text-xs font-semibold text-ink-muted">{copy.workspace.components_SklandBindingDialog_035}</label>
      <textarea id="skland-manual-command" readOnly value={SKLAND_CONSOLE_CODE} rows={3} className="tool-field resize-y font-mono text-xs text-ink-secondary" />
      <label htmlFor="skland-manual-credential" className="block text-xs font-semibold text-ink-muted">{copy.workspace.components_SklandBindingDialog_036}</label>
      <textarea id="skland-manual-credential" ref={inputRef} rows={4} className="tool-field resize-y font-mono text-sm" placeholder={copy.workspace.components_SklandBindingDialog_037} />
      <button type="button" onClick={onPreview} disabled={busy} className="tool-primary-action">
        {copy.workspace.components_SklandBindingDialog_038}</button>
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
  inputRef: RefObject<HTMLTextAreaElement | null>
  onPreview: () => void
  onMessage: (message: string) => void
}) {
  return (
    <section className="tool-inset space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">{copy.workspace.components_SklandBindingDialog_039}</h3>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">{copy.workspace.components_SklandBindingDialog_040}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <StepBox index="1" label={copy.workspace.components_SklandBindingDialog_041} />
        <StepBox index="2" label={copy.workspace.components_SklandBindingDialog_042} />
        <StepBox index="3" label={copy.workspace.components_SklandBindingDialog_043} />
      </div>
      <div className="tool-inset border-brand-500/30 bg-brand-500/10 px-4 py-5 text-center">
        <a
          href={SKLAND_BOOKMARKLET}
          draggable
          title={copy.workspace.components_SklandBindingDialog_044}
          onClick={(event) => {
            event.preventDefault()
            onMessage(copy.workspace.components_SklandBindingDialog_045)
          }}
          onDragStart={() => onMessage(copy.workspace.components_SklandBindingDialog_046)}
          className="tool-secondary-action px-6 text-base"
        >
          {copy.workspace.components_SklandBindingDialog_047}</a>
        <p className="mt-3 text-xs text-ink-muted">{copy.workspace.components_SklandBindingDialog_048}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void navigator.clipboard?.writeText(SKLAND_BOOKMARKLET)} className="tool-secondary-action">
          {copy.workspace.components_SklandBindingDialog_049}</button>
        <button type="button" onClick={() => window.open('https://www.skland.com/index', '_blank', 'noopener,noreferrer')} className="tool-secondary-action">
          {copy.workspace.components_SklandBindingDialog_050}</button>
      </div>
      <label htmlFor="skland-bookmarklet-script" className="block text-xs font-semibold text-ink-muted">{copy.workspace.components_SklandBindingDialog_051}</label>
      <textarea id="skland-bookmarklet-script" readOnly value={SKLAND_BOOKMARKLET} rows={4} className="tool-field resize-y font-mono text-xs text-ink-secondary" />
      <label htmlFor="skland-bookmarklet-credential" className="block text-xs font-semibold text-ink-muted">{copy.workspace.components_SklandBindingDialog_052}</label>
      <textarea id="skland-bookmarklet-credential" ref={inputRef} rows={4} className="tool-field resize-y font-mono text-sm" placeholder={copy.workspace.components_SklandBindingDialog_053} />
      <button type="button" onClick={onPreview} disabled={busy} className="tool-primary-action">
        {copy.workspace.components_SklandBindingDialog_054}</button>
    </section>
  )
}

function PreviewPanel({ preview, status, isDepot }: { preview: SklandPreview; status: SklandLoginState['status']; isDepot: boolean }) {
  const isMismatch = status === 'account_mismatch'
  return (
    <section className="tool-inset mt-5 p-4">
      <p className="tool-status tool-status--current">{copy.workspace.components_SklandBindingDialog_055}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <InfoTile label={copy.workspace.components_SklandBindingDialog_056} value={preview.nickname} />
        <InfoTile label="UID" value={preview.uid} />
        <InfoTile label={copy.workspace.components_SklandBindingDialog_057} value={preview.channel_name} />
        <InfoTile label={isDepot ? copy.workspace.components_SklandBindingDialog_058 : copy.workspace.components_SklandBindingDialog_059} value={`${preview.operator_count}${copy.workspace.components_SklandBindingDialog_060}`} />
      </div>
      <p className={'tool-alert mt-3 ' + (isMismatch ? 'tool-alert--error' : 'tool-alert--warning')} role={isMismatch ? 'alert' : 'status'}>
        {isMismatch ? copy.workspace.components_SklandBindingDialog_061 : copy.workspace.components_SklandBindingDialog_062}
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
  firstAccountRef: RefObject<HTMLInputElement | null>
  onSelect: (uid: string) => void
}) {
  return (
    <fieldset className="tool-inset mt-5 p-4">
      <legend className="px-1 text-sm font-semibold text-ink-primary">{copy.workspace.components_SklandBindingDialog_063}</legend>
      <p className="mt-1 text-xs leading-5 text-ink-muted">{copy.workspace.components_SklandBindingDialog_064}</p>
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
                    <span className="rounded-full border border-brand-500/50 bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-300">{copy.workspace.components_SklandBindingDialog_065}</span>
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
