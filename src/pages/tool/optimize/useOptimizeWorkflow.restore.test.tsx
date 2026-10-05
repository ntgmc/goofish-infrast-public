// @vitest-environment jsdom
import { createElement, StrictMode, type PropsWithChildren } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
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

it.each(['cancelled', 'failed'] as const)('locks configuration while restoring polling in StrictMode and unlocks after a %s job', async (status) => {
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
  let finishJob!: () => void
  const completion = new Promise<void>((resolve) => { finishJob = resolve })
  vi.mocked(apiJson).mockImplementation(async (path) => {
    if (path !== '/api/optimization/jobs/restored-job') return { stacks: [], capacities: [], balances: [] }
    await completion
    return {
      id: job.job_id, status, kind: 'schedule', source: 'generated',
      priority: { kind: 'standard', label: '' }, queuePosition: null, pollAfterMs: 500,
      timestamps: { submittedAt: job.submitted_at },
      estimate: { durationMs: 1000, bucket: 'maa_plain', source: 'fallback_p95', sampleCount: 0,
        remainingMs: 0, totalMs: 1000, phase: status, updatedAt: job.estimate_updated_at },
      executionPhase: 'terminal', calculationStage: null, upgradeSuggestions: { requested: false, allowed: false },
      attemptCount: 0, failureCount: 0, cancellationRequested: status === 'cancelled', canCancel: false, canRetry: false,
      error: { code: status === 'cancelled' ? 'JOB_CANCELLED' : 'OPTIMIZATION_FAILED', message: status, retryable: false, recoveryAction: 'none', supportReference: 'restored-job' },
    }
  })
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
  expect(result.current.loading).toBe(true)
  act(() => {
    result.current.updateConfig((draft) => { draft.schedule_mode = 'rotation' })
    result.current.handleApplyScenarioConfig(CONFIG_PRESETS['333'])
    result.current.handleUseSavedConfig({ id: 'saved', name: 'Saved', config: CONFIG_PRESETS['333'],
      created_at: '', updated_at: '', last_used_at: null })
  })
  expect(props.setConfigOverride).not.toHaveBeenCalled()
  expect(props.onWorkspacePatch).not.toHaveBeenCalled()
  expect(result.current.configToast).toBeNull()
  await act(async () => finishJob())
  await waitFor(() => expect(result.current.loading).toBe(false))
  if (status === 'cancelled') {
    expect(result.current.progress).toMatchObject({ jobId: job.job_id, estimatePhase: status })
    expect(result.current.inlineError).toBeNull()
  } else {
    expect(result.current.inlineError).toMatchObject({ scope: 'generate' })
  }
  act(() => result.current.updateConfig((draft) => { draft.schedule_mode = 'rotation' }))
  expect(props.setConfigOverride).toHaveBeenCalledOnce()
  expect(window.sessionStorage.getItem(storageKey)).toBeNull()
  expect(vi.mocked(apiJson).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})
