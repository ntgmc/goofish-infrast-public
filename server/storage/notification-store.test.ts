import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureDatabaseSchema: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('./schema', () => ({ ensureDatabaseSchema: mocks.ensureDatabaseSchema }))
vi.mock('./postgres', () => ({ query: mocks.query, withTransaction: mocks.withTransaction }))

import {
  listUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  upsertItemGrantNotificationInTransaction,
} from './notification-store'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensureDatabaseSchema.mockResolvedValue(undefined)
  mocks.withTransaction.mockImplementation(async (work: (client: { query: (text: string, values?: unknown[]) => Promise<unknown> }) => Promise<unknown>) => work({
    query: (text, values) => text.startsWith('set transaction')
      ? Promise.resolve({ rows: [], rowCount: 0 })
      : text.startsWith('select transaction_timestamp()')
        ? Promise.resolve({ rows: [{ as_of: '2026-07-30T00:01:00.000Z' }], rowCount: 1 })
      : mocks.query(text, values),
  }))
})

describe('notification store', () => {
  it('creates one item notification for a newly inserted grant', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'notification-1' }] }) }

    await upsertItemGrantNotificationInTransaction(client as never, grantInput())

    expect(client.query).toHaveBeenCalledOnce()
    expect(client.query.mock.calls[0][0]).toContain('insert into user_notifications')
    const payload = JSON.parse(client.query.mock.calls[0][1][6])
    expect(payload).toMatchObject({
      kind: 'item_grant',
      items: [{ item_code: 'priority_compute_coupon', quantity: 2, grant_ids: ['grant-1'] }],
    })
  })

  it('aggregates grants from the same source and makes a read notification unread again', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rows: [{
          id: 'notification-1',
          payload_json: {
            kind: 'item_grant',
            items: [{
              item_code: 'priority_compute_coupon', name: '优先计算券', icon_key: 'priority_compute_coupon',
              quantity: 1, expires_at: null, grant_ids: ['grant-0'],
            }],
          },
        }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    }

    await upsertItemGrantNotificationInTransaction(client as never, grantInput())

    const [statement, values] = client.query.mock.calls[2]
    expect(statement).toContain('read_at = null')
    expect(JSON.parse(values[3])).toMatchObject({ items: [{ quantity: 3, grant_ids: ['grant-0', 'grant-1'] }] })
  })

  it('lists a cursor page without exposing internal grant ids', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [storedNotification('notification-2'), storedNotification('notification-1')] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })

    const page = await listUserNotifications('user-1', { limit: 1 })

    expect(page.notifications).toHaveLength(1)
    expect(page.notifications[0]?.payload.items[0]).not.toHaveProperty('grant_ids')
    expect(page.unread_count).toBe(2)
    expect(page.next_cursor).toEqual(expect.any(String))
    expect(mocks.query.mock.calls[0]?.[0]).toContain('updated_at <= $3::timestamptz')
    expect(mocks.query.mock.calls[0]?.[0]).toContain('order by updated_at desc, id desc')
    expect(JSON.parse(Buffer.from(page.next_cursor!, 'base64url').toString('utf8'))).toEqual({
      asOf: '2026-07-30T00:01:00.000Z',
      updatedAt: '2026-07-30T00:00:02.000Z',
      id: 'notification-2',
    })
    expect(page.as_of).toBe('2026-07-30T00:01:00.000Z')
  })

  it('rejects unknown notification types and damaged payloads', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ ...storedNotification('notification-1'), type: 'future_type' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
    await expect(listUserNotifications('user-1')).rejects.toThrow('Invalid stored notification contract.')

    mocks.query
      .mockResolvedValueOnce({ rows: [{ ...storedNotification('notification-1'), payload_json: { kind: 'item_grant', items: [] } }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
    await expect(listUserNotifications('user-1')).rejects.toThrow('Invalid stored notification contract.')
  })

  it('marks owned notifications read and rejects unknown ids', async () => {
    mocks.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'notification-1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    await expect(markUserNotificationRead('user-1', 'notification-1')).resolves.toBe(0)

    mocks.query.mockResolvedValueOnce({ rowCount: 0, rows: [] })
    await expect(markUserNotificationRead('user-1', 'missing')).rejects.toMatchObject({
      code: 'notification_not_found',
      status: 404,
    })
  })

  it('marks all unread notifications and returns the authoritative count', async () => {
    mocks.query
      .mockResolvedValueOnce({ rowCount: 3, rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })

    await expect(markAllUserNotificationsRead('user-1')).resolves.toBe(1)
  })
})

function grantInput() {
  return {
    userId: 'user-1',
    grantId: 'grant-1',
    sourceType: 'campaign',
    sourceId: 'campaign-1',
    itemCode: 'priority_compute_coupon',
    itemName: '优先计算券',
    iconKey: 'priority_compute_coupon',
    quantity: 2,
    expiresAt: null,
    now: '2026-07-30T00:00:00.000Z',
  }
}

function storedNotification(id: string) {
  return {
    id,
    type: 'item_grant',
    title: '获得新道具',
    body: '优先计算券 ×1',
    action_kind: 'inventory',
    payload_json: {
      kind: 'item_grant',
      items: [{
        item_code: 'priority_compute_coupon', name: '优先计算券', icon_key: 'priority_compute_coupon',
        quantity: 1, expires_at: null, grant_ids: [`grant-${id}`],
      }],
    },
    read_at: null,
    created_at: '2026-07-30T00:00:00.000Z',
    updated_at: `2026-07-30T00:00:0${id.endsWith('2') ? '2' : '1'}.000Z`,
  }
}
