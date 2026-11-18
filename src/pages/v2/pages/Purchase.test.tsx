// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import QRCode from 'qrcode'
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
  content.pricing.plans.single_account_monthly.purchase_url = 'https://example.com/monthly'
  vi.mocked(usePublicContent).mockReturnValue({ content, status: 'ready', isFallback: false, refresh })
  vi.mocked(useSiteFeatures).mockReturnValue({ status: 'ready', features: DEFAULT_SITE_FEATURES, updatedAt: null, retry: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function mount(query = '') {
  return render(<MemoryRouter initialEntries={[`/v2?section=purchase${query}`]}><Purchase /></MemoryRouter>)
}

it('generates a downloadable QR from the selected product link without mixing in the general listing', async () => {
  const generate = vi.spyOn(QRCode, 'toDataURL')
  mount('&offer=single_account_monthly&profile_id=profile-1')
  expect(screen.getByRole('link', { name: text.back })).toHaveAttribute('href', '/v2?section=pricing&profile_id=profile-1')
  expect(screen.getByRole('link', { name: text.redeem_action })).toHaveAttribute('href', '/v2?section=add-account&profile_id=profile-1&mode=cdk')
  expect(screen.getByRole('link', { name: text.open })).toHaveAttribute('href', 'https://example.com/monthly')
  const image = await screen.findByRole('img', { name: text.qr_code })
  expect(generate).toHaveBeenCalledWith('https://example.com/monthly', expect.any(Object))
  expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  expect(screen.getByRole('link', { name: text.qr_download })).toHaveAttribute('href', image.getAttribute('src'))
  expect(screen.getByRole('link', { name: text.qr_download })).toHaveAttribute('download', 'maatool-purchase.png')
  expect(screen.queryByRole('img', { name: text.share_image })).not.toBeInTheDocument()
  expect(screen.getByText(text.account_scope)).toBeVisible()
})

it.each(['single_account_annual', 'free_preview', 'https://example.com/injected'])('keeps an unavailable or unknown offer %s closed while leaving redemption accessible', (offer) => {
  mount(`&offer=${offer}`)
  expect(screen.getByText(text.unavailable)).toBeVisible()
  expect(screen.queryByRole('link', { name: text.open })).not.toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: text.redeem_action })).toBeInTheDocument()
})

it('keeps a share-image-only purchase available and retries failed images', async () => {
  const user = userEvent.setup()
  content.cdk_purchase.xianyu_url = ''
  content.cdk_purchase.share_image_url = 'https://example.com/share.png'
  mount()
  expect(screen.queryByRole('link', { name: text.open })).not.toBeInTheDocument()
  expect(screen.queryByRole('img', { name: text.qr_code })).not.toBeInTheDocument()
  fireEvent.error(screen.getByRole('img', { name: text.share_image }))
  expect(screen.getByRole('alert')).toHaveTextContent(text.image_failed)
  expect(screen.getByRole('link', { name: new RegExp(`^${text.original}`) })).toHaveAttribute('href', content.cdk_purchase.share_image_url)
  await user.click(screen.getByRole('button', { name: text.image_retry }))
  expect(screen.getByRole('img', { name: text.share_image })).toBeVisible()
})

it('retains the purchase link when QR generation fails and allows regeneration', async () => {
  const user = userEvent.setup()
  vi.spyOn(QRCode, 'toDataURL').mockRejectedValueOnce(new Error('generation failed'))
  mount('&offer=single_account_monthly')
  expect(await screen.findByRole('alert')).toHaveTextContent(text.qr_failed)
  expect(screen.getByRole('link', { name: text.open })).toHaveAttribute('href', 'https://example.com/monthly')
  await user.click(screen.getByRole('button', { name: text.qr_retry }))
  expect(await screen.findByRole('img', { name: text.qr_code })).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/))
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
  expect(screen.queryByRole('link', { name: text.redeem_action })).not.toBeInTheDocument()
})
