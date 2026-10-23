import { copy } from '../../copy/index'
import { buildBoardRoomGroups, buildBoardSlots } from './ResultBoard'
import { buildBoardV2Rooms } from './ResultBoardV2'
import { formatCompactNumber, type PreparedResult } from './formatters'
import { ROOM_LABELS } from './labels'
import type { PreparedPlan, RoomRow } from './types'
import { isDroneTarget } from './DroneMarker'
import { getProductIconSrc } from '../ProductIcon'
import { operatorProfession, RECOVERY_SUPPORT_ICON_SRC } from './building-skills'

type ImageOptions = {
  prepared: PreparedResult;
  isRotationMode: boolean;
  version: 'v1' | 'v2';
  title: string;
  planIndex?: number;
  shiftHours?: number[];
  manual?: boolean;
  showProfession?: boolean;
}
type ImageCard = {
  key: string;
  title: string;
  product: string;
  products: string[];
  roomType: string;
  drone: boolean;
  slots: Array<{ label: string; row?: RoomRow }>;
}
type Placement = {
  card: ImageCard;
  x: number;
  y: number;
  width: number;
  height: number;
  headerHeight: number;
  slotHeights: number[];
  slotMetaHeights: number[];
}

const WIDTH = 1760
const MARGIN = 32
const GAP = 12
const FLOOR_GUTTER = 32
const SHAFT = 20
const DORM_WIDTH = 432
const ROOM_WIDTH = (WIDTH - MARGIN * 2 - FLOOR_GUTTER - DORM_WIDTH - GAP * 4 - SHAFT * 2) / 4
const FONT_SIZE = 14
const AVATAR_SIZE = 72
const TILE_WIDTH = 80
const BADGE_SIZE = 16
const HEADER_INSET = 12
const SLOT_GAP = 12
const PRODUCTION_TYPES = ['trading', 'manufacture', 'power']
const SUPPORT_TYPES = ['meeting', 'processing', 'hire', 'training', 'recycling']

