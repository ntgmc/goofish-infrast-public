// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '../../../test/query-render'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiJson } from '../../../lib/api-client'
import { copy } from '../../../copy'
import type { InvitationRecordSummary, InvitationSummary } from '../../../lib/types'
import { useInventoryBalances } from '../optimize/useInventoryBalances'
import InvitationsSection from './InvitationsSection'

vi.mock('../../../lib/api-client', () => ({
  apiJson: vi.fn(),
  getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}))

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks() })

const text = copy.dashboard
const props = { userId: 'user', activeProfileId: 'profile-1' }
function record(id: string, status: InvitationRecordSummary['status'] = 'registered'): InvitationRecordSummary {
  return { id, invitee_label: id, registered_at: '2026-10-01T00:00:00Z', activated_at: null, status,
    attempt_count: 0, next_retry_at: null, last_error: null, inviter_reward_status: 'pending_activation', inviter_rewards: [] }
}
function summary(records: InvitationRecordSummary[] = [], next_cursor: string | null = null): InvitationSummary {
  return { as_of: '2026-10-01T00:00:00Z', can_invite: true, campaign_enabled: true, code: 'INV123', code_status: 'active',
    share_url: '/?invite=INV123', reward_preview: { inviter: [], invitee: [] },
    stats: { registered: records.length, activated: 0, rewarded_invitations: 0, today_rewarded: 0 },
    daily_limit: { used: 0, limit: 10, remaining: 10, reset_at: '2026-10-02T00:00:00Z' }, records, next_cursor }
}
function PriorityBalance() {
  const { priorityCouponBalance } = useInventoryBalances('user', 'profile-1')
  return <output aria-label="priority balance">{priorityCouponBalance?.available ?? 0}</output>
}

