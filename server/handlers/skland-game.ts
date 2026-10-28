import { z } from 'zod'
import type { SklandGame, SklandRoom } from '../../src/lib/skland-game'

const count = z.number().finite().nonnegative()
const optionalCount = count.nullish().catch(null)
const text = z.string().max(256)
const optionalText = text.nullish().catch(null)
const resident = z.object({ charId: text, ap: optionalCount })
const residents = z.array(resident.nullable().catch(null)).nullish().catch(null).transform((rows) => rows?.filter((row) => row !== null) ?? [])
const room = z.object({ slotId: text, level: count, chars: residents,
  formulaId: z.union([text, z.number()]).nullish().catch(null), strategy: optionalText,
  complete: optionalCount, capacity: optionalCount, stock: z.array(z.unknown()).nullish().catch(null), stockLimit: optionalCount,
  completeWorkTime: optionalCount, comfort: optionalCount })
const rooms = z.array(room.nullable().catch(null)).nullish().catch(null).transform((rows) => rows?.filter((row) => row !== null) ?? [])
const progress = z.object({ current: count, total: count }).nullish().catch(null)
const schema = z.object({ data: z.object({
  currentTs: optionalCount,
  status: z.object({ name: optionalText, level: optionalCount, mainStageProgress: optionalText, lastOnlineTs: optionalCount,
    storeTs: optionalCount, charCnt: optionalCount, skinCnt: optionalCount, furnitureCnt: optionalCount,
    ap: z.object({ current: count, max: count, completeRecoveryTime: optionalCount }).nullish().catch(null),
  }).nullish().catch(null),
  charInfoMap: z.record(z.string(), z.object({ name: optionalText }).catch({ name: null })).nullish().catch(null),
  campaign: z.object({ reward: progress }).nullish().catch(null),
  tower: z.object({ reward: z.object({ higherItem: progress, lowerItem: progress }).nullish().catch(null) }).nullish().catch(null),
  recruit: z.array(z.object({ state: count, finishTs: optionalCount })).nullish().catch(null),
  routine: z.object({ daily: progress, weekly: progress }).nullish().catch(null),
  building: z.object({
    control: room.nullish().catch(null), tradings: rooms, manufactures: rooms, powers: rooms,
    dormitories: rooms, hire: room.nullish().catch(null),
    meeting: room.extend({ clue: z.object({ own: optionalCount, received: optionalCount, board: z.array(text).nullish().catch(null),
      sharing: z.boolean().nullish().catch(null), shareCompleteTime: optionalCount }).nullish().catch(null) }).nullish().catch(null),
    training: room.extend({ trainee: resident.nullish().catch(null), trainer: resident.nullish().catch(null), remainSecs: optionalCount }).nullish().catch(null),
    labor: z.object({ value: count, maxValue: count }).nullish().catch(null), tiredChars: z.array(z.unknown()).nullish().catch(null), tiredCharsCount: optionalCount,
  }).nullish().catch(null),
}) })

// Formula IDs and storage weights are defined by the game's manufacturing recipes.
const FORMULAS: Record<string, { name: string; weight: number }> = {
  '1': { name: '基础作战记录', weight: 2 }, '2': { name: '初级作战记录', weight: 3 }, '3': { name: '中级作战记录', weight: 5 },
  '4': { name: '赤金', weight: 2 }, '13': { name: '源石碎片', weight: 3 }, '14': { name: '源石碎片', weight: 3 },
  ...Object.fromEntries(['先锋', '近卫', '重装', '狙击', '术师', '医疗', '辅助', '特种'].map((name, index) => [String(index + 5), { name: `${name}双芯片`, weight: 5 }])),
}

