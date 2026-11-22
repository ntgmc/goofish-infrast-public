// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SklandDataActions from './SklandDataActions'
import { useSklandSnapshot } from '../hooks/useSklandSnapshot'
import { ApiError, apiJson } from '../lib/api-client'
import { resetSklandProfileSnapshot, syncSklandSnapshotSession } from '../lib/skland-snapshot-client'
import type { SklandSnapshot } from '../lib/skland-snapshot'
import type { V2Session } from '../pages/v2/OptionsDrawer'
import { copy } from '../copy'

vi.mock('../lib/api-client', async (original) => ({ ...await original<typeof import('../lib/api-client')>(), apiJson: vi.fn() }))
let session: V2Session
const snapshot = (): SklandSnapshot => ({ uid: 'uid', version: '1', retryAt: null,
  inventory: { state: 'fresh', fetchedAt: new Date().toISOString(), error: null, items: {}, lmd: 0, exp: 0 },
  game: { state: 'fresh', fetchedAt: new Date().toISOString(), error: null } })
beforeEach(() => {
  vi.mocked(apiJson).mockReset().mockResolvedValue(snapshot())
  session = { user: { id: 'user' }, activeProfile: { id: 'profile', status: 'active', kind: 'cdk', display_name: '我的档案',
    skland_binding: { uid: 'uid', nickname: '游戏账号', credential_status: 'available' } }, profiles: [],
    applyAuthPayload: vi.fn(), applySklandAuthorizationPayload: vi.fn(), retryAuth: vi.fn() } as unknown as V2Session
  syncSklandSnapshotSession({ user: session.user!, profiles: [session.activeProfile!] })
})
afterEach(() => { cleanup(); syncSklandSnapshotSession(null) })
function Page() {
  const state = useSklandSnapshot(session.user!.id, session.activeProfile)
  return <><SklandDataActions session={session} profile={session.activeProfile} onRefresh={() => void state.refresh()} refreshing={state.busy} />
    {state.error && <p role="alert">{state.error}</p>}<span>{state.data?.inventory.lmd}</span></>
}
it('replaces refresh with reauthorization only after a credential failure, then recovers in place', async () => {
  render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: copy.skland.refresh })).toBeEnabled())
  expect(screen.queryByRole('button', { name: copy.skland.reauthorize })).not.toBeInTheDocument()
  vi.mocked(apiJson).mockRejectedValueOnce(new ApiError('expired', 400, { code: 'skland_credential_invalid' }, '/api/user/skland/snapshot/refresh'))
  fireEvent.click(screen.getByRole('button', { name: copy.skland.refresh }))
  expect(await screen.findByRole('button', { name: copy.skland.reauthorize })).toBeEnabled()
  expect(screen.getByRole('alert')).toHaveTextContent(copy.skland.authorizationExpired)
  expect(screen.queryByRole('button', { name: copy.skland.refresh })).not.toBeInTheDocument()
  vi.mocked(apiJson).mockResolvedValueOnce({ scan_id: 'scan', qr_data_url: 'data:image/png;base64,AA==' })
  fireEvent.click(screen.getByRole('button', { name: copy.skland.reauthorize }))
  await screen.findByRole('dialog', { name: copy.skland.authorizationTitle })
  expect(screen.getByRole('region', { name: copy.skland.authorizationAccount })).toHaveTextContent('游戏账号')
  expect(screen.getByRole('region', { name: copy.skland.authorizationAccount })).toHaveTextContent('UID uid')
  fireEvent.click(screen.getByRole('button', { name: copy.workspace.components_SklandBindingDialog_004 }))
  fireEvent.change(screen.getByPlaceholderText(copy.workspace.components_SklandBindingDialog_037), { target: { value: 'fixture-cred' } })
  vi.mocked(apiJson).mockResolvedValueOnce({ status: 'confirm_required', confirmation_id: 'confirm', skland_preview: { uid: 'uid', nickname: '游戏账号', channel_name: '官服', operator_count: 0 } })
  fireEvent.click(screen.getByRole('button', { name: copy.workspace.components_SklandBindingDialog_038 }))
  const confirm = await screen.findByRole('button', { name: copy.skland.confirmAuthorization })
  expect(apiJson).toHaveBeenCalledWith('/api/user/skland/credential/preview', expect.objectContaining({ json: expect.objectContaining({ profile_id: 'profile', purpose: 'reauthorize' }) }))
  const payload = { user: session.user, active_profile: session.activeProfile, profiles: [session.activeProfile], workspace: null }
  vi.mocked(apiJson).mockResolvedValueOnce(payload).mockResolvedValue(snapshot())
  fireEvent.click(confirm)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(session.applySklandAuthorizationPayload).toHaveBeenCalledWith(payload)
  expect(session.applyAuthPayload).not.toHaveBeenCalled()
  expect(await screen.findByRole('button', { name: copy.skland.refresh })).toBeEnabled()
})
it('keeps refresh available after a network failure', async () => {
  render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: copy.skland.refresh })).toBeEnabled())
  vi.mocked(apiJson).mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: copy.skland.refresh }))
  expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  expect(screen.getByRole('button', { name: copy.skland.refresh })).toBeEnabled()
  expect(screen.queryByRole('button', { name: copy.skland.reauthorize })).not.toBeInTheDocument()
})
it('recognizes an invalid saved credential before reading data and keeps it invalid after cancellation', async () => {
  session.activeProfile!.skland_binding!.credential_status = 'invalid'
  render(<Page />)
  expect(apiJson).not.toHaveBeenCalled()
  vi.mocked(apiJson).mockResolvedValueOnce({ scan_id: 'scan', qr_data_url: 'data:image/png;base64,AA==' })
  fireEvent.click(screen.getByRole('button', { name: copy.skland.reauthorize }))
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: copy.skland.closeAuthorization }))
  expect(screen.getByRole('button', { name: copy.skland.reauthorize })).toBeEnabled()
  expect(session.applySklandAuthorizationPayload).not.toHaveBeenCalled()
})
it('keeps the recovery action available after closing a failed authorization dialog', async () => {
  render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: copy.skland.refresh })).toBeEnabled())
  vi.mocked(apiJson).mockRejectedValueOnce(new ApiError('expired', 400, { code: 'skland_credential_invalid' }, '/api/user/skland/snapshot/refresh'))
  fireEvent.click(screen.getByRole('button', { name: copy.skland.refresh }))
  fireEvent.click(await screen.findByRole('button', { name: copy.skland.reauthorize }))
  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: copy.skland.closeAuthorization }))
  expect(screen.getByRole('button', { name: copy.skland.reauthorize })).toBeEnabled()
  await act(async () => resetSklandProfileSnapshot(session.user!.id, session.activeProfile!))
})
