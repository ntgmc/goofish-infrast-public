// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '../../test/query-render'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { TaskDraftProvider } from '../../lib/task-drafts'
import { CONFIG_PRESETS } from '../../lib/config'
import { getFacilityIds } from '../../lib/facility-layout'
import { useToolSession } from './useToolSession'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('restores unsaved account configuration after authentication and requires an explicit save retry', async () => {
  const config = { ...CONFIG_PRESETS['243'], facility_layout: getFacilityIds(CONFIG_PRESETS['243']) }
  let userId = 'user-a'
  const payload = () => ({ user: { id: userId }, profiles: [{ id: 'profile-a', kind: 'cdk' }], active_profile: { id: 'profile-a', kind: 'cdk' }, workspace: { operators: [], config, elite_overrides: {} } })
  const fetch = vi.fn(async () => Response.json(payload()))
  vi.stubGlobal('fetch', fetch)
  let session!: ReturnType<typeof useToolSession>
  function Workspace() {
    session = useToolSession(undefined, false, false)
    return <><span>{session.authStatus}</span><output data-testid="description">{session.configOverride?.desc ?? session.workspace?.config?.desc ?? ''}</output><button onClick={() => session.setConfigOverride({ ...config, desc: '未保存配置' })}>编辑</button><button onClick={session.retryConfigSave}>重试保存</button></>
  }
  function Page() {
    const [open, setOpen] = useState(true)
    return <><button onClick={() => setOpen(!open)}>认证往返</button>{open && <Workspace />}</>
  }
  render(<TaskDraftProvider><Page /></TaskDraftProvider>)
  await screen.findByText('authenticated')
  fireEvent.click(screen.getByText('编辑'))
  expect(screen.getByTestId('description')).toHaveTextContent('未保存配置')
  fireEvent.click(screen.getByText('认证往返'))
  fireEvent.click(screen.getByText('认证往返'))
  await screen.findByText('authenticated')
  expect(screen.getByTestId('description')).toHaveTextContent('未保存配置')
  await waitFor(() => expect(session.configSyncStatus).toBe('failed'))
  expect(fetch.mock.calls).toHaveLength(2)
  fireEvent.click(screen.getByText('重试保存'))
  await waitFor(() => expect(fetch.mock.calls).toHaveLength(3))
  await waitFor(() => expect(session.configSyncStatus).toBe('idle'))
  fireEvent.click(screen.getByText('认证往返'))
  userId = 'user-b'
  fireEvent.click(screen.getByText('认证往返'))
  await screen.findByText('authenticated')
  expect(screen.getByTestId('description')).not.toHaveTextContent('未保存配置')
})
