// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SklandPayload } from '../../components/SklandBindingDialog'
import { copy } from '../../copy'
import { ApiError, apiJson } from '../../lib/api-client'
import { DEFAULT_SITE_FEATURES } from '../../lib/site-features'
import { MotionPreferenceProvider } from '../../lib/motion-preference'
import OperatorManagementPanel from './OperatorManagementPanel'
import type { V2Session } from './OptionsDrawer'
import { SAMPLE_CONFIG, SAMPLE_OPERATORS } from './sample-result'

vi.mock('../../lib/api-client', async (original) => ({ ...await original<typeof import('../../lib/api-client')>(), apiJson: vi.fn() }))
vi.mock('../../lib/site-feature-context', () => ({ useSiteFeatures: () => ({ features: DEFAULT_SITE_FEATURES }) }))

const text = copy.v2.operatorManagement
const originalTime = '2026-10-01T10:00:00Z'
const verifiedTime = '2026-10-20T08:00:00Z'
let session: V2Session

beforeEach(() => {
  vi.mocked(apiJson).mockReset()
  session = {
    user: { id: 'user' },
    activeProfile: { id: 'first', kind: 'cdk', display_name: '我的档案', skland_binding: {
      uid: '12345678', nickname: '游戏昵称', channel_name: '官服', bound_at: originalTime, last_imported_at: originalTime,
      credential_status: 'available', credential_invalid_at: null, credential_invalid_reason: null,
    } },
    flushConfigSave: vi.fn(async () => true), applyAuthPayload: vi.fn(), setConfigOverride: vi.fn(),
  } as unknown as V2Session
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function panel(operators = SAMPLE_OPERATORS) {
  return <MotionPreferenceProvider><OperatorManagementPanel key={session.activeProfile!.id} session={session}
    config={SAMPLE_CONFIG} operators={operators} busy={false} onImportOperators={vi.fn()}
    onAccount={vi.fn()} onManageProfiles={vi.fn()} /></MotionPreferenceProvider>
}
function payload(overrides: Partial<NonNullable<SklandPayload['skland_import']>> = {}): SklandPayload {
  return { user: session.user!, active_profile: session.activeProfile, profiles: [session.activeProfile!], workspace: null,
    skland_import: { status: 'imported', uid: '12345678', nickname: '游戏昵称', channel_name: '官服', operator_count: 1,
      imported_at: originalTime, inventory_synced: true, config_saved: true, credential_verified_at: null, ...overrides } }
}

it('keeps saved credentials unverified for cached imports and only reports a real verification timestamp', async () => {
  const user = userEvent.setup()
  render(panel())
  expect(screen.getByText('游戏昵称')).toBeInTheDocument()
  expect(screen.getByText('12345678')).toBeInTheDocument()
  expect(screen.getByText(text.credentialSaved)).toBeInTheDocument()
  expect(apiJson).not.toHaveBeenCalled()
  vi.mocked(apiJson).mockResolvedValueOnce(payload())
  await user.click(screen.getByRole('button', { name: text.refresh }))
  expect(await screen.findByRole('status')).toHaveTextContent(text.cachedSuccess)
  expect(screen.getByText(text.credentialSaved)).toBeInTheDocument()
  expect(screen.queryByText(text.credentialVerified)).not.toBeInTheDocument()
  vi.mocked(apiJson).mockResolvedValueOnce(payload({ credential_verified_at: verifiedTime, imported_at: verifiedTime }))
  await user.click(screen.getByRole('button', { name: text.refresh }))
  expect(await screen.findByText(text.credentialVerified)).toHaveTextContent(text.credentialVerified)
  expect(screen.getByRole('status')).toHaveTextContent(text.refreshSuccess(1))
  expect(document.querySelector(`time[datetime="${verifiedTime}"]`)).toBeInTheDocument()
  expect(session.flushConfigSave).toHaveBeenCalledTimes(2)
  expect(apiJson).toHaveBeenCalledWith('/api/user/skland/import/refresh', expect.objectContaining({ json: { profile_id: 'first' } }))
})

it('preserves data and credentials on transient failure, but applies an explicit invalid-credential response', async () => {
  const user = userEvent.setup()
  render(panel())
  vi.mocked(apiJson).mockRejectedValueOnce(new ApiError('服务暂时不可用', 502, { recovery_action: 'retry' }, '/api/user/skland/import/refresh'))
  await user.click(screen.getByRole('button', { name: text.refresh }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text.refreshFailed)
  expect(screen.getByText(text.credentialSaved)).toBeInTheDocument()
  expect(screen.getByText(SAMPLE_OPERATORS[0].name)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: text.refresh })).toBeEnabled()
  const invalid = { ...payload(), code: 'skland_credential_invalid', recovery_action: 'rebind' } as SklandPayload
  vi.mocked(apiJson).mockRejectedValueOnce(new ApiError('凭据已过期', 400, invalid, '/api/user/skland/import/refresh'))
  await user.click(screen.getByRole('button', { name: text.retry }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text.credentialInvalid)
  expect(session.applyAuthPayload).toHaveBeenCalledWith(invalid)
  expect(screen.queryByRole('button', { name: text.refresh })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: text.reauthorize }).length).toBeGreaterThan(0)
  expect(document.querySelectorAll(`time[datetime="${originalTime}"]`)).toHaveLength(2)
})

