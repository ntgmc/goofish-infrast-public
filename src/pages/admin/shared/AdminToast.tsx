import { useEffect, useRef } from 'react'

const DEFAULT_DURATION_MS = 5000

type AdminToastProps = {
  message: string
  onDismiss: () => void
  duration?: number
}

export function AdminToast({ message, onDismiss, duration = DEFAULT_DURATION_MS }: AdminToastProps) {
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    const timeout = window.setTimeout(() => onDismissRef.current(), duration)
    return () => window.clearTimeout(timeout)
  }, [duration, message])

  return (
    <div
      className="admin-toast pointer-events-none fixed inset-x-4 top-4 z-[70] flex justify-center sm:inset-x-auto sm:right-6 sm:top-6"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="tool-alert tool-alert--success pointer-events-auto flex w-full max-w-md items-start gap-3 bg-surface-1 shadow-lg">
        <span className="mt-0.5 text-success" aria-hidden="true">✓</span>
        <p className="min-w-0 flex-1 text-sm font-medium leading-6">{message}</p>
        <button
          type="button"
          className="-mr-1 -mt-1 rounded-md px-2 py-1 text-lg leading-none text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          onClick={onDismiss}
          aria-label="关闭通知"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  )
}
