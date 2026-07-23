import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { OptimizationJobListItem } from '../../../lib/optimization-contracts'
import { copy, CURRENT_LOCALE } from '../../../copy/index'
import type { OptimizationTaskCenterController } from './useOptimizationTaskCenter'

export function OptimizationTaskCenterButton({
  controller,
  open,
  onOpen,
  buttonRef,
}: {
  controller: OptimizationTaskCenterController;
  open: boolean;
  onOpen: () => void;
  buttonRef: RefObject<HTMLButtonElement>;
}) {
  const { activeCount, attentionCount } = controller
  const ariaLabel = [
    copy.optimize.pages_tool_optimize_OptimizationTaskCenter_033,
    activeCount > 0 ? `${activeCount} ${copy.optimize.pages_tool_optimize_OptimizationTaskCenter_030}` : '',
    attentionCount > 0 ? `${attentionCount} ${copy.optimize.pages_tool_optimize_OptimizationTaskCenter_035}` : '',
  ].filter(Boolean).join('，')

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="optimization-task-center-dialog"
      aria-label={ariaLabel}
      className="tool-secondary-action inline-flex h-11 items-center gap-2 py-0"
    >
      <span>{copy.optimize.pages_tool_optimize_OptimizationTaskCenter_032}</span>
      {activeCount > 0 && <span className="tool-status tool-status--current px-1.5 py-0.5 text-[11px]">{activeCount}</span>}
      {attentionCount > 0 && <span className="tool-status tool-status--error px-1.5 py-0.5 text-[11px]">!</span>}
    </button>
  )
}

export default function OptimizationTaskCenterDialog({
  open,
  controller,
  onClose,
  onRetrySchedule,
  onOpenScenario,
  retryEnabled = true,
}: {
  open: boolean;
  controller: OptimizationTaskCenterController;
  onClose: () => void;
  onRetrySchedule: () => void;
  onOpenScenario: () => void;
  retryEnabled?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const { jobs, activeCount, attentionCount, loading, loadingMore, error, notice, busyJobId, notificationsEnabled } = controller

  useEffect(() => {
    if (!open) return
    void controller.refresh()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
    }
  }, [controller.refresh, open])

  if (!open) return null

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        id="optimization-task-center-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="optimization-task-center-title"
        aria-describedby="optimization-task-center-description"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="tool-panel max-h-[calc(100vh-3rem)] w-full max-w-3xl overflow-y-auto p-5 shadow-2xl sm:p-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="optimization-task-center-title" className="text-lg font-semibold text-ink-primary">
                {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_001}
              </h2>
              {activeCount > 0 && <span className="tool-status tool-status--current">{activeCount} {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_030}</span>}
              {attentionCount > 0 && <span className="tool-status tool-status--error">{attentionCount} {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_035}</span>}
            </div>
            <p id="optimization-task-center-description" className="mt-1 text-sm leading-6 text-ink-secondary">
              {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_002}
            </p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="tool-secondary-action shrink-0" aria-label={copy.optimize.pages_tool_optimize_OptimizationTaskCenter_034}>
            {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_034}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-surface-3 pt-4">
          <button type="button" onClick={() => void controller.toggleNotifications()} className="tool-secondary-action">
            {notificationsEnabled ? copy.optimize.pages_tool_optimize_OptimizationTaskCenter_007 : copy.optimize.pages_tool_optimize_OptimizationTaskCenter_006}
          </button>
          <button type="button" onClick={() => void controller.refresh()} disabled={loading} className="tool-secondary-action">
            {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_003}
          </button>
        </div>

        {notice && <p className="tool-alert tool-alert--warning mt-3" role="status">{notice}</p>}
        {error && <p className="tool-alert tool-alert--error mt-3" role="alert">{error}</p>}
        {loading && jobs.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted" role="status">{copy.optimize.pages_tool_optimize_OptimizationTaskCenter_004}</p>
        ) : jobs.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">{copy.optimize.pages_tool_optimize_OptimizationTaskCenter_005}</p>
        ) : (
          <div className="mt-4 space-y-2">
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                busy={busyJobId === job.id}
                onCancel={() => void controller.cancel(job)}
                onRetrySchedule={onRetrySchedule}
                onOpenScenario={onOpenScenario}
                retryEnabled={retryEnabled}
              />
            ))}
          </div>
        )}
        {controller.hasMore && (
          <button type="button" disabled={loadingMore} onClick={() => void controller.loadMore()} className="tool-secondary-action mt-4 w-full">
            {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_024}
          </button>
        )}
      </section>
    </div>
  )
}

