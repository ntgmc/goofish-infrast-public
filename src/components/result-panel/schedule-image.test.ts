// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'
import { prepareResult } from './formatters'
import { downloadScheduleImage, renderScheduleImage } from './schedule-image'

const drawnText = vi.fn()
const drawnTextStyle = vi.fn()
const drawnImage = vi.fn()
const drawnRoundRect = vi.fn()
const encoded = vi.fn()
let imageRequests: string[] = []
let failedImages: string[] = []
let dimensions = { width: 0, height: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  imageRequests = []
  failedImages = []
  drawnText.mockImplementation(function (this: CanvasRenderingContext2D, value: string) {
    drawnTextStyle(value, this.font, this.textAlign)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (value: string) => ({ width: [...value].length * 8 }),
    fillText: drawnText, drawImage: drawnImage,
    scale: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), roundRect: drawnRoundRect,
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
      queueMicrotask(() => value.includes('missing') || failedImages.includes(value) ? this.onerror?.() : this.onload?.())
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
    expect(imageRequests.includes('/assets/products/GOLD.png')).toBe(version === 'v2')
    expect(drawnImage).toHaveBeenCalled()
    expect(encoded).toHaveBeenCalledOnce()
    expect(dimensions.height).toBeGreaterThan(0)
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(16_000_000)
    expect(prepared.plans).toHaveLength(3)
  })

  it.each(['v1', 'v2'] as const)('aligns production headers and efficiency with compact centered portraits in %s', async (version) => {
    const { result, operators } = schedule()
    result.plans = [{
      name: 'day',
      rooms: {
        manufacture: [{ operators: ['shared', 'trade1', 'trade2'], product: 'Pure Gold', efficiency: 200 }],
        power: [{ operators: ['shared'], efficiency: 20 }],
      },
    }]
    const prepared = prepareResult(result, false, false, operators)
    const manufacture = prepared.plans[0].rows.find((row) => row.roomType === 'manufacture')!
    await renderScheduleImage({ prepared, version, title: result.title, isRotationMode: false })

    const cards = drawnRoundRect.mock.calls.filter(([, , width]) => width > 100)
    expect(cards).toHaveLength(2)
    expect(cards[0][1]).toBe(cards[1][1])
    expect(cards[0][3]).toBe(cards[1][3])
    const title = drawnText.mock.calls.find(([value]) => value === manufacture.label)!
    const product = drawnText.mock.calls.find(([value]) => value === manufacture.product)!
    expect(product[2]).toBe(title[2])
    expect(product[1]).toBeGreaterThan(title[1])
    const productStyle = drawnTextStyle.mock.calls.find(([value]) => value === manufacture.product)!
    expect(productStyle[1]).toContain('16px')
    expect(productStyle[2]).toBe('right')

    const efficiency = drawnText.mock.calls.find(([value]) => value === manufacture.efficiency)!
    expect(efficiency[1]).toBe(cards[0][0] + cards[0][2] - 16)
    expect(drawnTextStyle.mock.calls.find(([value]) => value === manufacture.efficiency)?.[2]).toBe('right')
    const avatarDraws = drawnImage.mock.calls.filter(([, , , width]) => width > 20)
    const portraits = avatarDraws.map(([, x, y, width]) => ({ center: x + width / 2, y }))
    expect(portraits).toHaveLength(4)
    expect(portraits.every((portrait) => portrait.y === portraits[0].y)).toBe(true)
    expect(efficiency[2]).toBeLessThan(portraits[0].y)
    expect(portraits[1].center - portraits[0].center).toBeCloseTo(portraits[2].center - portraits[1].center)
    expect(portraits[1].center - portraits[0].center - avatarDraws[0][3]).toBeLessThanOrEqual(24)
    expect(portraits[1].center).toBe(cards[0][0] + cards[0][2] / 2)
    expect(portraits[3].center).toBe(cards[1][0] + cards[1][2] / 2)
    for (const [index, name] of ['shared', 'trade1', 'trade2'].entries()) {
      expect(drawnText.mock.calls.find(([value]) => value === name)?.[1]).toBe(portraits[index].center)
      expect(drawnTextStyle.mock.calls.find(([value]) => value === name)?.[2]).toBe('center')
    }
  })

  it('keeps v2 product icons clear of wrapped room titles, drone markers and portraits', async () => {
    const { result, operators } = schedule()
    result.plans = [{
      name: 'test',
      rooms: {
        manufacture: [{ operators: ['shared', 'trade1', 'trade2'], product: 'Originium Shard', efficiency: 200, level: 3 }],
      },
      drones: { enable: true, room: 'manufacture', index: 1, order: 'pre' },
    }]
    const prepared = prepareResult(result, false, false, operators)
    prepared.plans[0].rows[0].label = '制造站'.repeat(12)
    await renderScheduleImage({ prepared, version: 'v2', title: result.title, isRotationMode: false })
    const card = drawnRoundRect.mock.calls.find(([, , width]) => width > 100)!
    const [, iconX, iconY, iconWidth, iconHeight] = drawnImage.mock.calls.find(([, , , width]) => width === 20)!
    const product = drawnText.mock.calls.find(([value]) => value === '源石碎片')!
    const titleLines = drawnText.mock.calls.filter(([, x, y]) => x === card[0] + 28 && y >= card[1] + 16 && y <= card[1] + 38)
    expect(imageRequests).toContain('/assets/products/MTL_DIAMOND_SHD.png')
    expect(titleLines).toHaveLength(2)
    expect(product[1]).toBe(card[0] + card[2] - 56)
    expect(iconX + iconWidth + 4).toBe(product[1] - '源石碎片'.length * 8)
    expect(iconY).toBe(product[2])
    for (const [value, x] of titleLines) {
      expect(x + value.length * 8).toBeLessThan(iconX)
    }
    const efficiency = drawnText.mock.calls.find(([value]) => value === prepared.plans[0].rows[0].efficiency)!
    expect(iconY + iconHeight).toBeLessThanOrEqual(efficiency[2])
    const portraits = drawnImage.mock.calls.filter(([, , , width]) => width === 72)
    expect(portraits).toHaveLength(3)
    expect(portraits.every(([, , y]) => y > titleLines[1][2] + 22)).toBe(true)
  })

  it('exports complete product labels and names when a product icon fails to load', async () => {
    const { result, operators } = schedule()
    failedImages = ['/assets/products/GOLD.png']
    await renderScheduleImage({
      prepared: prepareResult(result, false, false, operators),
      version: 'v2', planIndex: 0, title: result.title, isRotationMode: false,
    })
    expect(imageRequests).toContain('/assets/products/GOLD.png')
    expect(drawnText.mock.calls.map(([value]) => value)).toEqual(expect.arrayContaining(['龙门币', 'shared', 'trade1']))
    expect(drawnImage.mock.calls.filter(([, , , width]) => width === 20)).toHaveLength(0)
    expect(encoded).toHaveBeenCalledOnce()
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
    expect(drawnImage.mock.calls.filter(([, , , width]) => width > 20)).toHaveLength(0)
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