export async function downloadScheduleImage(options: ImageOptions): Promise<void> {
  const blob = await renderScheduleImage(options)
  const suffix = options.version === 'v1' ? 'long' : options.planIndex === undefined ? 'all-shifts' : `shift-${options.planIndex + 1}`
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `schedule-overview-${options.version}-${suffix}.png`
  try {
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export async function renderScheduleImage({ prepared, isRotationMode, version, title, planIndex, shiftHours, manual = false, showProfession = false }: ImageOptions): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  const ctx = context
  const themeRoot = document.querySelector('.v2-app') ?? document.body
  const fontFamily = getComputedStyle(themeRoot).fontFamily || 'sans-serif'
  const plans = version === 'v2' && planIndex !== undefined ? prepared.plans.slice(planIndex, planIndex + 1) : prepared.plans
  if (plans.length === 0) throw new Error('No schedule to export')
  const colors = readThemeColors(themeRoot)
  const allText = plans.flatMap((plan) => plan.rows.map((row) => `${row.label} ${row.operatorText}`)).join(' ')
  if (document.fonts) await Promise.all([
    document.fonts.load(`500 ${FONT_SIZE}px ${fontFamily}`, `${title} ${allText}`),
    document.fonts.load(`600 16px ${fontFamily}`, allText),
    document.fonts.load(`700 32px ${fontFamily}`, title),
  ])
  const images = new Map(await Promise.all([...new Set(plans.flatMap((plan) =>
    plan.rows.flatMap((row) => row.operators.flatMap((operator) => operator.id ? [operator.id] : [])),
  ))].map(async (id) => [id, await loadImage(`/webp96/${encodeURIComponent(id)}.webp`)] as const)))
  const recoverySupportIcon = plans.some((plan) => plan.rows.some((row) => row.operators.some((operator) => operator.recoverySupport)))
    ? await loadImage(RECOVERY_SUPPORT_ICON_SRC) : null
  const professions = version === 'v2' && showProfession
    ? [...new Set(plans.flatMap((plan) => plan.rows.flatMap((row) => row.operators.flatMap((operator) => {
      const profession = operatorProfession(operator)
      return profession ? [profession] : []
    }))))] : []
  const professionIcons = new Map(await Promise.all(professions.map(async (profession) =>
    [profession, await loadImage(`/operator-professions/${profession}.png`)] as const)))

  function lines(value: string, width: number, size = FONT_SIZE, weight = 500): string[] {
    ctx.font = `${weight} ${size}px ${fontFamily}`
    const output: string[] = []
    let line = ''
    for (const character of value) {
      if (character === '\n' || (line && ctx.measureText(line + character).width > width)) {
        output.push(line)
        line = character === '\n' ? '' : character
      } else line += character
    }
    output.push(line)
    return output
  }

  function text(value: string, x: number, y: number, width: number, color: string, size = FONT_SIZE, weight = 500, align: CanvasTextAlign = 'left'): number {
    const wrapped = lines(value, width, size, weight)
    ctx.fillStyle = color
    ctx.textBaseline = 'top'
    ctx.textAlign = align
    wrapped.forEach((line, index) => ctx.fillText(line, x, y + index * (size + 6)))
    return wrapped.length * (size + 6)
  }

  function rule(x: number, y: number, width: number, color = colors.border) {
    ctx.fillStyle = color
    ctx.fillRect(x, y, width, 1)
  }
  function hasEfficiency(row?: RoomRow): boolean {
    return !manual && Boolean(row && !row.isAutofill && row.efficiency !== '-' && PRODUCTION_TYPES.includes(row.roomType))
  }
  function titleWidth(width: number): number {
    // Keep the same title and portrait alignment whether efficiency is present or absent.
    return width - 32 - (version === 'v2' ? 88 : 0)
  }
  function headerHeight(card: ImageCard, width: number): number {
    const titleHeight = lines(card.title, titleWidth(width), 16, 600).length * 22
    const iconWidth = cardProductImages(card).length * 20
    const productHeight = card.product === '-' ? 20 : lines(card.product, width - 32 - iconWidth - 24, 12).length * 18
    return HEADER_INSET + titleHeight + 4 + productHeight + HEADER_INSET
  }
  function tilesPerRow(width: number): number {
    return Math.max(1, Math.floor((width - 32) / TILE_WIDTH))
  }
  function slotMetaHeight(slot: ImageCard['slots'][number], width: number): number {
    return version === 'v1' ? Math.max(24, lines(slot.label, width - 32 - 88, 12).length * 18 + 6) : 0
  }
  function slotHeight(slot: ImageCard['slots'][number], width: number): number {
    const row = slot.row
    const metaHeight = slotMetaHeight(slot, width)
    if (!row || row.isAutofill || row.operators.length === 0) {
      return metaHeight + Math.max(96, lines(row?.operatorText ?? copy.domain.result_board_v2.empty_room, width - 32).length * 20)
    }
    if (row.operators.length === 1) {
      return metaHeight + Math.max(96, lines(row.operators[0].name, width - 32 - AVATAR_SIZE - GAP).length * 20)
    }
    let height = metaHeight
    for (let index = 0; index < row.operators.length; index += tilesPerRow(width)) {
      const operators = row.operators.slice(index, index + tilesPerRow(width))
      const tileWidth = (width - 32) / operators.length
      const nameLines = Math.max(...operators.map((operator) => lines(operator.name, tileWidth - 4).length))
      height += AVATAR_SIZE + 4 + nameLines * 20 + 8
    }
    return height
  }
  function cardProductImages(card: ImageCard): HTMLImageElement[] {
    return card.products.map((product) => productImages.get(product))
      .filter((image): image is HTMLImageElement => Boolean(image))
  }
  function planLabel(plan: PreparedPlan, index: number): string {
    const hours = plan.shift_hours ?? shiftHours?.[index]
    return `${plan.name?.trim() || copy.domain.result_board_v2.shift(index + 1)}${typeof hours === 'number' && hours > 0 ? ` · ${formatCompactNumber(hours)}h` : ''}`
  }
  function planNote(plan: PreparedPlan): string {
    const notes: string[] = []
    const target = plan.Fiammetta?.enable ? plan.Fiammetta.target?.trim() : ''
    if (!isRotationMode && target) notes.push(`${copy.domain.components_result_panel_ResultBoard_017}${target}`)
    if (plan.drones?.enable) notes.push(`${copy.domain.components_result_panel_DroneSummary_002} · ${ROOM_LABELS[plan.drones.room] ?? plan.drones.room} ${plan.drones.index}`)
    return notes.join(' · ')
  }

  const sections = version === 'v1' ? [{
    title: copy.domain.result_image.all_shifts,
    note: plans.map((plan, index) => `${planLabel(plan, index)}${planNote(plan) ? ` · ${planNote(plan)}` : ''}`).join('\n'),
    cards: buildBoardRoomGroups(plans, isRotationMode).map((group): ImageCard => ({
      key: group.key,
      title: `${group.label}${group.indexLabel ? ` ${group.indexLabel}` : ''}`,
      product: group.product,
      products: Array.from(new Set(group.rows.map((row) => row.product))),
      roomType: group.roomType,
      drone: plans.some((plan) => isDroneTarget(plan.drones, group.roomType, group.rows[0].roomIndex)),
      slots: buildBoardSlots(group.rows, prepared.detailStats.planCount, isRotationMode),
    })),
  }] : plans.map((plan, index) => ({
    title: planLabel(plan, planIndex ?? index),
    note: planNote(plan),
    cards: buildBoardV2Rooms(plan, isRotationMode).map((room): ImageCard => ({
      key: room.key,
      title: `${room.label}${room.indexLabel ? ` ${room.indexLabel}` : ''}`,
      product: room.product,
      products: [room.product],
      roomType: room.roomType,
      drone: isDroneTarget(plan.drones, room.roomType, room.roomIndex),
      slots: [{ label: '', row: room.row }],
    })),
  }))
  const productImages = new Map(await Promise.all(
    [...new Set(sections.flatMap((section) => section.cards.flatMap((card) => card.products)))]
      .flatMap((product) => {
        const src = getProductIconSrc(product)
        return src ? [[product, src] as const] : []
      })
      .map(async ([product, src]) => [product, await loadImage(src)] as const),
  ))
  const productionKeys = [...new Set(sections.flatMap((section) => section.cards.filter((card) => PRODUCTION_TYPES.includes(card.roomType)).map((card) => card.key)))]
    .sort((a, b) => PRODUCTION_TYPES.indexOf(a.split('-')[0]) - PRODUCTION_TYPES.indexOf(b.split('-')[0]) || Number(a.split('-')[1]) - Number(b.split('-')[1]))
  const productionLayout = prepared.facilityLayout?.map((id) => id.replace(/_(\d+)$/, (_, index: string) => `-${Number(index) - 1}`)) ?? productionKeys
  const columnWidths = [ROOM_WIDTH, ROOM_WIDTH, ROOM_WIDTH, DORM_WIDTH, ROOM_WIDTH]
  const columnX = columnWidths.map((_, column) => MARGIN + FLOOR_GUTTER
    + columnWidths.slice(0, column).reduce((sum, width) => sum + width + GAP, 0) + (column >= 3 ? SHAFT : 0) + (column >= 4 ? SHAFT : 0))
  const placements: Placement[] = []
  const floorLabels: Array<{ value: string; y: number }> = []
  const headings: Array<{ value: string; y: number; note: string; width: number }> = []
  const heading = title.trim() || copy.domain.result_image.title
  const mode = isRotationMode ? copy.domain.components_result_panel_ResultBoard_001 : copy.domain.components_result_panel_ResultBoard_002
  const subtitle = `${copy.domain.result_image.title} · ${manual
    ? prepared.hasDailyProduction ? copy.domain.manual_schedule.simulation_image : copy.domain.manual_schedule.pending
    : mode}${!prepared.facilityLayout && productionKeys.length ? ` · ${copy.domain.result_image.numbered_layout}` : ''}`
  const headingWidth = WIDTH - MARGIN * 2 - 240
  const subtitleY = MARGIN + lines(heading, headingWidth, 32, 700).length * 38 + 12
  const headerBottom = subtitleY + lines(subtitle, WIDTH - MARGIN * 2).length * 20 + 24
  const roomCount = new Set(sections.flatMap((section) => section.cards.map((card) => card.key))).size
  const operatorCount = new Set(plans.flatMap((plan) => plan.rows.flatMap((row) => row.operators.map((operator) => operator.name)))).size
  let y = headerBottom + 24
  for (const section of sections) {
    const headingWidth = columnX[3] - MARGIN - SHAFT - GAP
    headings.push({ value: section.title, note: section.note, y, width: headingWidth })
    const headingHeight = lines(section.title, headingWidth, 20, 600).length * 26 + 12
      + (section.note ? lines(section.note, headingWidth).length * 20 + 12 : 0)
    const positioned = section.cards.map((card, index) => {
      const productionIndex = productionLayout.indexOf(card.key)
      const roomIndex = Number(card.key.split('-')[1]) || 0
      if (PRODUCTION_TYPES.includes(card.roomType) && productionIndex >= 0 && productionIndex < 9) {
        return { card, floor: Math.floor(productionIndex / 3) + 1, column: productionIndex % 3 }
      }
      if (card.roomType === 'control') return { card, floor: 0, column: 3 }
      if (card.roomType === 'dormitory' && roomIndex < 4) return { card, floor: roomIndex + 1, column: 3 }
      const supportIndex = SUPPORT_TYPES.indexOf(card.roomType)
      if (supportIndex >= 0) return { card, floor: supportIndex + 1, column: 4 }
      return { card, floor: 5 + Math.floor(index / 5), column: index % 5 }
    })
    const floors = [...new Set([0, ...positioned.map((item) => item.floor)])].sort((a, b) => a - b)
    for (const floor of floors) {
      const rooms = positioned.filter((item) => item.floor === floor)
      const floorHeaderHeight = Math.max(72, ...rooms.map(({ card, column }) => headerHeight(card, columnWidths[column])))
      const slotCount = Math.max(0, ...rooms.map(({ card }) => card.slots.length))
      const slotMetaHeights = Array.from({ length: slotCount }, (_, index) => Math.max(0,
        ...rooms.map(({ card, column }) => card.slots[index] ? slotMetaHeight(card.slots[index], columnWidths[column]) : 0)))
      const slotHeights = slotMetaHeights.map((metaHeight, index) => metaHeight + Math.max(96,
        ...rooms.map(({ card, column }) => card.slots[index]
          ? slotHeight(card.slots[index], columnWidths[column]) - slotMetaHeight(card.slots[index], columnWidths[column]) : 0)))
      const height = floorHeaderHeight + 12 + slotHeights.reduce((sum, size) => sum + size, 0) + Math.max(0, slotCount - 1) * SLOT_GAP + 12
      if (floor > 0) floorLabels.push({ value: floor < 5 ? `B${floor}` : '', y: y + floorHeaderHeight + 12 })
      for (const { card, column } of rooms) placements.push({ card, x: columnX[column], y, width: columnWidths[column], height, headerHeight: floorHeaderHeight, slotHeights, slotMetaHeights })
      y += (floor === 0 ? Math.max(rooms.length ? height : 0, headingHeight) : height) + GAP
    }
    y += 24
  }
  const height = y + 40
  // ponytail: cap the PNG at 16 MP; very long schedules trade resolution for a complete image.
  const scale = Math.min(2, 16384 / height, Math.sqrt(16_000_000 / (WIDTH * height)))
  canvas.width = Math.floor(WIDTH * scale)
  canvas.height = Math.floor(height * scale)
  ctx.scale(scale, scale)
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, WIDTH, height)
  text(heading, MARGIN, MARGIN, headingWidth, colors.text, 32, 700)
  text(subtitle, MARGIN, subtitleY, WIDTH - MARGIN * 2, colors.muted)
  text(copy.domain.result_board_v2.rooms(roomCount), WIDTH - MARGIN, MARGIN + 4, 216, colors.text, 16, 600, 'right')
  text(copy.domain.result_board_v2.operators(operatorCount), WIDTH - MARGIN, MARGIN + 32, 216, colors.muted, 14, 500, 'right')
  rule(MARGIN, headerBottom, WIDTH - MARGIN * 2)
  for (const item of headings) {
    const titleHeight = text(item.value, MARGIN, item.y + 12, item.width, colors.text, 20, 600)
    if (item.note) text(item.note, MARGIN, item.y + titleHeight + 24, item.width, colors.muted)
  }
  for (const floor of floorLabels) if (floor.value) text(floor.value, MARGIN, floor.y, FLOOR_GUTTER, colors.muted, 12, 600)
  for (const { card, x, y: cardY, width, height: cardSize, headerHeight: cardHeaderHeight, slotHeights, slotMetaHeights } of placements) {
    const tone = card.roomType === 'manufacture' ? colors.warning : ['power', 'dormitory'].includes(card.roomType) ? colors.success
      : card.roomType === 'trading' ? colors.trading : card.roomType === 'control' ? colors.brand : colors.muted
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, cardY, width, cardSize, 8)
    ctx.clip()
    ctx.fillStyle = colors.surface
    ctx.fillRect(x, cardY, width, cardSize)
    ctx.fillStyle = colors.inset
    ctx.fillRect(x, cardY, width, cardHeaderHeight)
    ctx.strokeStyle = colors.border
    ctx.stroke()
    const titleHeight = text(card.title, x + 16, cardY + HEADER_INSET, titleWidth(width), colors.text, 16, 600)
    const metaY = cardY + HEADER_INSET + titleHeight + 4
    const icons = cardProductImages(card)
    icons.forEach((image, index) => ctx.drawImage(image, x + 16 + index * 20, metaY, 16, 16))
    if (card.product !== '-') text(card.product, x + 16 + icons.length * 20, metaY, width - 32 - icons.length * 20 - 24, tone, 12)
    else text(copy.domain.result_board_v2.operators(Math.max(0, ...card.slots.map((slot) => slot.row?.operators.length ?? 0))), x + 16, metaY, width - 56, colors.muted, 12)
    if (version === 'v2' && hasEfficiency(card.slots[0]?.row)) text(card.slots[0].row!.efficiency, x + width - 16, cardY + HEADER_INSET, 84, tone, 14, 600, 'right')
    if (card.drone) drawDrone(x + width - 16 - BADGE_SIZE, metaY, colors.brand)
    rule(x + 16, cardY + cardHeaderHeight, width - 32)
    let rowY = cardY + cardHeaderHeight + 12
    for (const [slotIndex, slot] of card.slots.entries()) {
      const row = slot.row
      const startY = rowY
      if (slotIndex > 0) rule(x + 16, rowY - SLOT_GAP / 2, width - 32)
      if (version === 'v1') {
        text(slot.label, x + 16, rowY, width - 32 - 88, colors.muted, 12)
        if (hasEfficiency(row)) text(row!.efficiency, x + width - 16, rowY, 84, tone, 14, 600, 'right')
        rowY += slotMetaHeights[slotIndex]
      }
      if (!row || row.isAutofill || row.operators.length === 0) {
        text(row?.operatorText ?? copy.domain.result_board_v2.empty_room, x + 16, rowY + 24, width - 32, colors.muted)
      } else if (row.operators.length === 1) {
        const operator = row.operators[0]
        drawPortrait(operator, x + 16, rowY)
        const nameWidth = width - 32 - AVATAR_SIZE - GAP
        const nameHeight = lines(operator.name, nameWidth).length * 20
        text(operator.name, x + 16 + AVATAR_SIZE + GAP, rowY + Math.max(0, (AVATAR_SIZE - nameHeight) / 2), nameWidth, colors.text)
      } else {
        for (let index = 0; index < row.operators.length; index += tilesPerRow(width)) {
          const operators = row.operators.slice(index, index + tilesPerRow(width))
          const tileWidth = (width - 32) / operators.length
          let nameHeight = 0
          operators.forEach((operator, column) => {
            const centerX = x + 16 + (column + 0.5) * tileWidth
            drawPortrait(operator, centerX - AVATAR_SIZE / 2, rowY)
            nameHeight = Math.max(nameHeight, text(operator.name, centerX, rowY + AVATAR_SIZE + 4, tileWidth - 4, colors.text, FONT_SIZE, 500, 'center'))
          })
          rowY += AVATAR_SIZE + 4 + nameHeight + 8
        }
      }
      rowY = startY + slotHeights[slotIndex] + SLOT_GAP
    }
    ctx.restore()
  }
  rule(MARGIN, height - 48, WIDTH - MARGIN * 2)
  text(copy.domain.result_image.footer, MARGIN, height - 28, WIDTH - MARGIN * 2, colors.muted, 12)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'))

  function drawPortrait(operator: RoomRow['operators'][number], x: number, y: number) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, AVATAR_SIZE, AVATAR_SIZE, 6)
    ctx.clip()
    ctx.fillStyle = colors.inset
    ctx.fillRect(x, y, AVATAR_SIZE, AVATAR_SIZE)
    const image = operator.id ? images.get(operator.id) : null
    if (image) ctx.drawImage(image, x, y, AVATAR_SIZE, AVATAR_SIZE)
    else text(operator.name.trim().slice(0, 1) || '?', x + AVATAR_SIZE / 2, y + 24, AVATAR_SIZE, colors.muted, 20, 500, 'center')
    const profession = operatorProfession(operator)
    const professionIcon = profession ? professionIcons.get(profession) : null
    if (professionIcon) {
      ctx.fillStyle = colors.badge
      ctx.fillRect(x + AVATAR_SIZE - BADGE_SIZE, y, BADGE_SIZE, BADGE_SIZE)
      ctx.drawImage(professionIcon, x + AVATAR_SIZE - BADGE_SIZE + 2, y + 2, BADGE_SIZE - 4, BADGE_SIZE - 4)
    }
    if (operator.recoverySupport && recoverySupportIcon) ctx.drawImage(recoverySupportIcon, x + AVATAR_SIZE - BADGE_SIZE, y + AVATAR_SIZE - BADGE_SIZE, BADGE_SIZE, BADGE_SIZE)
    ctx.restore()
  }
  function drawDrone(x: number, y: number, color: string) {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    for (const [dx, dy] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      ctx.beginPath()
      ctx.moveTo(x + 8, y + 8)
      ctx.lineTo(x + 8 + dx, y + 8 + dy)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x + 8 + dx, y + 8 + dy, 2.25, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.lineWidth = 1
  }
}

function readThemeColors(root: Element) {
  const tokens = {
    background: '--theme-surface-0', surface: '--theme-surface-1', inset: '--theme-surface-2', border: '--theme-surface-4',
    text: '--theme-ink-primary', muted: '--theme-ink-secondary', brand: '--theme-brand-400',
    trading: '--station-trading', warning: '--station-manufacturing', success: '--station-power', badge: '--color-v2-rail',
  }
  const probe = document.createElement('span')
  probe.hidden = true
  root.append(probe)
  try {
    return Object.fromEntries(Object.entries(tokens).map(([key, token]) => {
      probe.style.color = `var(${token})`
      return [key, getComputedStyle(probe).color]
    })) as Record<keyof typeof tokens, string>
  } finally {
    probe.remove()
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    const timer = window.setTimeout(() => finish(null), 8000)
    function finish(result: HTMLImageElement | null) {
      window.clearTimeout(timer)
      image.onload = image.onerror = null
      resolve(result)
    }
    image.onload = () => finish(image)
    image.onerror = () => finish(null)
    image.src = src
  })
}