function JobRow({ job, busy, onCancel, onRetrySchedule, onOpenScenario, retryEnabled }: {
  job: OptimizationJobListItem;
  busy: boolean;
  onCancel: () => void;
  onRetrySchedule: () => void;
  onOpenScenario: () => void;
  retryEnabled: boolean;
}) {
  const terminalFailure = job.status === 'failed' || job.status === 'cancelled' || job.status === 'dead_lettered'
  return (
    <article className="tool-inset p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={statusClass(job.status)}>{statusLabel(job)}</span>
            <span className="tool-status">{kindLabel(job.kind)}</span>
            <span className="tool-status font-mono">{job.id.slice(0, 8)}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-ink-muted">
            {new Date(job.timestamps.submittedAt).toLocaleString(CURRENT_LOCALE)} · {job.attemptCount} {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_025}
            {typeof job.queuePosition === 'number' ? ` · ${copy.optimize.pages_tool_optimize_OptimizationTaskCenter_026} ${job.queuePosition}` : ''}
          </p>
          {terminalFailure && <div className="mt-2 text-sm leading-6 text-ink-secondary">
            <p>{job.error.message}</p>
            <p className="mt-1 text-xs text-ink-muted">{copy.optimize.pages_tool_optimize_OptimizationTaskCenter_027}：{job.error.supportReference}</p>
          </div>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {job.canCancel && <button type="button" disabled={busy} onClick={onCancel} className="tool-secondary-action">{copy.optimize.pages_tool_optimize_OptimizationTaskCenter_020}</button>}
          {retryEnabled && job.canRetry && job.kind === 'schedule' && <button type="button" onClick={onRetrySchedule} className="tool-primary-action">{copy.optimize.pages_tool_optimize_OptimizationTaskCenter_022}</button>}
          {retryEnabled && job.canRetry && job.kind === 'scenario_comparison' && <button type="button" onClick={onOpenScenario} className="tool-primary-action">{copy.optimize.pages_tool_optimize_OptimizationTaskCenter_023}</button>}
        </div>
      </div>
    </article>
  )
}

function statusLabel(job: OptimizationJobListItem): string {
  if (job.status === 'queued') return job.executionPhase === 'retry_wait' ? copy.optimize.pages_tool_optimize_OptimizationTaskCenter_010 : copy.optimize.pages_tool_optimize_OptimizationTaskCenter_009
  if (job.status === 'running') return job.cancellationRequested ? copy.optimize.pages_tool_optimize_OptimizationTaskCenter_012 : copy.optimize.pages_tool_optimize_OptimizationTaskCenter_011
  if (job.status === 'succeeded') return copy.optimize.pages_tool_optimize_OptimizationTaskCenter_013
  if (job.status === 'cancelled') return copy.optimize.pages_tool_optimize_OptimizationTaskCenter_015
  if (job.status === 'dead_lettered') return copy.optimize.pages_tool_optimize_OptimizationTaskCenter_016
  return copy.optimize.pages_tool_optimize_OptimizationTaskCenter_014
}

function statusClass(status: OptimizationJobListItem['status']): string {
  if (status === 'succeeded') return 'tool-status tool-status--success'
  if (status === 'failed' || status === 'dead_lettered') return 'tool-status tool-status--error'
  if (status === 'cancelled') return 'tool-status'
  return 'tool-status tool-status--current'
}

function kindLabel(kind: OptimizationJobListItem['kind']): string {
  if (kind === 'scenario_comparison') return copy.optimize.pages_tool_optimize_OptimizationTaskCenter_019
  if (kind === 'reorder_check') return copy.optimize.pages_tool_optimize_OptimizationTaskCenter_036
  return copy.optimize.pages_tool_optimize_OptimizationTaskCenter_017
}
