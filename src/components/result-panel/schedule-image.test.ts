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
    drawnTextStyle(value, this.font, this.textAlign, this.textBaseline)
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (value: string) => ({ width: [...value].length * 8, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }),
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
    source = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(value: string) {
      this.source = value
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
    ['v2', false, undefined, []],
    ['v2', true, 0, ['SNIPER', 'PIONEER']],
    ['v2', true, undefined, ['SNIPER', 'PIONEER', 'CASTER']],
    ['v1', true, undefined, []],
  ] as const)('exports optional profession badges in %s (enabled %s, shift %s)', async (version, showProfession, planIndex, professions) => {
    const { result } = schedule()
    result.plans[0].rooms.trading[0].operators = ['能天使', '德克萨斯', '未知干员']
    result.plans[1].rooms.trading[0].operators = ['阿米娅']
    const prepared = prepareResult(result, false, false, [
      { id: 'char_103_angel', name: '能天使', own: true, elite: 2, rarity: 6 },
    ])
    await renderScheduleImage({ prepared, version, showProfession, planIndex, title: result.title, isRotationMode: false })
    expect(imageRequests.filter((url) => url.startsWith('/operator-professions/')))
      .toEqual(professions.map((profession) => `/operator-professions/${profession}.png`))
    const badges = drawnImage.mock.calls.filter(([image]) => image.source.startsWith('/operator-professions/'))
    expect(badges).toHaveLength(professions.length)
    for (const [, x, y, width, height] of badges) {
      expect(width).toBe(20)
      expect(height).toBe(20)
      expect(drawnRoundRect.mock.calls.some(([avatarX, avatarY, avatarWidth]) =>
        avatarWidth === 72 && x === avatarX + 50 && y === avatarY + 2)).toBe(true)
    }
  })

  it('exports successfully when a profession icon cannot load', async () => {
    const { result } = schedule()
    result.plans[0].rooms.trading[0].operators = ['能天使']
    failedImages = ['/operator-professions/SNIPER.png']
    const prepared = prepareResult(result, false, false)
    await expect(renderScheduleImage({ prepared, version: 'v2', showProfession: true, planIndex: 0, title: result.title, isRotationMode: false }))
      .resolves.toHaveProperty('type', 'image/png')
    expect(drawnImage.mock.calls.filter(([image]) => image.source.startsWith('/operator-professions/'))).toHaveLength(0)
  })

  it.each(['v1', 'v2'] as const)('exports dormitory recovery support marks in %s', async (version) => {
    const { result, operators } = schedule()
    result.dormitory_rule = 'maa_pure_autofill'
    result.plans[0].rooms.dormitory = [{
      operators: ['杜林', '恢复目标'], recovery_support_operators: ['杜林'], autofill: false,
    }]
    const prepared = prepareResult(result, false, false, operators)
    await renderScheduleImage({ prepared, version, planIndex: 0, title: result.title, isRotationMode: false })
    expect(drawnText.mock.calls.map(([value]) => value).join('')).not.toContain('恢复支援')
    expect(imageRequests).toContain('/building-skills/bskill_dorm_all&one1.png')
    const badgeSize = version === 'v1' ? 16 : 24
    expect(drawnImage.mock.calls.filter(([, , , width, height]) => width === badgeSize && height === badgeSize)).toHaveLength(1)
    expect(prepared.plans[0].rows.find((row) => row.roomType === 'dormitory')?.operators[0]).toMatchObject({
      name: '杜林', recoverySupport: true,
    })
  })

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
    expect(imageRequests).toContain('/assets/products/GOLD.png')
    expect(drawnImage).toHaveBeenCalled()
    expect(encoded).toHaveBeenCalledOnce()
    expect(dimensions.height).toBeGreaterThan(0)
    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(16_000_000)
    expect(prepared.plans).toHaveLength(3)
  })

  it.each(['v1', 'v2'] as const)('aligns headers and names with compact portraits in %s', async (version) => {
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
    expect(product[2]).toBe(title[2] + 15)
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
    if (version === 'v1') {
      expect(portraits[1].center).toBe(cards[0][0] + cards[0][2] / 2)
      expect(portraits[3].center).toBe(cards[1][0] + cards[1][2] / 2)
    } else {
      expect(cards[0][2]).toBeGreaterThan(cards[1][2])
      expect(avatarDraws[0][1]).toBe(cards[0][0] + 28)
      expect(avatarDraws[3][1]).toBe(cards[1][0] + 28)
    }
    for (const [index, name] of ['shared', 'trade1', 'trade2'].entries()) {
      expect(drawnText.mock.calls.find(([value]) => value === name)?.[1]).toBe(portraits[index].center)
      expect(drawnTextStyle.mock.calls.find(([value]) => value === name)?.[2]).toBe('center')
    }
  })

  it.each(['v1', 'v2'] as const)('keeps %s product icons clear of wrapped room titles, drone markers and portraits', async (version) => {
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
    await renderScheduleImage({ prepared, version, title: result.title, isRotationMode: false })
    const card = drawnRoundRect.mock.calls.find(([, , width]) => width > 100)!
    const [, iconX, iconY, iconWidth, iconHeight] = drawnImage.mock.calls.find(([, , , width]) => width === 20)!
    const product = drawnText.mock.calls.find(([value]) => value === '源石碎片')!
    const titleLines = drawnText.mock.calls.filter(([, x]) => x === card[0] + 28)
    expect(imageRequests).toContain('/assets/products/MTL_DIAMOND_SHD.png')
    expect(titleLines.length).toBeGreaterThan(1)
    expect(product[1]).toBe(card[0] + card[2] - 56)
    expect(iconX + iconWidth + 4).toBe(product[1] - '源石碎片'.length * 8)
    expect(iconY + iconHeight / 2).toBe(product[2] - (12 - 4) / 2)
    expect(drawnTextStyle.mock.calls.find(([value]) => value === '源石碎片')?.[3]).toBe('alphabetic')
    for (const [value, x] of titleLines) {
      expect(x + value.length * 8).toBeLessThan(iconX)
    }
    const efficiency = drawnText.mock.calls.find(([value]) => value === prepared.plans[0].rows[0].efficiency)!
    expect(iconY + iconHeight).toBeLessThanOrEqual(efficiency[2])
    const portraits = drawnImage.mock.calls.filter(([, , , width]) => width > 20)
    expect(portraits).toHaveLength(3)
    expect(portraits.every(([, , y]) => y > titleLines[titleLines.length - 1][2] + 22)).toBe(true)
  })

  it('exports the icons for every product in a v1 facility across shifts', async () => {
    const { result, operators } = schedule()
    const products = ['Pure Gold', 'Battle Record', 'Originium Shard']
    result.plans.forEach((plan, index) => {
      plan.rooms = { manufacture: [{ operators: ['shared'], product: products[index], efficiency: 200 }] }
    })
    await renderScheduleImage({
      prepared: prepareResult(result, false, false, operators),
      version: 'v1', title: result.title, isRotationMode: false,
    })
    expect(imageRequests).toEqual(expect.arrayContaining([
      '/assets/products/MTL_GOLD3.png',
      '/assets/products/sprite_exp_card_t3.png',
      '/assets/products/MTL_DIAMOND_SHD.png',
    ]))
    const icons = drawnImage.mock.calls.filter(([, , , width]) => width === 20)
    const product = drawnText.mock.calls.find(([value]) => value === '多产物')!
    expect(icons).toHaveLength(3)
    expect(icons[1][1] - icons[0][1]).toBe(24)
    expect(icons[2][1] - icons[1][1]).toBe(24)
    expect(icons[2][1] + 24).toBe(product[1] - '多产物'.length * 8)
    expect(icons.every(([, , y]) => y + 10 === product[2] - (12 - 4) / 2)).toBe(true)
  })

  it.each(['v1', 'v2'] as const)('exports complete %s product labels and names when a product icon fails to load', async (version) => {
    const { result, operators } = schedule()
    failedImages = ['/assets/products/GOLD.png']
    await renderScheduleImage({
      prepared: prepareResult(result, false, false, operators),
      version, planIndex: 0, title: result.title, isRotationMode: false,
    })
    expect(imageRequests).toContain('/assets/products/GOLD.png')
    expect(drawnText.mock.calls.map(([value]) => value)).toEqual(expect.arrayContaining(['龙门币', 'shared', 'trade1']))
    expect(drawnImage.mock.calls.filter(([, , , width]) => width === 20)).toHaveLength(0)
    expect(encoded).toHaveBeenCalledOnce()
  })

  it('packs five-, three- and one-operator facilities in order without overlapping cards or clipped names', async () => {
    const { result, operators } = schedule()
    const longName = '长干员名'.repeat(8)
    operators.push({ id: 'avatar', name: longName, own: true, elite: 2, rarity: 6 })
    result.plans = [{
      name: 'compact',
      rooms: {
        control: [{ operators: [longName, 'shared', 'trade1', 'trade2', 'trade3'] }],
        manufacture: [
          { operators: ['shared', 'trade1', 'trade2'], product: 'Battle Record', efficiency: 200 },
          { operators: ['shared', 'trade1', 'trade2'], product: 'Pure Gold', efficiency: 210 },
        ],
        power: [
          { operators: ['shared'], efficiency: 20 },
          { operators: [] },
          { operators: ['trade1'], efficiency: 20 },
        ],
      },
    }]
    await renderScheduleImage({ prepared: prepareResult(result, false, false, operators), version: 'v2', title: result.title, isRotationMode: false })
    const cards = drawnRoundRect.mock.calls.filter(([, , width]) => width > 100)
    expect(cards).toHaveLength(6)
    expect(cards[0][2]).toBe(560)
    expect(cards[1][2]).toBe(368)
    expect(cards[3][2]).toBe(176)
    expect(cards[0][3]).toBeGreaterThan(cards[1][3])
    expect(cards[0][1]).toBe(cards[1][1])
    expect(cards[2][1]).toBeGreaterThan(cards[1][1])
    const facilityNames = ['控制中枢', '制造站 1', '制造站 2', '发电站 1', '发电站 2', '发电站 3']
    const facilityTitles = drawnText.mock.calls.filter(([value]) => facilityNames.includes(value))
    expect(facilityTitles.map(([value]) => value)).toEqual(facilityNames)
    for (let index = 1; index < facilityTitles.length; index += 1) {
      const [, x, y] = facilityTitles[index]
      const [, previousX, previousY] = facilityTitles[index - 1]
      expect(y > previousY || (y === previousY && x > previousX)).toBe(true)
    }
    const controlTitle = drawnText.mock.calls.find(([value]) => value === '控制中枢')!
    expect(drawnImage.mock.calls.find(([, , , width]) => width === 72)![2] - controlTitle[2]).toBe(30)
    for (const [index, [x, y, width, height]] of cards.entries()) {
      expect(x + width).toBeLessThanOrEqual(1168)
      for (const [otherX, otherY, otherWidth, otherHeight] of cards.slice(index + 1)) {
        expect(x + width + 16 <= otherX || otherX + otherWidth + 16 <= x || y + height + 16 <= otherY || otherY + otherHeight + 16 <= y).toBe(true)
      }
    }
    for (const [, x, y, width, height] of drawnImage.mock.calls) {
      expect(cards.some(([cardX, cardY, cardWidth, cardHeight]) => x >= cardX + 16 && y >= cardY + 16 && x + width <= cardX + cardWidth - 16 && y + height <= cardY + cardHeight - 16)).toBe(true)
    }
    const nameLines = drawnText.mock.calls.filter(([, x, y]) => x === cards[0][0] + 64 && y > cards[0][1] + 72 && y < cards[0][1] + cards[0][3])
    expect(nameLines.length).toBeGreaterThan(1)
    expect(nameLines.map(([value]) => value).join('')).toBe(longName)
    expect(nameLines[nameLines.length - 1][2] + 18).toBe(cards[0][1] + cards[0][3] - 16)
  })

  it('removes the empty efficiency line from manual v2 cards', async () => {
    const { result, operators } = schedule()
    result.plans = [{ name: 'manual', rooms: { power: [{ operators: ['shared'], efficiency: 20 }] } }]
    await renderScheduleImage({ prepared: prepareResult(result, false, false, operators), version: 'v2', title: result.title, isRotationMode: false, manual: true })
    const card = drawnRoundRect.mock.calls.find(([, , width]) => width > 100)!
    const portrait = drawnImage.mock.calls.find(([, , , width]) => width === 72)!
    const title = drawnText.mock.calls.find(([value]) => value === '发电站')!
    const name = drawnText.mock.calls.find(([value]) => value === 'shared')!
    expect(portrait[2] - title[2]).toBe(30)
    expect(name[2] + 18).toBe(card[1] + card[3] - 16)
    expect(drawnText.mock.calls.map(([value]) => value)).not.toContain('20.0%')
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
