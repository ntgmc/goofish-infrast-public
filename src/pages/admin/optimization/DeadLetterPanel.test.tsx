// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminOptimizationDeadLetter, AdminOptimizationDeadLetterDetail } from '../contracts'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import DeadLetterPanel from './DeadLetterPanel'

describe('DeadLetterPanel', () => {
  beforeEach(() => {
    adminApiJson.mockReset()
    adminApiJson.mockImplementation(async (url: string) => {
      if (url.includes('view=dead_letter')) return { dead_letter: detail() }
      return { dead_letters: [record()] }
    })
  })

  it('loads and displays the original configuration, operator data, and complete payload on demand', async () => {
    render(<DeadLetterPanel />)

    expect(await screen.findByText(/任务 job-1/)).toBeInTheDocument()
    expect(screen.queryByText('申请的基建配置')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '查看完整申请数据' }))

    expect(await screen.findByText('申请的基建配置')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '申请的基建配置' })).getByText(/"controlCenterLevel": 5/)).toBeInTheDocument()
    const operatorSummary = screen.getByText('干员数据（1）')
    expect(operatorSummary).toBeInTheDocument()
    expect(screen.getByText('完整任务载荷')).toBeInTheDocument()
    expect(within(operatorSummary.closest('details')!).getByText(/"name": "能天使"/)).toBeInTheDocument()
    expect(adminApiJson).toHaveBeenCalledWith(
      '/api/admin/optimization?view=dead_letter&id=letter-1',
      { fallbackMessage: '加载死信完整数据失败' },
    )
  })
})

function record(): AdminOptimizationDeadLetter {
  return {
    id: 'letter-1',
    job_id: 'job-1',
    profile_id: 'profile-1',
    source: 'account_profile',
    failure_kind: 'worker_crash',
    public_error_code: 'execution_retries_exhausted',
    internal_error_message: 'worker exited unexpectedly',
    diagnostic_json: { payload_version: 3 },
    attempt_count: 2,
    status: 'pending_review',
    replay_count: 0,
    replayed_job_id: null,
    replayed_by: null,
    replayed_at: null,
    resolved_at: null,
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-19T10:00:00.000Z',
  }
}

function detail(): AdminOptimizationDeadLetterDetail {
  return {
    ...record(),
    payload_json: {
      version: 3,
      submittedAt: 1_753_002_000_000,
      effectiveConfig: { controlCenterLevel: 5, layout: '243' },
      operators: [{ name: '能天使', elite: 2, level: 90 }],
      request: { include_current: true },
    },
  }
}
