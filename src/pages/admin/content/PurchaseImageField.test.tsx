// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IMAGE_UPLOAD_MAX_BYTES } from '../../../lib/image-upload'
import PurchaseImageField from './PurchaseImageField'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson: api }))
const busy = vi.fn()
function Field() {
  const [value, setValue] = useState('https://example.com/original.png')
  return <PurchaseImageField label="购买二维码" value={value} onChange={setValue} onUploadingChange={busy}><input aria-label="地址" value={value} onChange={(event) => setValue(event.target.value)} /></PurchaseImageField>
}
beforeEach(() => { api.mockReset(); busy.mockClear() })
afterEach(cleanup)
it('keeps the previous image when upload fails, then supports retry and removal', async () => {
  const user = userEvent.setup()
  api.mockRejectedValueOnce(new Error('暂时无法上传'))
  render(<Field />)
  const file = new File(['image'], 'qr.png', { type: 'image/png' })
  await user.upload(screen.getByLabelText('购买二维码 · 上传图片'), file)
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法上传')
  expect(screen.getByLabelText('地址')).toHaveValue('https://example.com/original.png')
  const url = `/api/site/public-content-image?id=${'a'.repeat(64)}`
  api.mockResolvedValueOnce({ url })
  await user.upload(screen.getByLabelText('购买二维码 · 上传图片'), file)
  expect(await screen.findByRole('status')).toHaveTextContent('图片已上传')
  expect(screen.getByLabelText('地址')).toHaveValue(url)
  expect(busy.mock.calls).toEqual([[true], [false], [true], [false]])
  await user.click(screen.getByRole('button', { name: '移除图片' }))
  expect(screen.getByLabelText('地址')).toHaveValue('')
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})
it.each([
  new File(['<svg/>'], 'qr.svg', { type: 'image/svg+xml' }),
  new File([new Uint8Array(IMAGE_UPLOAD_MAX_BYTES + 1)], 'large.png', { type: 'image/png' }),
  new File([], 'empty.png', { type: 'image/png' }),
])('rejects unsupported, empty and oversized files before upload', async (file) => {
  const user = userEvent.setup({ applyAccept: false })
  render(<Field />)
  await user.upload(screen.getByLabelText('购买二维码 · 上传图片'), file)
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(api).not.toHaveBeenCalled()
  expect(screen.getByLabelText('地址')).toHaveValue('https://example.com/original.png')
})
