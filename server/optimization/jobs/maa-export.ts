import type { OptimizeResult } from '../../../src/lib/types';
import { ZodError } from 'zod';
import { parseOptimizeResult } from './runtime-contracts';

const MAA_EXPORT_ROOM_TYPES = [
  'trading',
  'manufacture',
  'power',
  'dormitory',
  'control',
  'meeting',
  'hire',
  'processing',
  'training',
] as const;

type MaaExportRoomType = (typeof MAA_EXPORT_ROOM_TYPES)[number];

interface MaaExportRoom {
  operators: string[];
  skip: boolean;
  sort: boolean;
  autofill: boolean;
  product?: string;
}

interface MaaExportFiammetta {
  enable: boolean;
  target: string;
  order: string;
}

interface MaaExportDrones {
  enable: boolean;
  room: string;
  index: number;
  order: string;
}

interface MaaExportPlan {
  name: string;
  description: string;
  description_post?: string;
  rooms: Partial<Record<MaaExportRoomType, MaaExportRoom[]>>;
  Fiammetta?: MaaExportFiammetta;
  drones?: MaaExportDrones;
}

export interface MaaExportPayload {
  title: string;
  description: string;
  plans: MaaExportPlan[];
  scheduleType: {
    planTimes: number;
    trading: number;
    manufacture: number;
    power: number;
    dormitory: number;
  };
}

export class MaaExportValidationError extends Error {
  readonly code = 'maa_export_result_invalid'

  constructor(message: string) {
    super(message)
    this.name = 'MaaExportValidationError'
  }
}

export function buildMaaExportPayload(result: OptimizeResult): MaaExportPayload {
  let validated: OptimizeResult
  try {
    validated = parseOptimizeResult(result)
  } catch (error) {
    const issue = error instanceof ZodError ? error.issues[0] : null
    const path = issue?.path.length ? issue.path.join('.') : 'result'
    throw new MaaExportValidationError(`排班结果无法导出：${path} ${issue?.message ?? '结构无效'}。`)
  }
  if (!validated.title.trim()) throw new MaaExportValidationError('排班结果无法导出：title 不能为空。')
  if (validated.plans.length === 0) throw new MaaExportValidationError('排班结果无法导出：plans 不能为空。')

  const plans = validated.plans.map((planValue, planIndex) => {
    const plan = planValue as unknown as Record<string, unknown>;
    const roomsValue = isRecord(plan.rooms) ? plan.rooms : {};
    if (!validated.facility_layout && Array.isArray(roomsValue.trading) && roomsValue.trading.length === 2
      && Array.isArray(roomsValue.manufacture) && roomsValue.manufacture.length === 5) {
      throw new MaaExportValidationError('排班结果缺少设施位置，请按游戏内布局确认设施位置与等级后重新生成排班。');
    }
    const rooms: MaaExportPlan['rooms'] = {};
    const roomIndexes: Partial<Record<MaaExportRoomType, number[]>> = {};

    for (const roomType of MAA_EXPORT_ROOM_TYPES) {
      const roomList = roomsValue[roomType];
      if (!Array.isArray(roomList)) continue;
      if (!validated.facility_layout && (roomType === 'trading' || roomType === 'manufacture')) {
        const levels = roomList.map((room) => isRecord(room) ? room.level ?? room.facility_level : undefined)
          .filter((level) => typeof level === 'number');
        if (new Set(levels).size > 1) {
          throw new MaaExportValidationError('排班结果缺少设施位置，请按游戏内布局确认设施位置与等级后重新生成排班。');
        }
      }
      if (validated.facility_layout && (roomType === 'trading' || roomType === 'manufacture' || roomType === 'power')) {
        const indexes = validated.facility_layout
          .filter((id) => id.startsWith(`${roomType}_`))
          .map((id) => Number(id.split('_')[1]) - 1);
        if (indexes.length !== roomList.length) {
          throw new MaaExportValidationError(`排班结果无法导出：plans.${planIndex}.rooms.${roomType} 与设施布局不一致，请重新生成排班。`);
        }
        roomIndexes[roomType] = indexes;
        rooms[roomType] = indexes.map((index) => projectRoom(roomList[index]));
      } else {
        rooms[roomType] = roomList.map(projectRoom);
      }
    }

    if (Object.keys(rooms).length === 0) {
      throw new MaaExportValidationError(`排班结果无法导出：plans.${planIndex}.rooms 不包含可执行房间。`)
    }

    const projected: MaaExportPlan = {
      name: typeof plan.name === 'string' ? plan.name : '',
      description: typeof plan.description === 'string' ? plan.description : '',
      rooms,
    };
    if (typeof plan.description_post === 'string') projected.description_post = plan.description_post;

    const fiammetta = projectFiammetta(plan.Fiammetta);
    if (fiammetta) projected.Fiammetta = fiammetta;
    const drones = projectDrones(plan.drones);
    if (drones) {
      const indexes = drones.room === 'trading' || drones.room === 'manufacture' || drones.room === 'power'
        ? roomIndexes[drones.room]
        : undefined;
      const newIndex = indexes?.indexOf(drones.index - 1) ?? -1;
      projected.drones = newIndex < 0 ? drones : { ...drones, index: newIndex + 1 };
    }
    return projected;
  });

  const roomCount = (roomType: 'trading' | 'manufacture' | 'power' | 'dormitory') =>
    Math.max(...plans.map((plan) => plan.rooms[roomType]?.length ?? 0));

  return {
    title: validated.title,
    description: validated.description,
    plans,
    scheduleType: {
      planTimes: plans.length,
      trading: roomCount('trading'),
      manufacture: roomCount('manufacture'),
      power: roomCount('power'),
      dormitory: roomCount('dormitory'),
    },
  };
}

function projectRoom(value: unknown): MaaExportRoom {
  const room = isRecord(value) ? value : {};
  const projected: MaaExportRoom = {
    operators: Array.isArray(room.operators)
      ? room.operators.filter((operator): operator is string => typeof operator === 'string')
      : [],
    skip: room.skip === true,
    sort: room.sort === true,
    autofill: room.autofill === true,
  };
  if (typeof room.product === 'string') projected.product = room.product;
  return projected;
}

function projectFiammetta(value: unknown): MaaExportFiammetta | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.enable !== 'boolean' ||
    typeof value.target !== 'string' ||
    typeof value.order !== 'string'
  ) {
    return undefined;
  }
  return {
    enable: value.enable,
    target: value.target,
    order: value.order,
  };
}

function projectDrones(value: unknown): MaaExportDrones | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.enable !== 'boolean' ||
    typeof value.room !== 'string' ||
    typeof value.index !== 'number' ||
    !Number.isFinite(value.index) ||
    typeof value.order !== 'string'
  ) {
    return undefined;
  }
  return {
    enable: value.enable,
    room: value.room,
    index: value.index,
    order: value.order,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
