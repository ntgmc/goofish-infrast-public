import type { ReactNode } from 'react'

export function SmallActionButton({
  children,
  onClick,
  disabled = false,
  tone = 'default',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-9 items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted ${
        tone === 'danger'
          ? 'bg-error/10 text-error hover:bg-error/15'
          : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'
      }`}
    >
      {children}
    </button>
  )
}

export function LicenseSyncPanel() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-brand-600/25 bg-surface-1 p-4"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-primary">正在同步授权状态</p>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              请稍候，正在检查 CDK 状态和权限变更，同步完成后即可生成排班。
            </p>
          </div>
        </div>
        <span className="text-xs font-medium text-ink-muted sm:flex-shrink-0">通常只需几秒</span>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="schedule-progress-fill h-full w-1/2 rounded-full bg-brand-500" />
      </div>
    </div>
  )
}

export function ResultFallback() {
  return <div className="rounded-xl border border-surface-3 bg-surface-1 p-5 text-sm text-ink-secondary">正在载入...</div>
}

export function ConfigValidationToast({ message }: { message: string }) {
  return (
    <div
      className="config-validation-toast pointer-events-none fixed left-4 right-4 top-4 z-50 mx-auto max-w-xl sm:left-auto sm:right-6 sm:top-6 sm:mx-0"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-lg border border-error/30 bg-surface-1/95 px-4 py-3 shadow-[0_4px_8px_rgba(15,23,42,0.08)] backdrop-blur-sm">
        <p className="text-sm font-semibold text-error">处理失败</p>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">{message}</p>
      </div>
    </div>
  )
}

export function InlineErrorPanel({
  message,
  onRetry,
  onReset,
}: {
  message: string;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-error/40 bg-error/10 p-4">
      <p className="text-sm font-semibold text-error">处理失败</p>
      <p className="mt-1 text-sm leading-6 text-ink-secondary">{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-error px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-error/90"
        >
          重试
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3"
        >
          重新选择文件
        </button>
      </div>
    </div>
  )
}