describe('invitation queries', () => {
  it('deduplicates records and refreshes loaded pages using the latest cursors', async () => {
    const first = record('first-doctor'), second = record('second-doctor')
    vi.mocked(apiJson)
      .mockResolvedValueOnce(summary([first], 'old cursor'))
      .mockResolvedValueOnce(summary([first, second]))
      .mockResolvedValueOnce(summary([first], 'new cursor'))
      .mockResolvedValueOnce(summary([second]))
    render(<InvitationsSection {...props} />)
    await screen.findByDisplayValue('INV123')
    fireEvent.click(screen.getByText(text.pages_tool_dashboard_InvitationsSection_054))
    fireEvent.click(screen.getByRole('button', { name: text.pages_tool_dashboard_InvitationsSection_072 }))
    await screen.findAllByText('second-doctor')
    expect(screen.getAllByText('first-doctor')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: text.pages_tool_dashboard_InvitationsSection_084 }))
    await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(screen.queryByText(text.pages_tool_dashboard_InvitationsSection_083)).not.toBeInTheDocument())
    expect(screen.getAllByText('second-doctor')).toHaveLength(2)
    expect(vi.mocked(apiJson).mock.calls.map(([url]) => url)).toEqual([
      '/api/user/invitations', '/api/user/invitations?cursor=old%20cursor', '/api/user/invitations', '/api/user/invitations?cursor=new%20cursor',
    ])
  })

  it('cancels obsolete user and profile reads and ignores late data and errors', async () => {
    const requests: Array<{ signal: AbortSignal; finish: (value: unknown) => void; fail: (error: Error) => void }> = []
    vi.mocked(apiJson).mockImplementation((_url, init) => new Promise((resolve, reject) => {
      requests.push({ signal: init!.signal!, finish: resolve, fail: reject })
    }))
    const page = render(<InvitationsSection {...props} />)
    page.rerender(<InvitationsSection {...props} activeProfileId="profile-2" />)
    expect(requests[0].signal.aborted).toBe(true)
    page.rerender(<InvitationsSection userId="another-user" activeProfileId="profile-2" />)
    expect(requests[1].signal.aborted).toBe(true)
    await act(async () => {
      requests[0].finish({ ...summary(), code: 'OLD-CODE' })
      requests[1].fail(new Error('obsolete error'))
      requests[2].finish({ ...summary(), code: 'CURRENT-CODE' })
    })
    expect(await screen.findByDisplayValue('CURRENT-CODE')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('OLD-CODE')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    page.rerender(<InvitationsSection {...props} activeProfileId="profile-3" />)
    page.unmount()
    expect(requests[3].signal.aborted).toBe(true)
  })

  it('preserves rotation confirmation and submits code changes once even if the following read fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(apiJson).mockResolvedValueOnce(summary()).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Invitation refresh unavailable'))
    render(<InvitationsSection {...props} />)
    await screen.findByDisplayValue('INV123')
    fireEvent.click(screen.getByRole('button', { name: text.pages_tool_dashboard_InvitationsSection_088 }))
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(apiJson).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: text.pages_tool_dashboard_InvitationsSection_087 }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invitation refresh unavailable')
    expect(screen.getByText(text.pages_tool_dashboard_InvitationsSection_080)).toBeInTheDocument()
    const mutations = vi.mocked(apiJson).mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toEqual(['/api/user/invitations/code', expect.objectContaining({ json: { action: 'pause' } })])
    expect(screen.getByDisplayValue('INV123')).toBeInTheDocument()
  })

  it('invalidates invitation caches across profiles after a code change', async () => {
    let current = summary(), reads = 0
    vi.mocked(apiJson).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') { current = { ...current, code_status: 'paused', share_url: null }; return {} }
      reads += 1
      return current
    })
    const page = render(<InvitationsSection {...props} />)
    await screen.findByDisplayValue('INV123')
    page.rerender(<InvitationsSection {...props} activeProfileId="profile-2" />)
    await screen.findByDisplayValue('INV123')
    expect(reads).toBe(2)
    page.rerender(<InvitationsSection {...props} />)
    expect(reads).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: text.pages_tool_dashboard_InvitationsSection_087 }))
    await screen.findByText(text.pages_tool_dashboard_InvitationsSection_080)
    expect(reads).toBe(3)
    page.rerender(<InvitationsSection {...props} activeProfileId="profile-2" />)
    await screen.findByRole('button', { name: text.pages_tool_dashboard_InvitationsSection_086 })
    expect(reads).toBe(4)
    expect(vi.mocked(apiJson).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('polls pending settlements every 15 seconds without aborting slow reads, pauses while hidden, and stops after settlement', async () => {
    vi.useFakeTimers()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const pending = summary([record('pending-doctor', 'processing')])
    let finish!: (value: InvitationSummary) => void
    vi.mocked(apiJson).mockResolvedValueOnce(pending)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValueOnce(summary([record('settled-doctor', 'settled')]))
    render(<InvitationsSection {...props} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(5) })
    expect(apiJson).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(apiJson).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(apiJson).toHaveBeenCalledTimes(2)
    expect(vi.mocked(apiJson).mock.calls[1][1]?.signal?.aborted).toBe(false)
    await act(async () => { finish(pending); await vi.advanceTimersByTimeAsync(5) })
    visibility.mockReturnValue('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(apiJson).toHaveBeenCalledTimes(2)
    visibility.mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
    await act(async () => { await vi.advanceTimersByTimeAsync(5) })
    expect(apiJson).toHaveBeenCalledTimes(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(apiJson).toHaveBeenCalledTimes(3)
  })

  it('refreshes the shared inventory after a newly observed reward is granted', async () => {
    let current = summary([record('doctor', 'processing')]), quantity = 0, inventoryReads = 0
    vi.mocked(apiJson).mockImplementation(async (url) => {
      if (url === '/api/user/invitations') return current
      if (url === '/api/user/inventory') {
        inventoryReads += 1
        return { stacks: [{ item: { code: 'priority_compute_coupon' }, quantity, permanent: quantity, next_expiry_at: null }], capacities: [], recent_events: [] }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    render(<><PriorityBalance /><InvitationsSection {...props} /></>)
    await screen.findByDisplayValue('INV123')
    expect(screen.getByLabelText('priority balance')).toHaveTextContent('0')
    quantity = 2
    current = summary([{ ...record('doctor', 'settled'), inviter_reward_status: 'granted' }])
    current.stats.rewarded_invitations = 1
    fireEvent.click(screen.getByRole('button', { name: text.pages_tool_dashboard_InvitationsSection_084 }))
    await waitFor(() => expect(screen.getByLabelText('priority balance')).toHaveTextContent('2'))
    expect(inventoryReads).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: text.pages_tool_dashboard_InvitationsSection_084 }))
    await waitFor(() => expect(vi.mocked(apiJson).mock.calls.filter(([url]) => url === '/api/user/invitations')).toHaveLength(3))
    expect(inventoryReads).toBe(2)
  })
})
