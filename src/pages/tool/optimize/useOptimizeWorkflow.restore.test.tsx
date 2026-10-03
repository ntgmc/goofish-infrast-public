// @vitest-environment jsdom
import { createElement, StrictMode, type PropsWithChildren } from 'react'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { apiJson } from '../../../lib/api-client'
import { CONFIG_PRESETS, normalizeConfig } from '../../../lib/config'
import type { OptimizeJobAccepted, UserGameAccount } from '../../../lib/types'
import { createAccountLicense } from '../tool-utils'
import { buildOptimizeJobStorageKey, writeActiveOptimizeJob } from './job-progress'
import { buildOptimizeSignature } from './workflow-utils'
import { useOptimizeWorkflow, type Props } from './useOptimizeWorkflow'

vi.mock('../../../lib/api-client', async (original) => ({
  ...await original<typeof import('../../../lib/api-client')>(),
  apiJson: vi.fn(),
}))

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

it('restores polling after StrictMode effect cleanup and handles cancellation without resubmitting', async () => {
  const profile: UserGameAccount = {
    id: 'restored-profile', user_id: 'user', kind: 'cdk', permission: 'ultimate',
    status: 'active', cdk_order_hash: 'order', display_name: 'Doctor', note: '',
    operator_count: 0, updated_at: null, created_at: '2026-10-01T00:00:00Z',
  }
  const config = normalizeConfig(CONFIG_PRESETS['243'])
  const license = createAccountLicense(profile, [], config)
  const job: OptimizeJobAccepted = {
    job_id: 'restored-job', status: 'queued', priority: 'standard', priority_label: '',
    queue_position: 1, submitted_at: '2026-10-01T00:00:00Z', poll_after_ms: 500,
    estimated_duration_ms: 1000, estimate_bucket: 'maa_plain', estimate_source: 'fallback_p95',
    estimate_sample_count: 0, estimated_remaining_ms: 1000, estimated_total_ms: 1000,
    estimate_phase: 'queued', estimate_updated_at: '2026-10-01T00:00:00Z',
    calculation_stage: null, calculation_stage_updated_at: null,
    upgrade_suggestions_requested: false, upgrade_suggestions_allowed: false,
  }
  const storageKey = buildOptimizeJobStorageKey(profile.id, license.order_hash, buildOptimizeSignature([], config), 'generate')
  writeActiveOptimizeJob(storageKey, job)
  vi.mocked(apiJson).mockImplementation(async (path) => path === '/api/optimization/jobs/restored-job' ? {
    id: job.job_id, status: 'cancelled', kind: 'schedule', source: 'generated',
    priority: { kind: 'standard', label: '' }, queuePosition: null, pollAfterMs: 500,
    timestamps: { submittedAt: job.submitted_at },
    estimate: { durationMs: 1000, bucket: 'maa_plain', source: 'fallback_p95', sampleCount: 0,
      remainingMs: 0, totalMs: 1000, phase: 'cancelled', updatedAt: job.estimate_updated_at },
    executionPhase: 'terminal', calculationStage: null, upgradeSuggestions: { requested: false, allowed: false },
    attemptCount: 0, failureCount: 0, cancellationRequested: true, canCancel: false, canRetry: false,
    error: { code: 'JOB_CANCELLED', message: 'Cancelled', retryable: false, recoveryAction: 'none', supportReference: 'restored-job' },
  } : { stacks: [], capacities: [], balances: [] })
  const props: Props = {
    profileId: profile.id, profile, license, workspace: null, setLicense: vi.fn(), eliteOverrides: {},
    configOverride: null, setConfigOverride: vi.fn(), configSyncStatus: 'idle',
    flushConfigSave: vi.fn(async () => true), retryConfigSave: vi.fn(), onWorkspacePatch: vi.fn(),
    onWorkspaceUpdated: vi.fn(), section: 'result', onSectionChange: vi.fn(), onReset: vi.fn(),
    onLogout: vi.fn(), announcement: null, redeemedNotice: null, onProfileUpgraded: vi.fn(),
  }
  const wrapper = ({ children }: PropsWithChildren) => createElement(StrictMode, null, children)
  const { result } = renderHook(() => useOptimizeWorkflow(props), { wrapper })
  await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/api/optimization/jobs/restored-job', expect.anything()))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.progress).toMatchObject({ jobId: job.job_id, estimatePhase: 'cancelled' })
  expect(result.current.inlineError).toBeNull()
  expect(window.sessionStorage.getItem(storageKey)).toBeNull()
  expect(vi.mocked(apiJson).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})
