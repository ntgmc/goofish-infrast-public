// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import type { V2Session } from '../OptionsDrawer'
import Inventory from './Inventory'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../../lib/api-client', () => ({ apiJson: mocks.api, getApiErrorMessage: (error: Error) => error.message }))
vi.mock('../../../lib/site-feature-context', () => ({ useSiteFeatures: () => ({ features: { onboarding_tasks: false } }) }))
vi.mock('../../../components/SklandBindingDialog', () => ({ default: () => null }))

afterEach(() => { cleanup(); vi.resetAllMocks() })

it('keeps a failed item use open and reuses its idempotency key when retried from V2', async () => {
  const stack = { stack_id: 'gift', quantity: 2, permanent: 2, next_expiry_at: null, expiry_buckets: [{ quantity: 2, expires_at: null }], actions: ['open'], item: { code: 'gift', kind: 'gift_pack', name: '测试礼包', description: '领取礼包道具', icon_key: 'placeholder' } }
  const requests: Array<{ quantity: number; idempotency_key: string }> = []
  mocks.api.mockImplementation(async (_url: string, options?: { method?: string; json?: typeof requests[number] }) => {
    if (options?.method === 'POST') {
      requests.push(options.json!)
      if (requests.length === 1) throw new Error('请重试')
      return { rewards: [] }
    }
    return { stacks: [stack], capacities: [], recent_events: [] }
  })
  const user = userEvent.setup()
  render(<Inventory session={{ applyAuthPayload: vi.fn() } as unknown as V2Session} onProfiles={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: /测试礼包/ }))
  const dialog = within(screen.getByRole('dialog'))
  const quantity = dialog.getByRole('spinbutton', { name: copy.inventory.use_quantity })
  await user.clear(quantity)
  await user.type(quantity, '2')
  await user.click(dialog.getByRole('button', { name: copy.inventory.open }))
  expect(await dialog.findByRole('alert')).toHaveTextContent('请重试')
  expect(quantity).toHaveValue(2)
  await user.click(dialog.getByRole('button', { name: copy.inventory.open }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(requests).toHaveLength(2)
  expect(requests[0].quantity).toBe(2)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[0].idempotency_key).toBeTruthy()
})
