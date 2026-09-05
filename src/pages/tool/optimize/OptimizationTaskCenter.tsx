import { ListTodo } from 'lucide-react'
import { useEffect, useRef, type RefObject } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog'
import type { OptimizationJobListItem } from '../../../lib/optimization-contracts'
import { copy, CURRENT_LOCALE } from '../../../copy/index'
import type { OptimizationTaskCenterController } from './useOptimizationTaskCenter'

export function OptimizationTaskCenterButton({
  controller,
  open,
  onOpen,
  buttonRef,
  iconOnly = false,
}: {
  controller: OptimizationTaskCenterController;
  open: boolean;
  onOpen: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  iconOnly?: boolean;
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
      className={`tool-secondary-action relative inline-flex h-11 items-center gap-2 py-0 ${iconOnly ? 'w-11 justify-center px-0' : ''}`}
    >
      {iconOnly ? <ListTodo aria-hidden="true" className="size-5" /> : <span>{copy.optimize.pages_tool_optimize_OptimizationTaskCenter_032}</span>}
      {activeCount > 0 && <span className={`tool-status tool-status--current px-1.5 py-0.5 text-[11px] ${iconOnly ? 'absolute -right-1 -top-1 min-w-5 justify-center' : ''}`}>{activeCount}</span>}
      {attentionCount > 0 && <span className={`tool-status tool-status--error px-1.5 py-0.5 text-[11px] ${iconOnly ? 'absolute -bottom-1 -right-1 min-w-5 justify-center' : ''}`}>!</span>}
    </button>
  )
}

export default function OptimizationTaskCenterDialog({
  open,
  controller,
  onClose,
  onRetrySchedule,
  onOpenScenario,
  onOpenResult = () => undefined,
  retryEnabled = true,
}: {
  open: boolean;
  controller: OptimizationTaskCenterController;
  onClose: () => void;
  onRetrySchedule: () => void;
  onOpenScenario: (job: OptimizationJobListItem) => void;
  onOpenResult?: (job: OptimizationJobListItem) => void;
  retryEnabled?: boolean;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const { jobs, activeCount, attentionCount, loading, refreshing, loadingMore, error, notice, busyJobId, notificationsEnabled } = controller

  useEffect(() => {
    if (!open) return
    void controller.refresh()
  }, [controller.refresh, open])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent
        id="optimization-task-center-dialog"
        aria-labelledby="optimization-task-center-title"
        aria-describedby="optimization-task-center-description"
        className="block max-w-3xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          closeButtonRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle id="optimization-task-center-title" className="text-ink-primary">
                {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_001}
              </DialogTitle>
              {activeCount > 0 && <span className="tool-status tool-status--current">{activeCount} {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_030}</span>}
              {attentionCount > 0 && <span className="tool-status tool-status--error">{attentionCount} {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_035}</span>}
            </div>
            <DialogDescription id="optimization-task-center-description" className="mt-1">
              {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_002}
            </DialogDescription>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="tool-secondary-action shrink-0" aria-label={copy.optimize.pages_tool_optimize_OptimizationTaskCenter_034}>
            {copy.optimize.pages_tool_optimize_OptimizationTaskCenter_034}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-surface-3 pt-4">
          <button type="button" onClick={() => void controller.toggleNotifications()} className="tool-secondary-action">
            {notificationsEnabled ? copy.optimize.pages_tool_optimize_OptimizationTaskCenter_007 : copy.optimize.pages_tool_optimize_OptimizationTaskCenter_006}
          </button>
          <button type="button" onClick={() => void controller.refresh()} disabled={loading || refreshing} className="tool-secondary-action">
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
                onOpenScenario={() => onOpenScenario(job)}
                onOpenResult={() => onOpenResult(job)}
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
      </DialogContent>
    </Dialog>
  )
}

function JobRow({ job, busy, onCancel, onRetrySchedule, onOpenScenario, onOpenResult, retryEnabled }: {
  job: OptimizationJobListItem;
  busy: boolean;
  onCancel: () => void;
  onRetrySchedule: () => void;
  onOpenScenario: () => void;
  onOpenResult: () => void;
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
          {job.status === 'succeeded' && job.resultAvailable && (job.kind !== 'schedule' || job.historyResultId) && (
            <button type="button" onClick={onOpenResult} className="tool-primary-action">{copy.optimize.pages_tool_optimize_OptimizationTaskCenter_037}</button>
          )}
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
  return copy.optimize.pages_tool_optimize_OptimizationTaskCenter_017
}
