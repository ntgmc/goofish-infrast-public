import type { OptimizeResult } from '../../../src/lib/types';

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
}

export function buildMaaExportPayload(result: OptimizeResult): MaaExportPayload {
  return {
    title: result.title,
    description: result.description,
    plans: (result.plans ?? []).map((planValue) => {
      const plan = planValue as unknown as Record<string, unknown>;
      const roomsValue = isRecord(plan.rooms) ? plan.rooms : {};
      const rooms: MaaExportPlan['rooms'] = {};

      for (const roomType of MAA_EXPORT_ROOM_TYPES) {
        const roomList = roomsValue[roomType];
        if (!Array.isArray(roomList)) continue;
        rooms[roomType] = roomList.map(projectRoom);
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
      if (drones) projected.drones = drones;
      return projected;
    }),
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
