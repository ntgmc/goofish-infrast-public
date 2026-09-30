// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'
import { prepareResult } from './formatters'
import { downloadScheduleImage, renderScheduleImage } from './schedule-image'

const drawnText = vi.fn()
const drawnImage = vi.fn()
const encoded = vi.fn()
let imageRequests: string[] = []
let dimensions = { width: 0, height: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  imageRequests = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (value: string) => ({ width: [...value].length * 8 }),
    fillText: drawnText, drawImage: drawnImage,
    scale: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), save: vi.fn(), clip: vi.fn(), restore: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
    dimensions = { width: this.width, height: this.height }
    encoded()
    callback(new Blob(['png'], { type: 'image/png' }))
  })
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(value: string) {
      imageRequests.push(value)
      queueMicrotask(() => value.includes('missing') ? this.onerror?.() : this.onload?.())
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('schedule image exports', () => {
  it.each([
    ['v1', undefined, ['trade1', 'trade2', 'trade3']],
    ['v2', 1, ['trade2']],
    ['v2', undefined, ['trade1', 'trade2', 'trade3']],
  ] as const)('exports the complete requested scope for %s (shift %s)', async (version, planIndex, names) => {
    const { result, operators } = schedule()
    const prepared = prepareResult(result, false, false, operators)
    const blob = await renderScheduleImage({ prepared, version, planIndex, title: result.title, isRotationMode: false })
    expect(blob.type).toBe('image/png')
    const values = drawnText.mock.calls.map(([value]) => value)
    for (const name of ['trade1', 'trade2', 'trade3']) {
      expect(values.includes(name)).toBe(names.some((expected) => expected === name))
    }
    expect(values).toContain('shared')
    expect(imageRequests.filter((url) => url.includes('avatar')).length).toBe(1)
    expect(drawnImage).toHaveBeenCalled()
    expect(encoded).toHaveBeenCalledOnce()
    expect(dimensions.height).toBeGreaterThan(0)
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(16_000_000)
    expect(prepared.plans).toHaveLength(3)
  })

  it('retains names when portraits fail and excludes rotation dormitories and legacy Fiammetta targets', async () => {
    const { result, operators } = schedule()
    operators.forEach((operator) => { operator.id = 'missing' })
    result.plans[0].Fiammetta = { enable: true, target: 'legacy-target', order: 'pre' }
    result.plans[0].rooms.dormitory = [{ operators: ['dorm'] }]
    await renderScheduleImage({
      prepared: prepareResult(result, true, false, operators), version: 'v2', planIndex: 0,
      title: result.title, isRotationMode: true,
    })
    const values = drawnText.mock.calls.map(([value]) => value)
    expect(values).toContain('trade1')
    expect(values).not.toContain('dorm')
    expect(values.join(' ')).not.toContain('legacy-target')
    expect(drawnImage).not.toHaveBeenCalled()
  })

  it('keeps the last shift in long images within the canvas size limit', async () => {
    const { result } = schedule()
    result.plans = Array.from({ length: 120 }, (_, index) => ({
      name: `shift-${index}`, rooms: { trading: [{ operators: ['shared'], efficiency: 200 }] },
    }))
    const prepared = prepareResult(result, false, false)
    await renderScheduleImage({ prepared, version: 'v2', title: result.title, isRotationMode: false })
    expect(drawnText.mock.calls.map(([value]) => value)).toContain('shift-119')
    expect(dimensions.width).toBeLessThan(2400)
    expect(dimensions.height).toBeLessThanOrEqual(16384)
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(16_000_000)
  })

  it('downloads a PNG with the selected shift filename and rejects failed encoding', async () => {
    vi.useFakeTimers()
    const { result } = schedule()
    const options = { prepared: prepareResult(result, false, false), version: 'v2' as const, planIndex: 1, title: result.title, isRotationMode: false }
    const createObjectURL = vi.fn(() => 'blob:schedule')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('schedule-overview-v2-shift-2.png')
      expect(this.href).toBe('blob:schedule')
    })
    await downloadScheduleImage(options)
    vi.runAllTimers()
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:schedule')
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null))
    await expect(downloadScheduleImage(options)).rejects.toThrow('PNG encoding failed')
    expect(createObjectURL).toHaveBeenCalledOnce()
  })
})

function schedule(): { result: OptimizeResult; operators: LicenseOperator[] } {
  const result: OptimizeResult = {
    author: 'test', title: 'Three shifts', description: '', buildingType: 243, planTimes: '12h-6h-6h', raw_results: [],
    plans: [12, 6, 6].map((shift_hours, index) => ({
      name: `shift-${index + 1}`, shift_hours,
      rooms: { trading: [{ operators: ['shared', `trade${index + 1}`], product: 'LMD', efficiency: 200 }] },
    })),
  }
  const operators = ['shared', 'trade1', 'trade2', 'trade3'].map((name) => ({ id: 'avatar', name, own: true, elite: 2, rarity: 6 }))
  return { result, operators }
}
