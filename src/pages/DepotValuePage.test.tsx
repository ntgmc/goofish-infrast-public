// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthMeResponse, DepotValueResponse } from '../lib/types'
import DepotValuePage from './DepotValuePage'

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
  apiJsonOrNull: vi.fn(),
}))

vi.mock('../lib/api-client', () => ({
  apiJson: mocks.apiJson,
  apiJsonOrNull: mocks.apiJsonOrNull,
}))

vi.mock('../components/SklandBindingDialog', () => ({
  default: () => null,
}))

beforeEach(() => {
  mocks.apiJson.mockReset()
  mocks.apiJsonOrNull.mockReset()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DepotValuePage', () => {
  it('shows auth service failures separately from logged-out state and retries', async () => {
    const user = userEvent.setup()
    mocks.apiJsonOrNull.mockRejectedValue(new TypeError('network lost'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('登录状态加载失败，请重试。')
    expect(screen.queryByText('登录或注册后会自动创建一个仅用于仓库分析的免费档案，然后继续绑定森空岛。'))
      .not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试登录状态' }))
    await waitFor(() => expect(mocks.apiJsonOrNull).toHaveBeenCalledTimes(2))
  })

  it('defaults sample contribution on, allows opting out before analysis, and renders pricing provenance', async () => {
    const user = userEvent.setup()
    mocks.apiJsonOrNull.mockResolvedValue(authPayload())
    mocks.apiJson.mockResolvedValue(depotResult())

    renderPage()

    const analyzeButton = await screen.findByRole('button', { name: '使用森空岛库存' })
    await user.click(analyzeButton)
    expect(mocks.apiJson).toHaveBeenNthCalledWith(1, '/api/depot-value', expect.objectContaining({
      json: { source: 'skland', profile_id: 'profile-1', sample_consent: true },
    }))
    expect(await screen.findByText(/新鲜快照/, { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText('snapshot-abcdef1')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /默认同意贡献假名化聚合样本/ }))
    await user.click(screen.getByRole('button', { name: '使用森空岛库存' }))
    expect(mocks.apiJson).toHaveBeenNthCalledWith(2, '/api/depot-value', expect.objectContaining({
      json: { source: 'skland', profile_id: 'profile-1', sample_consent: false },
    }))
    expect(screen.queryByRole('button', { name: /撤回.*仓库样本/ })).not.toBeInTheDocument()
  })
})

function renderPage() {
  return render(<MemoryRouter><DepotValuePage /></MemoryRouter>)
}

function authPayload(): AuthMeResponse {
  return {
    user: { id: 'user-1' },
    profiles: [{
      id: 'profile-1',
      user_id: 'user-1',
      kind: 'depot_value',
      permission: 'growth',
      trial: null,
      status: 'active',
      archived_at: null,
      cdk_order_hash: null,
      display_name: '仓库档案',
      note: '',
      skland_binding: {
        uid: '12345678',
        nickname: '博士',
        channel_name: '官服',
        bound_at: '2026-07-31T00:00:00.000Z',
        last_imported_at: null,
        credential_status: 'available',
        credential_invalid_at: null,
        credential_invalid_reason: null,
      },
      operator_count: 0,
      updated_at: '2026-07-31T00:00:00.000Z',
      created_at: '2026-07-31T00:00:00.000Z',
    }],
  } as AuthMeResponse
}

function depotResult(): DepotValueResponse {
  return {
    source: 'skland',
    item_count: 1,
    priced_count: 1,
    unpriced_count: 0,
    total_equivalent_sanity: 12,
    percentile: 50,
    ranking: {
      mode: 'curve',
      sample_count: 0,
      sample_weight: 0,
      curve_percentile: 50,
      sample_percentile: null,
      contribution_status: 'declined',
    },
    top_items: [],
    unpriced_items: [],
    warnings: [],
    sources: {
      inventory: 'skland',
      yituliu: 'fresh',
      pricing_snapshot_id: 'snapshot-abcdef123456',
      pricing_fetched_at: '2026-07-31T00:00:00.000Z',
      pricing_age_ms: 0,
      valuation_version: 'depot-v2:data:snapshot-abcdef123456',
      pricing_coverage: 1,
      lmd_exp: 'fixed_lmd_exp_36_per_10000',
      ranking: 'entertainment_curve_v1',
    },
    generated_at: '2026-07-31T00:01:00.000Z',
    build_meta: {
      frontend_version: 'test',
      backend_version: 'test',
      data_version: 'data-test',
      generated_at: '2026-07-31T00:00:00.000Z',
      source_summary: 'test',
    },
  }
}
