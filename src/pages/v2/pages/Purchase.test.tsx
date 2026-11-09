// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import { cloneDefaultPublicContentSettings } from '../../../lib/public-content'
import { DEFAULT_SITE_FEATURES } from '../../../lib/site-features'
import { usePublicContent } from '../../../lib/public-content-context'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import Purchase from './Purchase'

vi.mock('../../../lib/public-content-context', () => ({ usePublicContent: vi.fn() }))
vi.mock('../../../lib/site-feature-context', () => ({ useSiteFeatures: vi.fn() }))

const text = copy.public.purchase
let content = cloneDefaultPublicContentSettings()
const refresh = vi.fn(async () => undefined)
beforeEach(() => {
  content = cloneDefaultPublicContentSettings()
  content.cdk_purchase.qr_code_url = 'https://example.com/general-qr.png'
  content.pricing.plans.single_account_monthly.purchase_url = 'https://example.com/monthly'
  content.pricing.plans.single_account_monthly.qr_code_url = 'https://example.com/monthly-qr.png'
  vi.mocked(usePublicContent).mockReturnValue({ content, status: 'ready', isFallback: false, refresh })
  vi.mocked(useSiteFeatures).mockReturnValue({ status: 'ready', features: DEFAULT_SITE_FEATURES, updatedAt: null, retry: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function mount(query = '') {
  return render(<MemoryRouter initialEntries={[`/v2?section=purchase${query}`]}><Purchase /></MemoryRouter>)
}

it('uses the selected product link and QR without mixing in the general listing', () => {
  mount('&offer=single_account_monthly&profile_id=profile-1')
  expect(screen.getByRole('link', { name: text.back })).toHaveAttribute('href', '/v2?section=pricing&profile_id=profile-1')
  expect(screen.getByRole('link', { name: copy.public.pricing_redemption.action })).toHaveAttribute('href', '/v2?section=add-account&profile_id=profile-1&mode=cdk')
  expect(screen.getByRole('link', { name: text.open })).toHaveAttribute('href', 'https://example.com/monthly')
  expect(screen.getByRole('img', { name: text.qr_code })).toHaveAttribute('src', 'https://example.com/monthly-qr.png')
  expect(screen.queryByRole('img', { name: text.share_image })).not.toBeInTheDocument()
  expect(screen.getByText(content.pricing.plans.single_account_monthly.account_scope)).toBeVisible()
})

it.each(['single_account_annual', 'free_preview', 'https://example.com/injected'])('keeps an unavailable or unknown offer %s closed while leaving redemption accessible', (offer) => {
  mount(`&offer=${offer}`)
  expect(screen.getByText(text.unavailable)).toBeVisible()
  expect(screen.queryByRole('link', { name: text.open })).not.toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.public.pricing_redemption.action })).toBeInTheDocument()
})

it('allows a QR-only purchase and handles failed images without losing the original link', async () => {
  const user = userEvent.setup()
  content.cdk_purchase.xianyu_url = ''
  mount()
  expect(screen.queryByRole('link', { name: text.open })).not.toBeInTheDocument()
  fireEvent.error(screen.getByRole('img', { name: text.qr_code }))
  expect(screen.getByRole('alert')).toHaveTextContent(text.image_failed)
  expect(screen.getByRole('link', { name: new RegExp(`^${text.original}`) })).toHaveAttribute('href', content.cdk_purchase.qr_code_url)
  await user.click(screen.getByRole('button', { name: text.image_retry }))
  expect(screen.getByRole('img', { name: text.qr_code })).toBeVisible()
})

it('copies the selected link and provides manual copying when clipboard access fails', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  mount('&offer=single_account_monthly')
  await user.click(screen.getByRole('button', { name: text.copy }))
  expect(write).toHaveBeenCalledWith('https://example.com/monthly')
  expect(screen.getByRole('status')).toHaveTextContent(text.copied)
  write.mockRejectedValueOnce(new Error('denied'))
  await user.click(screen.getByRole('button', { name: text.copy }))
  expect(screen.getByRole('alert')).toHaveTextContent(text.copy_failed)
  await user.click(screen.getByText(text.show_link, { exact: true }))
  expect(screen.getByRole('textbox', { name: text.link })).toHaveValue('https://example.com/monthly')
})

it('retries failed content loads and respects disabled redemption', async () => {
  const user = userEvent.setup()
  vi.mocked(usePublicContent).mockReturnValue({ content, status: 'error', isFallback: true, refresh })
  vi.mocked(useSiteFeatures).mockReturnValue({ status: 'ready', features: { ...DEFAULT_SITE_FEATURES, cdk_redemption: false }, updatedAt: null, retry: vi.fn() })
  mount()
  expect(screen.queryByRole('link', { name: text.open })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.retry }))
  expect(refresh).toHaveBeenCalled()
  expect(screen.getByText(copy.public.pricing_redemption.unavailable)).toBeVisible()
  expect(screen.queryByRole('link', { name: copy.public.pricing_redemption.action })).not.toBeInTheDocument()
})
