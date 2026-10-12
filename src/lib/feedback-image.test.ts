// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareFeedbackImage } from './feedback-image'
import { FEEDBACK_IMAGE_MAX_BYTES, FEEDBACK_SOURCE_IMAGE_MAX_BYTES } from './feedback-contracts'
import { copy } from '../copy'

const close = vi.fn()
beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('feedback image preparation', () => {
  it('preserves a valid small image', async () => {
    const result = await prepareFeedbackImage(new File(['png'], 'shot.png', { type: 'image/png' }))
    expect(result).toMatchObject({ image: { type: 'image/png', base64: 'cG5n' }, bytes: 3, compressed: false })
    expect(close).toHaveBeenCalled()
  })
  it('shrinks repeatedly until the encoded image fits the upload limit', async () => {
    const dimensions: number[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
      dimensions.push(this.width)
      callback(new Blob([new Uint8Array(dimensions.length === 1 ? FEEDBACK_IMAGE_MAX_BYTES + 1 : 500)], { type: 'image/jpeg' }))
    })
    const result = await prepareFeedbackImage(new File([new Uint8Array(FEEDBACK_IMAGE_MAX_BYTES + 1)], 'shot.png', { type: 'image/png' }))
    expect(result).toMatchObject({ image: { type: 'image/jpeg' }, bytes: 500, compressed: true })
    expect(dimensions).toEqual([2048, 1536])
  })
  it('rejects images that still exceed the limit after compression', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob([new Uint8Array(FEEDBACK_IMAGE_MAX_BYTES + 1)], { type: 'image/jpeg' })))
    await expect(prepareFeedbackImage(new File([new Uint8Array(FEEDBACK_IMAGE_MAX_BYTES + 1)], 'shot.png', { type: 'image/png' }))).rejects.toThrow(copy.feedback.imageTooLarge)
    expect(close).toHaveBeenCalled()
  })
  it('rejects oversized originals and unsafe file types before decoding', async () => {
    await expect(prepareFeedbackImage(new File([new Uint8Array(FEEDBACK_SOURCE_IMAGE_MAX_BYTES + 1)], 'shot.png', { type: 'image/png' }))).rejects.toThrow(copy.feedback.sourceTooLarge)
    await expect(prepareFeedbackImage(new File(['<svg/>'], 'shot.svg', { type: 'image/svg+xml' }))).rejects.toThrow(copy.feedback.invalidImage)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })
  it('reports image decoding and encoding failures', async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode'))
    await expect(prepareFeedbackImage(new File(['bad'], 'shot.png', { type: 'image/png' }))).rejects.toThrow(copy.feedback.invalidImage)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null))
    await expect(prepareFeedbackImage(new File([new Uint8Array(FEEDBACK_IMAGE_MAX_BYTES + 1)], 'shot.png', { type: 'image/png' }))).rejects.toThrow(copy.feedback.imageProcessingFailed)
  })
})
