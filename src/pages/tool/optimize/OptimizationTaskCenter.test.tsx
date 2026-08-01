// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OptimizationJobListItem } from '../../../lib/optimization-contracts'
import OptimizationTaskCenterDialog, { OptimizationTaskCenterButton } from './OptimizationTaskCenter'
import type { OptimizationTaskCenterController } from './useOptimizationTaskCenter'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('OptimizationTaskCenter', () => {
  it('stays out of the document flow until the toolbar button opens it', async () => {
    const user = userEvent.setup()
    render(<Harness controller={controller()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('暂时没有优化任务。')).not.toBeInTheDocument()

    const trigger = screen.getByRole('button', { name: '打开异步任务中心' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '异步任务中心' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(document.body).toHaveStyle({ overflow: 'hidden' })
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus())
  })

  it('shows active and attention badges without opening the dialog', () => {
    render(<Harness controller={controller({ activeCount: 2, attentionCount: 1 })} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开异步任务中心，2 个进行中，1 个任务需要关注' })).toHaveClass('h-11', 'py-0')
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('!')).toBeInTheDocument()
  })

  it('keeps the icon-only task trigger square with its complete status label', () => {
    const triggerRef = { current: null }
    render(
      <OptimizationTaskCenterButton
        controller={controller({ activeCount: 2, attentionCount: 1 })}
        open={false}
        onOpen={vi.fn()}
        buttonRef={triggerRef}
        iconOnly
      />,
    )

    const trigger = screen.getByRole('button', { name: '打开异步任务中心，2 个进行中，1 个任务需要关注' })
    expect(trigger).toHaveClass('h-11', 'w-11', 'px-0')
    expect(trigger).not.toHaveTextContent('任务中心')
    expect(trigger).toHaveTextContent('2!')
  })

  it('closes on Escape and restores focus to the toolbar trigger', async () => {
    const user = userEvent.setup()
    render(<Harness controller={controller()} />)
    const trigger = screen.getByRole('button', { name: '打开异步任务中心' })
    await user.click(trigger)
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus())

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(document.body.style.overflow).toBe('')
  })

  it('closes before retrying a schedule job', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<Harness controller={controller({ jobs: [failedScheduleJob()], attentionCount: 1 })} onRetry={onRetry} />)
    await user.click(screen.getByRole('button', { name: '打开异步任务中心，1 个任务需要关注' }))

    await user.click(screen.getByRole('button', { name: '按当前配置重新生成' }))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens a persisted successful schedule result from the task list', async () => {
    const user = userEvent.setup()
    const onOpenResult = vi.fn()
    render(<Harness controller={controller({ jobs: [successfulScheduleJob()] })} onOpenResult={onOpenResult} />)
    await user.click(screen.getByRole('button', { name: '打开异步任务中心' }))

    await user.click(screen.getByRole('button', { name: '查看结果' }))

    expect(onOpenResult).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

function Harness({ controller: taskController, onRetry = vi.fn(), onOpenResult = vi.fn() }: {
  controller: OptimizationTaskCenterController;
  onRetry?: () => void;
  onOpenResult?: () => void;
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }
  return (
    <>
      <OptimizationTaskCenterButton controller={taskController} open={open} onOpen={() => setOpen(true)} buttonRef={triggerRef} />
      <main>排班正文</main>
      <OptimizationTaskCenterDialog
        open={open}
        controller={taskController}
        onClose={close}
        onRetrySchedule={() => {
          close()
          onRetry()
        }}
        onOpenScenario={close}
        onOpenResult={() => {
          close()
          onOpenResult()
        }}
      />
    </>
  )
}

function controller(overrides: Partial<OptimizationTaskCenterController> = {}): OptimizationTaskCenterController {
  return {
    jobs: [],
    activeCount: 0,
    attentionCount: 0,
    loading: false,
    refreshing: false,
    loadingMore: false,
    error: null,
    notice: null,
    busyJobId: null,
    notificationsEnabled: false,
    hasMore: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    toggleNotifications: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function failedScheduleJob(): OptimizationJobListItem {
  return {
    id: 'failed-job-id',
    kind: 'schedule',
    source: 'profile',
    status: 'failed',
    priority: { kind: 'standard', label: '标准队列' },
    queuePosition: null,
    pollAfterMs: 1_500,
    timestamps: { submittedAt: '2026-07-17T00:00:00.000Z', finishedAt: '2026-07-17T00:01:00.000Z' },
    estimate: { durationMs: 60_000, bucket: 'maa_plain', source: 'fallback_p95', sampleCount: 0, remainingMs: 0, totalMs: 60_000, phase: 'failed', updatedAt: '2026-07-17T00:01:00.000Z' },
    executionPhase: 'terminal',
    calculationStage: 'generating_schedule',
    upgradeSuggestions: { requested: false, allowed: false },
    attemptCount: 1,
    failureCount: 1,
    cancellationRequested: false,
    canCancel: false,
    canRetry: true,
    resultAvailable: false,
    error: { code: 'application_error', message: '任务失败', retryable: true, recoveryAction: 'retry', attemptCount: 1, supportReference: 'OPT-12345678' },
  }
}

function successfulScheduleJob(): OptimizationJobListItem {
  return {
    ...failedScheduleJob(),
    id: 'successful-job-id',
    status: 'succeeded',
    failureCount: 0,
    canRetry: false,
    resultAvailable: true,
    historyResultId: 'successful-job-id',
  } as unknown as OptimizationJobListItem
}
