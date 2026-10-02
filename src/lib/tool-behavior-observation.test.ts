// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiJson } from './api-client'
import {
  clearToolBehaviorEvents, exportToolBehaviorData, observeToolApiRequest, readToolBehaviorEvents,
  recordToolBehavior, setToolBehaviorPage, startToolBehaviorObservation,
} from './tool-behavior-observation'

let stop: () => void
beforeEach(() => {
  window.localStorage.clear()
  stop = startToolBehaviorObservation('user-a', 'session-a')
  setToolBehaviorPage('setup.config', 'profile-a')
})
afterEach(() => {
  stop()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('local tool behavior observations', () => {
  it('keeps a bounded recent history and excludes invalid, future, or sensitive stored fields', () => {
    const now = Date.now()
    const base = { name: 'config_save', at: now, session: 'session-a', page: 'setup.config' }
    window.localStorage.setItem('maatool:behavior-observation:v1:user-a', JSON.stringify([
      { ...base, at: now - 31 * 24 * 60 * 60 * 1000 },
      { ...base, at: now + 1000 },
      { ...base, name: 'unknown' },
      { ...base, page: '/tool?credential=sensitive' },
      { ...base, profile: 'profile-a', credential: 'sensitive', config: { secret: 'sensitive' } },
    ]))
    expect(readToolBehaviorEvents('user-a')).toEqual([{ ...base, profile: 'profile-a' }])

    window.localStorage.setItem('maatool:behavior-observation:v1:user-a', JSON.stringify(
      Array.from({ length: 501 }, (_, index) => ({ ...base, subject: `item-${index}` })),
    ))
    expect(recordToolBehavior({ name: 'config_save' })).toBe(true)
    const events = readToolBehaviorEvents('user-a')
    expect(events).toHaveLength(500)
    expect(events[0].subject).toBe('item-2')
    expect(events[events.length - 1].name).toBe('config_save')
    window.localStorage.setItem('maatool:behavior-observation:v1:user-a', 'broken JSON')
    expect(readToolBehaviorEvents('user-a')).toEqual([])
  })

  it.each([
    ['/api/user/workspace?profile_id=profile-b', 'GET', undefined, 'workspace_load'],
    ['/api/user/workspace', 'PATCH', { config: { nickname: 'sensitive' } }, 'config_save'],
    ['/api/user/workspace', 'PATCH', { operators: [{ name: 'sensitive' }] }, 'data_import'],
    ['/api/user/workspace', 'PATCH', { saved_config_action: { type: 'touch', id: 'preset-a', name: 'sensitive' } }, 'preset_use'],
    ['/api/user/skland/login/confirm', 'POST', { confirmation_id: 'sensitive' }, 'data_import'],
    ['/api/user/skland/import/refresh', 'POST', undefined, 'data_refresh'],
    ['/api/optimization/jobs', 'POST', { kind: 'scenario_comparison', identity: { profileId: 'profile-a' } }, 'scenario_submit'],
    ['/api/optimization/jobs', 'POST', { kind: 'schedule', config: { sensitive: true } }, 'schedule_submit'],
    ['/api/optimization/jobs/job-a/cancel', 'POST', undefined, 'job_cancel'],
    ['/api/user/results/result-a?profile_id=profile-a&token=sensitive', 'GET', undefined, 'result_load'],
    ['/api/user/maa-export', 'POST', { profile_id: 'profile-a', result_id: 'result-a' }, 'result_export_maa'],
    ['/api/user/full-result-export', 'POST', { profile_id: 'profile-a', result_id: 'result-a' }, 'result_export_full'],
    ['/api/user/result-archive', 'POST', { action: 'archive', result_id: 'result-a' }, 'result_archive'],
  ])('records the operation category for %s without its contents', (url, method, body, name) => {
    observeToolApiRequest(url, method, body)('succeeded', 12.8)
    const events = readToolBehaviorEvents('user-a')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ name, outcome: 'succeeded', duration_ms: 13 })
    expect(JSON.stringify(events)).not.toContain('sensitive')
  })

  it('records request outcomes only after parsing, excludes polling and credentials, and tolerates denied storage', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('invalid JSON', { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{"error":"sensitive"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{"status":"queued"}', { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await apiJson('/api/user/workspace', { method: 'PATCH', json: { config: {} } })
    await expect(apiJson('/api/user/workspace', { method: 'PATCH', json: { config: {} } })).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(apiJson('/api/user/workspace', { method: 'PATCH', json: { config: {} } })).rejects.toMatchObject({ status: 503 })
    await apiJson('/api/optimization/jobs/job-a')
    observeToolApiRequest('/api/auth/login', 'POST', { email: 'sensitive', password: 'sensitive' })('succeeded', 10)
    observeToolApiRequest('/api/user/skland/credential/preview', 'POST', { credential: 'sensitive' })('succeeded', 10)
    expect(readToolBehaviorEvents('user-a').map((event) => event.outcome)).toEqual(['succeeded', 'failed', 'failed'])

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage denied') })
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }))
    await expect(apiJson('/api/user/workspace', { method: 'PATCH', json: { config: {} } })).resolves.toEqual({ ok: true })
    expect(recordToolBehavior({ name: 'config_save' })).toBe(false)
  })

  it('retains the initiating page across navigation and drops late responses after the user or session changes', () => {
    setToolBehaviorPage('dashboard.profiles', null)
    const complete = observeToolApiRequest('/api/user/workspace?profile_id=profile-a', 'GET', undefined)
    setToolBehaviorPage('optimize.result', 'profile-a')
    complete('succeeded', 25)
    expect(readToolBehaviorEvents('user-a')[0]).toMatchObject({ name: 'profile_open', page: 'dashboard.profiles', profile: 'profile-a' })
    const late = observeToolApiRequest('/api/user/workspace', 'PATCH', { config: {} })
    stop()
    stop = startToolBehaviorObservation('user-b', 'session-b')
    late('succeeded', 100)
    expect(readToolBehaviorEvents('user-b')).toEqual([])
    stop()
    stop = startToolBehaviorObservation('user-a', 'session-new')
    late('succeeded', 100)
    expect(readToolBehaviorEvents('user-a')).toHaveLength(1)
  })

  it('exports repeatable aliases without account identifiers and clears only the selected user history', () => {
    recordToolBehavior({ name: 'result_select', profile: 'profile-a', subject: 'result-a' })
    recordToolBehavior({ name: 'result_export_maa', profile: 'profile-a', subject: 'result-a' })
    const exported = exportToolBehaviorData('user-a')
    expect(exported).not.toMatch(/user-a|profile-a|result-a/)
    const data = JSON.parse(exported)
    expect(data.events.map((event: { profile: string; subject: string }) => [event.profile, event.subject]))
      .toEqual([['profile_1', 'item_1'], ['profile_1', 'item_1']])
    stop()
    stop = startToolBehaviorObservation('user-b', 'session-b')
    recordToolBehavior({ name: 'config_save' })
    expect(clearToolBehaviorEvents('user-a')).toBe(true)
    expect(readToolBehaviorEvents('user-a')).toEqual([])
    expect(readToolBehaviorEvents('user-b')).toHaveLength(1)
    stop()
    expect(recordToolBehavior({ name: 'config_save' })).toBe(false)
  })
})