export function readSklandGame(value: unknown): SklandGame | null {
  const parsed = schema.safeParse(value)
  if (!parsed.success) return null
  const data = parsed.data.data
  if (!data.status && !data.building) return null
  const status = data.status
  const building = data.building
  const name = (id: string) => data.charInfoMap?.[id]?.name ?? id
  const rooms: SklandRoom[] = []
  if (building) {
    const groups = { control: building.control ? [building.control] : [], trading: building.tradings, manufacture: building.manufactures,
      power: building.powers, dormitory: building.dormitories, meeting: building.meeting ? [building.meeting] : [],
      hire: building.hire ? [building.hire] : [], training: building.training ? [building.training] : [] }
    for (const [type, entries] of Object.entries(groups) as [SklandRoom['type'], z.infer<typeof room>[] | undefined][]) {
      for (const entry of entries ?? []) {
        const formula = entry.formulaId == null ? undefined : FORMULAS[String(entry.formulaId)]
        const residents = type === 'training' ? [building.training?.trainee, building.training?.trainer].filter((item) => item != null) : entry.chars ?? []
        rooms.push({ id: entry.slotId, type, level: entry.level,
          operators: residents.map((operator) => ({ id: operator.charId, name: name(operator.charId), morale: operator.ap == null ? null : Math.min(24, operator.ap / 3_600_000) })),
          product: type === 'trading' ? entry.strategy === 'O_GOLD' ? '龙门币' : entry.strategy === 'O_DIAMOND' ? '合成玉' : null : formula?.name ?? null,
          stock: type === 'trading' ? entry.stock?.length ?? null : entry.complete ?? null,
          capacity: type === 'trading' ? entry.stockLimit ?? null : formula && entry.capacity != null ? Math.floor(entry.capacity / formula.weight) : null,
          completeAt: entry.completeWorkTime ?? null, comfort: entry.comfort ?? null })
      }
    }
  }
  const clue = building?.meeting?.clue
  return {
    currentTs: data.currentTs ?? null,
    player: { name: status?.name ?? null, level: status?.level ?? null, mainStage: status?.mainStageProgress ?? null,
      lastOnline: status?.lastOnlineTs ?? null, dataAt: status?.storeTs ?? null, operators: status?.charCnt ?? null, skins: status?.skinCnt ?? null,
      furniture: status?.furnitureCnt ?? null, sanity: status?.ap ? { current: status.ap.current, max: status.ap.max, completeAt: status.ap.completeRecoveryTime ?? null } : null },
    campaign: data.campaign?.reward ?? null,
    tower: data.tower?.reward ? { higher: data.tower.reward.higherItem ?? null, lower: data.tower.reward.lowerItem ?? null } : null,
    recruit: data.recruit?.map((slot) => ({ state: slot.state, finishAt: slot.finishTs ?? null })) ?? null,
    routine: { daily: data.routine?.daily ?? null, weekly: data.routine?.weekly ?? null },
    building: building ? { rooms, drones: building.labor ? { current: building.labor.value, max: building.labor.maxValue } : null,
      tired: building.tiredCharsCount ?? building.tiredChars?.length ?? null,
      clues: clue ? { owned: clue.own ?? null, received: clue.received ?? null, board: clue.board?.length ?? null, sharing: clue.sharing ?? null, shareCompleteAt: clue.shareCompleteTime ?? null } : null,
      training: building.training ? { trainee: building.training.trainee ? name(building.training.trainee.charId) : null,
        trainer: building.training.trainer ? name(building.training.trainer.charId) : null, remaining: building.training.remainSecs ?? null } : null } : null,
  }
}

export function readSklandItemNames(value: unknown): Record<string, string> {
  const parsed = z.object({ items: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]) }).safeParse(value)
  if (!parsed.success) return {}
  const entries = Array.isArray(parsed.data.items) ? parsed.data.items.map((item) => ['', item] as const) : Object.entries(parsed.data.items)
  const names: Record<string, string> = {}
  for (const [key, item] of entries) {
    const meta = z.object({ id: text.optional(), itemId: text.optional(), name: text.optional(), itemName: text.optional() }).safeParse(item)
    if (meta.success && (meta.data.name || meta.data.itemName)) names[meta.data.id ?? meta.data.itemId ?? key] = meta.data.name ?? meta.data.itemName!
  }
  return names
}
