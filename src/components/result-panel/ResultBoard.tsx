import type { PreparedResult } from './formatters'
import OperatorAvatarStrip from './OperatorAvatarStrip'
import type { PreparedPlan, RoomRow } from './types'

type BoardRoomGroup = {
  key: string;
  label: string;
  indexLabel: string;
  roomType: string;
  product: string;
  rows: RoomRow[];
}

type BoardSlot = {
  key: string;
  label: string;
  row?: RoomRow;
}

const ROOM_TONE: Record<string, string> = {
  trading: 'border-brand-500/35 bg-brand-500/10',
  manufacture: 'border-warning/35 bg-warning/10',
  power: 'border-success/35 bg-success/10',
  control: 'border-brand-300/25 bg-surface-2/45',
  meeting: 'border-surface-4/70 bg-surface-2/35',
  hire: 'border-surface-4/70 bg-surface-2/35',
  processing: 'border-surface-4/70 bg-surface-2/35',
  dormitory: 'border-success/25 bg-success/10',
}

const DEFAULT_ROOM_TONE = 'border-surface-3 bg-surface-2/35'

export default function ResultBoard({
  prepared,
  isRotationMode,
  planTimes,
}: {
  prepared: PreparedResult;
  isRotationMode: boolean;
  planTimes?: string;
}) {
  const groups = buildBoardRoomGroups(prepared.plans, isRotationMode)
  const modeLabel = isRotationMode ? '游戏内轮换参考图' : 'MAA 排班参考图'
  const queueLabel = planTimes ?? `${prepared.detailStats.planCount} 个${isRotationMode ? '队列' : '班次'}`

  return (
    <section className="tool-panel overflow-hidden">
      <div className="tool-panel-header px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink-primary">{modeLabel}</h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              按房间聚合展示，头像为主、名称辅助；详细效率数据请在详情页展开查看。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="tool-status">{queueLabel}</span>
            <span className="tool-status">{groups.length} 个房间</span>
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {groups.length === 0 ? (
          <div className="tool-inset border-dashed px-4 py-8 text-center text-sm text-ink-muted">
            暂无可展示的排班总览。
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <article
                key={group.key}
                className={`tool-inset overflow-hidden ${ROOM_TONE[group.roomType] ?? DEFAULT_ROOM_TONE}`}
              >
                <div className="border-b border-surface-3/50 px-3 py-2 text-center">
                  <h3 className="truncate text-sm font-semibold text-ink-primary">
                    {group.label}
                    {group.indexLabel && <span className="ml-1 text-ink-muted">{group.indexLabel}</span>}
                  </h3>
                  {group.product !== '-' && (
                    <p className="mt-0.5 truncate text-[11px] font-medium text-ink-muted">{group.product}</p>
                  )}
                </div>
                <div className="space-y-2 px-3 py-2.5">
                  {buildBoardSlots(group.rows, prepared.detailStats.planCount, isRotationMode).map((slot) => (
                    <div key={slot.key} className="grid min-h-[3.35rem] grid-cols-[3.4rem_minmax(0,1fr)_auto] items-start gap-2">
                      <span className={`pt-1 text-xs font-semibold ${slot.row ? 'text-ink-secondary' : 'text-ink-muted'}`}>
                        {slot.label}
                      </span>
                      {slot.row ? (
                        slot.row.isAutofill ? (
                          <p className="tool-inset border-transparent bg-surface-0/80 px-2 py-1.5 text-xs leading-5 text-ink-secondary">{slot.row.operatorText}</p>
                        ) : (
                          <OperatorAvatarStrip operators={slot.row.operators} fallbackText={slot.row.operatorText} micro showFullNames />
                        )
                      ) : (
                        <p className="tool-inset border-dashed bg-surface-0/55 px-2 py-1.5 text-xs leading-5 text-ink-muted">
                          未安排
                        </p>
                      )}
                      {slot.row && !slot.row.isAutofill && (
                        <span className="pt-1 font-mono text-[11px] font-semibold text-brand-300">{slot.row.efficiency}</span>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function buildBoardRoomGroups(plans: PreparedPlan[], isRotationMode: boolean): BoardRoomGroup[] {
  const groups = new Map<string, BoardRoomGroup>()

  for (const plan of plans) {
    for (const row of plan.rows) {
      if (isRotationMode && row.roomType === 'dormitory') continue
      const key = `${row.roomType}-${row.roomIndex}`
      const existing = groups.get(key)
      if (existing) {
        existing.rows.push(row)
        existing.product = formatGroupProduct(existing.rows)
        continue
      }

      groups.set(key, {
        key,
        label: row.label,
        indexLabel: row.indexLabel,
        roomType: row.roomType,
        product: row.product,
        rows: [row],
      })
    }
  }

  return [...groups.values()]
}

function buildBoardSlots(rows: RoomRow[], minimumSlotCount: number, isRotationMode: boolean): BoardSlot[] {
  const occupied = new Map<number, RoomRow>()
  const overflowRows: RoomRow[] = []
  let nextSequentialSlot = 1
  let maxSlot = Math.max(0, minimumSlotCount)

  for (const row of rows) {
    const parsedSlot = getQueueSlotNumber(row.queueLabel) ?? getSlotNumberFromRowKey(row.key)
    let slot = parsedSlot
    if (!slot) {
      while (occupied.has(nextSequentialSlot)) nextSequentialSlot += 1
      slot = nextSequentialSlot
    }

    if (occupied.has(slot)) {
      overflowRows.push(row)
      continue
    }

    occupied.set(slot, row)
    maxSlot = Math.max(maxSlot, slot)
  }

  for (const row of overflowRows) {
    maxSlot += 1
    occupied.set(maxSlot, row)
  }

  return Array.from({ length: maxSlot }, (_, index) => {
    const slotNumber = index + 1
    const row = occupied.get(slotNumber)
    return {
      key: row?.key ?? `empty-${slotNumber}`,
      label: row ? shortQueueLabel(row.queueLabel) : formatSlotLabel(slotNumber, isRotationMode),
      row,
    }
  })
}

function getQueueSlotNumber(label: string): number | undefined {
  const queueMatch = label.match(/队列\s*(\d+)/)
  if (queueMatch?.[1]) return Number(queueMatch[1])
  const shiftMatch = label.match(/(?:第)?\s*(\d+)\s*班|班次\s*(\d+)/)
  const shiftNumber = shiftMatch?.[1] ?? shiftMatch?.[2]
  if (shiftNumber) return Number(shiftNumber)
  return undefined
}

function getSlotNumberFromRowKey(key: string): number | undefined {
  const planIndexMatch = key.match(/^(\d+)-/)
  if (!planIndexMatch?.[1]) return undefined
  return Number(planIndexMatch[1]) + 1
}

function formatSlotLabel(slotNumber: number, isRotationMode: boolean): string {
  return isRotationMode ? `队列${slotNumber}` : `班${slotNumber}`
}

function shortQueueLabel(label: string): string {
  const slotNumber = getQueueSlotNumber(label)
  if (slotNumber) return label.includes('队列') ? `队列${slotNumber}` : `班${slotNumber}`
  return label.replace(/\s+/g, '')
}

function formatGroupProduct(rows: RoomRow[]): string {
  const products = Array.from(new Set(rows.map((row) => row.product).filter((product) => product && product !== '-')))
  if (products.length === 0) return '-'
  if (products.length <= 2) return products.join(' / ')
  return '多产物'
}
