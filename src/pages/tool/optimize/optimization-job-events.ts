import type { OptimizationJobKind, OptimizationJobSnapshot } from '../../../lib/optimization-contracts'
import type { OptimizeJobAccepted, OptimizeJobStatusResponse } from '../../../lib/types'
import { copy } from '../../../copy/index'

const CHANNEL_NAME = 'maa:optimization-jobs:v1'
const NOTIFICATION_PREFERENCE_KEY = 'maa:optimization-notifications:v1'
const SUBMIT_LEASE_PREFIX = 'maa:optimization-submit-lease:v1:'
const TAB_ID = crypto.randomUUID()

export interface OptimizationJobBroadcast {
  type: 'job-updated';
  profileId: string;
  jobId: string;
  status: OptimizationJobSnapshot<unknown>['status'];
  kind: OptimizationJobKind;
  at: number;
}

class OptimizationSubmissionLockedError extends Error {
  constructor() {
    super(copy.optimize.pages_tool_optimize_optimization_job_events_001)
    this.name = 'OptimizationSubmissionLockedError'
  }
}

export function publishOptimizationJobUpdate(profileId: string, job: OptimizationJobSnapshot<unknown>): void {
  publishJobEvent(profileId, job.id, job.status, job.kind)
}

export function publishLegacyOptimizationJobUpdate(
  profileId: string,
  job: OptimizeJobAccepted | OptimizeJobStatusResponse,
): void {
  const kind = 'job_kind' in job && job.job_kind ? job.job_kind : 'schedule'
  publishJobEvent(profileId, job.job_id, job.status, kind)
}

function publishJobEvent(
  profileId: string,
  jobId: string,
  status: OptimizationJobSnapshot<unknown>['status'],
  kind: OptimizationJobKind,
): void {
  const event: OptimizationJobBroadcast = {
    type: 'job-updated',
    profileId,
    jobId,
    status,
    kind,
    at: Date.now(),
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANNEL_NAME, { detail: event }))
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage(event)
    channel.close()
  }
  if (isTerminal(status)) void notifyTerminalJob(jobId, status, kind)
}

export function subscribeOptimizationJobUpdates(listener: (event: OptimizationJobBroadcast) => void): () => void {
  const onWindow = (event: Event) => listener((event as CustomEvent<OptimizationJobBroadcast>).detail)
  window.addEventListener(CHANNEL_NAME, onWindow)
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null
  if (channel) channel.onmessage = (event: MessageEvent<OptimizationJobBroadcast>) => listener(event.data)
  return () => {
    window.removeEventListener(CHANNEL_NAME, onWindow)
    channel?.close()
  }
}

export async function withOptimizationSubmissionLock<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
  const lockName = `${CHANNEL_NAME}:submit:${profileId}`
  if (navigator.locks) {
    return await navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
      if (!lock) throw new OptimizationSubmissionLockedError()
      return await operation()
    })
  }

  const key = `${SUBMIT_LEASE_PREFIX}${profileId}`
  const now = Date.now()
  const lease = readSubmitLease(key)
  if (lease && lease.expiresAt > now && lease.owner !== TAB_ID) throw new OptimizationSubmissionLockedError()
  const mine = { owner: TAB_ID, expiresAt: now + 45_000 }
  localStorage.setItem(key, JSON.stringify(mine))
  const confirmed = readSubmitLease(key)
  if (!confirmed || confirmed.owner !== TAB_ID) throw new OptimizationSubmissionLockedError()
  try {
    return await operation()
  } finally {
    if (readSubmitLease(key)?.owner === TAB_ID) localStorage.removeItem(key)
  }
}

export function optimizationNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIFICATION_PREFERENCE_KEY) === '1'
  } catch {
    return false
  }
}

export async function setOptimizationNotificationsEnabled(enabled: boolean): Promise<boolean> {
  if (enabled && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false
  }
  try {
    localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, enabled ? '1' : '0')
  } catch {
    return false
  }
  return true
}

export function setOptimizationAppBadge(activeCount: number): void {
  const badgeNavigator = navigator as Navigator & { setAppBadge?: (contents?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (activeCount > 0) void badgeNavigator.setAppBadge?.(activeCount).catch(() => undefined)
  else void badgeNavigator.clearAppBadge?.().catch(() => undefined)
}

async function notifyTerminalJob(jobId: string, status: OptimizationJobSnapshot<unknown>['status'], kind: OptimizationJobKind): Promise<void> {
  if (!optimizationNotificationsEnabled() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const dedupeKey = `maa:optimization-notified:${jobId}:${status}`
  try {
    if (sessionStorage.getItem(dedupeKey)) return
    sessionStorage.setItem(dedupeKey, '1')
  } catch {
    // Notification dedupe is best effort.
  }
  const title = status === 'succeeded'
    ? kind === 'scenario_comparison'
      ? copy.optimize.pages_tool_optimize_optimization_job_events_003
      : kind === 'upgrade_suggestions'
        ? copy.optimize.pages_tool_optimize_optimization_job_events_004
        : copy.optimize.pages_tool_optimize_optimization_job_events_002
    : copy.optimize.pages_tool_optimize_optimization_job_events_005
  if (document.visibilityState === 'hidden') {
    const previousTitle = document.title
    document.title = title
    const restoreTitle = () => {
      if (document.title === title) document.title = previousTitle
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', restoreTitle)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') restoreTitle()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', restoreTitle, { once: true })
    window.setTimeout(restoreTitle, 30_000)
    const notification = new Notification(title, {
      body: copy.optimize.pages_tool_optimize_optimization_job_events_006,
      tag: `optimization-job-${jobId}`,
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }
}

function isTerminal(status: OptimizationJobSnapshot<unknown>['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'dead_lettered'
}

function readSubmitLease(key: string): { owner: string; expiresAt: number } | null {
  try {
    const raw = localStorage.getItem(key)
    const value = raw ? JSON.parse(raw) as { owner?: unknown; expiresAt?: unknown } : null
    return typeof value?.owner === 'string' && typeof value.expiresAt === 'number'
      ? { owner: value.owner, expiresAt: value.expiresAt }
      : null
  } catch {
    return null
  }
}
