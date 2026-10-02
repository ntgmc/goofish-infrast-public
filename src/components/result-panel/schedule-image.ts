import { copy } from '../../copy/index'
import { buildBoardRoomGroups, buildBoardSlots } from './ResultBoard'
import { buildBoardV2Rooms, PRODUCTION_TYPES } from './ResultBoardV2'
import { formatCompactNumber, type PreparedResult } from './formatters'
import { ROOM_LABELS } from './labels'
import type { PreparedPlan, RoomRow } from './types'
import { isDroneTarget } from './DroneMarker'
import { getProductIconSrc } from '../ProductIcon'

type ImageOptions = {
  prepared: PreparedResult;
  isRotationMode: boolean;
  version: 'v1' | 'v2';
  title: string;
  planIndex?: number;
  shiftHours?: number[];
  manual?: boolean;
}
type ImageCard = {
  title: string;
  product: string;
  roomType: string;
  droneLabels: string[];
  slots: Array<{ label: string; row?: RoomRow }>;
}

const WIDTH = 1200
const MARGIN = 32
const GAP = 16
const CARD_WIDTH = (WIDTH - MARGIN * 2 - GAP) / 2
const FONT_SIZE = 14

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

export async function renderScheduleImage({ prepared, isRotationMode, version, title, planIndex, shiftHours, manual = false }: ImageOptions): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  const fontFamily = getComputedStyle(document.body).fontFamily || 'sans-serif'
  const plans = version === 'v2' && planIndex !== undefined ? prepared.plans.slice(planIndex, planIndex + 1) : prepared.plans
  if (plans.length === 0) throw new Error('No schedule to export')
  const colors = readThemeColors()
  const avatarSize = version === 'v1' ? 48 : 72
  const tileWidth = avatarSize + 24
  const nameGap = version === 'v1' ? 8 : 4
  const rowGap = version === 'v1' ? 12 : 8
  const allText = plans.flatMap((plan) => plan.rows.map((row) => `${row.label} ${row.operatorText}`)).join(' ')
  if (document.fonts) await document.fonts.load(`500 ${FONT_SIZE}px ${fontFamily}`, `${title} ${allText}`)
  const images = new Map(await Promise.all([...new Set(plans.flatMap((plan) =>
    plan.rows.flatMap((row) => row.operators.flatMap((operator) => operator.id ? [operator.id] : [])),
  ))].map(async (id) => [id, await loadImage(`/webp96/${encodeURIComponent(id)}.webp`)] as const)))

  function lines(value: string, width: number, size = FONT_SIZE, weight = 500): string[] {
    context!.font = `${weight} ${size}px ${fontFamily}`
    const output: string[] = []
    let line = ''
    for (const character of value) {
      if (character === '\n' || (line && context!.measureText(line + character).width > width)) {
        output.push(line)
        line = character === '\n' ? '' : character
      } else line += character
    }
    output.push(line)
    return output
  }

  function text(value: string, x: number, y: number, width: number, color: string, size = FONT_SIZE, weight = 500, align: CanvasTextAlign = 'left', centered = false): number {
    const wrapped = lines(value, width, size, weight)
    context!.fillStyle = color
    context!.textBaseline = centered ? 'alphabetic' : 'top'
    context!.textAlign = align
    wrapped.forEach((line, index) => {
      const metrics = context!.measureText(line)
      const offset = centered
        ? (size + 6) / 2 + ((metrics.actualBoundingBoxAscent ?? size * 0.8) - (metrics.actualBoundingBoxDescent ?? size * 0.2)) / 2
        : 0
      context!.fillText(line, x, y + offset + index * (size + 6))
    })
    return wrapped.length * (size + 6)
  }

  function slotMetaHeight(slot: ImageCard['slots'][number]): number {
    return version === 'v1' ? 28 : slot.label || hasEfficiency(slot.row) ? 24 : 0
  }
  function hasEfficiency(row?: RoomRow): boolean {
    return !manual && Boolean(row && !row.isAutofill && row.efficiency !== '-'
      && (version === 'v1' || (PRODUCTION_TYPES.includes(row.roomType) && row.roomType !== 'control')))
  }
  function tilesPerRow(width: number): number {
    return Math.max(1, Math.floor((width - 32) / tileWidth))
  }
  function slotHeight(slot: ImageCard['slots'][number], width: number): number {
    const row = slot.row
    if (!row || row.isAutofill || row.operators.length === 0) {
      return slotMetaHeight(slot) + lines(row?.operatorText ?? copy.domain.result_board_v2.empty_room, width - 32).length * 20 + (version === 'v1' ? 0 : rowGap)
    }
    let height = slotMetaHeight(slot)
    for (let index = 0; index < row.operators.length; index += tilesPerRow(width)) {
      const nameLines = Math.max(...row.operators.slice(index, index + tilesPerRow(width)).map((operator) => lines(operator.name, tileWidth - 8, 12).length))
      height += avatarSize + nameGap + nameLines * 18 + rowGap
    }
    return height
  }

  function cardHeight(card: ImageCard, width: number): number {
    return (version === 'v1' ? 40 : 32) + Math.max(lines(card.title, headerTextWidth(card, width), 16, 600).length,
      card.product === '-' ? 0 : lines(card.product, productTextWidth(card, width), 16, 600).length) * 22
      + card.slots.reduce((height, slot) => height + slotHeight(slot, width), 0)
  }

  function headerTextWidth(card: ImageCard, width: number): number {
    return version === 'v2' && card.product === '-'
      ? width - 44 - (card.droneLabels.length > 0 ? 40 : 0)
      : (width - 100) / 2
  }
  function productTextWidth(card: ImageCard, width: number): number {
    return (width - 100) / 2 - (productImages.get(card.product) ? 24 : 0)
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
      title: `${group.label}${group.indexLabel ? ` ${group.indexLabel}` : ''}`,
      product: group.product,
      roomType: group.roomType,
      droneLabels: plans.flatMap((plan, index) => isDroneTarget(plan.drones, group.roomType, group.rows[0].roomIndex) ? [planLabel(plan, index)] : []),
      slots: buildBoardSlots(group.rows, prepared.detailStats.planCount, isRotationMode),
    })),
  }] : plans.map((plan, index) => ({
    title: planLabel(plan, planIndex ?? index),
    note: planNote(plan),
    cards: buildBoardV2Rooms(plan, isRotationMode)
      .sort((a, b) => {
        const order = [...PRODUCTION_TYPES, 'meeting', 'hire', 'processing', 'dormitory']
        const rank = (type: string) => order.includes(type) ? order.indexOf(type) : order.length
        return rank(a.roomType) - rank(b.roomType)
      })
      .map((room): ImageCard => ({
        title: `${room.label}${room.indexLabel ? ` ${room.indexLabel}` : ''}`,
        product: room.product,
        roomType: room.roomType,
        droneLabels: isDroneTarget(plan.drones, room.roomType, room.roomIndex) ? [planLabel(plan, planIndex ?? index)] : [],
        slots: [{ label: '', row: room.row }],
      })),
  }))
  const productImages = new Map(await Promise.all(
    (version === 'v2' ? [...new Set(sections.flatMap((section) => section.cards.map((card) => card.product)))] : [])
      .flatMap((product) => {
        const src = getProductIconSrc(product)
        return src ? [[product, src] as const] : []
      })
      .map(async ([product, src]) => [product, await loadImage(src)] as const),
  ))
  const placements: Array<{ card: ImageCard; x: number; y: number; width: number; height: number }> = []
  const headings: Array<{ value: string; y: number; note: string }> = []
  const heading = `${copy.domain.result_image.title} ${version}`
  const mode = isRotationMode ? copy.domain.components_result_panel_ResultBoard_001 : copy.domain.components_result_panel_ResultBoard_002
  const subtitle = `${title} · ${manual
    ? prepared.hasDailyProduction ? copy.domain.manual_schedule.simulation_image : copy.domain.manual_schedule.pending
    : mode}`
  let y = 88 + lines(subtitle, WIDTH - MARGIN * 2).length * 20
  for (const section of sections) {
    headings.push({ value: section.title, note: section.note, y })
    y += lines(section.title, WIDTH - MARGIN * 2, 20, 600).length * 26 + 16
    if (section.note) y += lines(section.note, WIDTH - MARGIN * 2).length * 20 + 12
    if (section.cards.length === 0) y += 36
    if (version === 'v1') {
      for (let index = 0; index < section.cards.length; index += 2) {
        const pair = section.cards.slice(index, index + 2)
        const cardSize = Math.max(...pair.map((card) => cardHeight(card, CARD_WIDTH)))
        pair.forEach((card, column) => placements.push({ card, x: MARGIN + column * (CARD_WIDTH + GAP), y, width: CARD_WIDTH, height: cardSize }))
        y += cardSize + GAP
      }
    } else {
      const columnWidth = (WIDTH - MARGIN * 2 + GAP) / 6
      let column = 0
      let rowHeight = 0
      for (const card of section.cards) {
        const count = Math.max(1, ...card.slots.map((slot) => slot.row?.operators.length ?? 0))
        const span = Math.min(6, Math.max(card.product !== '-' || card.droneLabels.length > 0 ? 2 : 1, Math.ceil((count * tileWidth + 32 + GAP) / columnWidth)))
        const width = span * columnWidth - GAP
        const height = cardHeight(card, width)
        if (column + span > 6) {
          y += rowHeight + GAP
          column = 0
          rowHeight = 0
        }
        placements.push({ card, x: MARGIN + column * columnWidth, y, width, height })
        rowHeight = Math.max(rowHeight, height)
        column += span
      }
      y += rowHeight + GAP
    }
    y += 24
  }
  const height = y + 48
  // ponytail: cap the PNG at 16 MP; very long schedules trade resolution for a complete image.
  const scale = Math.min(2, 16384 / height, Math.sqrt(16_000_000 / (WIDTH * height)))
  canvas.width = Math.floor(WIDTH * scale)
  canvas.height = Math.floor(height * scale)
  context.scale(scale, scale)
  context.fillStyle = colors.background
  context.fillRect(0, 0, WIDTH, height)
  text(heading, MARGIN, 28, WIDTH - MARGIN * 2, colors.text, 28, 600)
  text(subtitle, MARGIN, 70, WIDTH - MARGIN * 2, colors.muted)
  for (const item of headings) {
    const titleHeight = text(item.value, MARGIN, item.y, WIDTH - MARGIN * 2, colors.brand, 20, 600)
    if (item.note) text(item.note, MARGIN, item.y + titleHeight + 16, WIDTH - MARGIN * 2, colors.muted)
  }
  for (const { card, x, y: cardY, width, height: cardSize } of placements) {
    const tone = card.roomType === 'manufacture' ? colors.warning : ['power', 'dormitory'].includes(card.roomType) ? colors.success : colors.brand
    context.beginPath()
    context.roundRect(x, cardY, width, cardSize, 12)
    context.fillStyle = colors.surface
    context.fill()
    context.strokeStyle = colors.border
    context.stroke()
    context.fillStyle = tone
    context.fillRect(x + 16, cardY + 16, 3, 20)
    const titleHeight = text(card.title, x + 28, cardY + 16, headerTextWidth(card, width), colors.text, 16, 600)
    const productRight = x + width - 16 - (card.droneLabels.length > 0 ? 40 : 0)
    const productImage = productImages.get(card.product)
    if (productImage) {
      const [firstLine] = lines(card.product, productTextWidth(card, width), 16, 600)
      context.drawImage(productImage, productRight - context.measureText(firstLine).width - 24, cardY + 17, 20, 20)
    }
    const productHeight = card.product === '-' ? 0
      : text(card.product, productRight, cardY + 16, productTextWidth(card, width), tone, 16, 600, 'right', version === 'v2')
    let rowY = cardY + 16 + Math.max(titleHeight, productHeight) + 8
    if (card.droneLabels.length > 0) {
      context.strokeStyle = colors.brand
      context.lineWidth = 2
      const centerX = x + width - 28
      const centerY = cardY + 28
      for (const [dx, dy] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
        context.beginPath()
        context.moveTo(centerX, centerY)
        context.lineTo(centerX + dx, centerY + dy)
        context.stroke()
        context.beginPath()
        context.arc(centerX + dx, centerY + dy, 5, 0, Math.PI * 2)
        context.stroke()
      }
      context.lineWidth = 1
    }
    for (const slot of card.slots) {
      const row = slot.row
      if (slot.label) text(slot.label, x + 16, rowY, width - 140, colors.muted, 12)
      if (hasEfficiency(row)) text(row!.efficiency, x + width - 16, rowY, 96, tone, 16, 600, 'right')
      const startY = rowY
      rowY += slotMetaHeight(slot)
      if (!row || row.isAutofill || row.operators.length === 0) {
        text(row?.operatorText ?? copy.domain.result_board_v2.empty_room, x + 16, rowY, width - 32, colors.muted)
      } else {
        for (let index = 0; index < row.operators.length; index += tilesPerRow(width)) {
          const operators = row.operators.slice(index, index + tilesPerRow(width))
          let nameHeight = 0
          operators.forEach((operator, column) => {
            const centerX = version === 'v1'
              ? x + width / 2 + (column - (operators.length - 1) / 2) * tileWidth
              : x + 16 + tileWidth / 2 + column * tileWidth
            const tileX = centerX - avatarSize / 2
            context.save()
            context.beginPath()
            context.roundRect(tileX, rowY, avatarSize, avatarSize, 6)
            context.clip()
            const image = operator.id ? images.get(operator.id) : null
            if (image) context.drawImage(image, tileX, rowY, avatarSize, avatarSize)
            else {
              context.fillStyle = colors.background
              context.fillRect(tileX, rowY, avatarSize, avatarSize)
              text(operator.name.trim().slice(0, 1) || '?', centerX, rowY + avatarSize / 3, avatarSize, colors.muted, 20, 500, 'center')
            }
            context.restore()
            nameHeight = Math.max(nameHeight, text(operator.name, centerX, rowY + avatarSize + nameGap, tileWidth - 8, colors.text, 12, 500, 'center'))
          })
          rowY += avatarSize + nameGap + nameHeight + rowGap
        }
      }
      rowY = startY + slotHeight(slot, width)
    }
  }
  text(copy.domain.result_image.footer, MARGIN, height - 36, WIDTH - MARGIN * 2, colors.muted, 12)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'))
}

function readThemeColors() {
  const tokens = {
    background: '--theme-surface-0', surface: '--theme-surface-1', border: '--theme-surface-3',
    text: '--theme-ink-primary', muted: '--theme-ink-secondary', brand: '--theme-brand-400',
    warning: '--theme-warning', success: '--theme-success',
  }
  const probe = document.createElement('span')
  probe.hidden = true
  document.body.append(probe)
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