it('reports retained operators and partial inventory failures without claiming a complete update', async () => {
  const user = userEvent.setup()
  render(panel())
  vi.mocked(apiJson).mockResolvedValueOnce(payload({ refresh_warning: 'game unavailable' }))
  await user.click(screen.getByRole('button', { name: text.refresh }))
  expect(await screen.findByRole('status')).toHaveTextContent(text.retainedOperators)
  expect(screen.getByText(text.credentialSaved)).toBeInTheDocument()
  expect(screen.queryByText(text.refreshSuccess(1))).not.toBeInTheDocument()
  vi.mocked(apiJson).mockResolvedValueOnce(payload({ credential_verified_at: verifiedTime, inventory_warning: 'inventory unavailable' }))
  await user.click(screen.getByRole('button', { name: text.retry }))
  expect(await screen.findByText(text.credentialVerified)).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(text.inventoryWarning)
})

it('keeps search results and counts in sync with imported operators and restores owned-first order when cleared', async () => {
  const user = userEvent.setup()
  const operators = [
    { ...SAMPLE_OPERATORS[0], own: true, elite: 0, level: 1 },
    { ...SAMPLE_OPERATORS[1], own: false, elite: 2, level: 90 },
    { ...SAMPLE_OPERATORS[2], own: true, elite: 2, level: 80 },
  ]
  const page = render(panel(operators))
  const list = screen.getByRole('region', { name: text.list })
  const names = () => Array.from(list.querySelectorAll('.v2-operator-row > strong'), (node) => node.textContent)
  expect(names()).toEqual([operators[2].name, operators[0].name, operators[1].name])
  expect(within(list).getByText(text.ownedCount(2))).toBeInTheDocument()

  const search = screen.getByRole('textbox', { name: copy.v2.searchOperators })
  await user.type(search, operators[0].name)
  await waitFor(() => expect(names()).toEqual([operators[0].name]))
  expect(within(list).getByText(text.matchingCount(1))).toBeInTheDocument()

  const imported = [
    { ...operators[0], own: false, elite: 2, level: 90 },
    { ...SAMPLE_OPERATORS[3], own: true, elite: 1, level: 30 },
  ]
  page.rerender(panel(imported))
  await waitFor(() => expect(names()).toEqual([imported[0].name]))
  expect(within(list).getByText(copy.v2.notOwnedLabel)).toBeInTheDocument()
  expect(within(list).getByText(copy.v2.operatorLevel(90))).toBeInTheDocument()

  await user.clear(search)
  await user.type(search, 'no-matching-operator')
  expect(await within(list).findByText(copy.v2.noOperators)).toBeInTheDocument()
  expect(within(list).getByText(text.matchingCount(0))).toBeInTheDocument()
  await user.click(within(list).getByRole('button', { name: text.clearSearch }))
  expect(search).toHaveValue('')
  await waitFor(() => expect(names()).toEqual([imported[1].name, imported[0].name]))
  expect(within(list).getByText(text.ownedCount(1))).toBeInTheDocument()
  expect(operators.map((operator) => operator.id)).toEqual(SAMPLE_OPERATORS.slice(0, 3).map((operator) => operator.id))
  expect(imported.map((operator) => operator.id)).toEqual([SAMPLE_OPERATORS[0].id, SAMPLE_OPERATORS[3].id])
})

it('clears account-specific state and ignores a late refresh response after switching profiles', async () => {
  const user = userEvent.setup()
  const page = render(panel())
  vi.mocked(apiJson).mockResolvedValueOnce(payload({ credential_verified_at: verifiedTime }))
  await user.click(screen.getByRole('button', { name: text.refresh }))
  await screen.findByText(text.credentialVerified)
  fireEvent.change(screen.getByRole('textbox', { name: copy.v2.searchOperators }), { target: { value: '但书' } })
  let complete!: (payload: SklandPayload) => void
  const pending = new Promise<SklandPayload>((resolve) => { complete = resolve })
  const oldPayload = payload({ credential_verified_at: verifiedTime })
  vi.mocked(apiJson).mockReturnValueOnce(pending)
  await user.click(screen.getByRole('button', { name: text.refresh }))
  await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: text.refreshing })).toBeDisabled()
  session = { ...session, activeProfile: { ...session.activeProfile!, id: 'second', display_name: '第二个档案',
    skland_binding: { ...session.activeProfile!.skland_binding!, uid: '87654321', nickname: '另一位博士' } } }
  page.rerender(panel())
  expect(screen.getByText('另一位博士')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: copy.v2.searchOperators })).toHaveValue('')
  expect(screen.queryByText(text.credentialVerified)).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  await act(async () => complete(oldPayload))
  expect(session.applyAuthPayload).toHaveBeenCalledTimes(1)
  expect(within(screen.getByRole('region', { name: text.currentProfile })).getByText('87654321')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
