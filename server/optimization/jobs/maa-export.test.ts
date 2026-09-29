import { describe, expect, it } from 'vitest';
import type { OptimizeResult } from '../../../src/lib/types';
import { FACILITY_IDS } from '../../../src/lib/facility-layout';
import { buildMaaExportPayload, MaaExportValidationError } from './maa-export';

describe('buildMaaExportPayload', () => {
  it('projects a rich optimizer result to the MAA execution allowlist', () => {
    const input = richResult();
    const original = structuredClone(input);

    const exported = buildMaaExportPayload(input);

    expect(exported).toEqual({
      title: '测试排班',
      description: '仅供测试',
      plans: [{
        name: '第1班',
        description: '12H',
        description_post: '执行完成',
        Fiammetta: { enable: true, target: '但书', order: 'pre' },
        drones: { enable: true, room: 'manufacture', index: 1, order: 'post' },
        rooms: {
          trading: [{
            operators: ['巫恋', '龙舌兰'],
            skip: false,
            sort: true,
            autofill: false,
            product: 'LMD',
          }],
          dormitory: [{ operators: [], skip: false, sort: false, autofill: true }],
          processing: [{ operators: ['年'], skip: false, sort: false, autofill: false }],
          training: [{ operators: ['梅尔'], skip: false, sort: false, autofill: false }],
        },
      }],
      scheduleType: {
        planTimes: 1,
        trading: 1,
        manufacture: 0,
        power: 0,
        dormitory: 1,
      },
    });
    expect(input).toEqual(original);
  });

  it('normalizes missing legacy room fields without inventing optional actions', () => {
    const input = richResult();
    const plan = input.plans[0] as unknown as Record<string, any>;
    delete plan.Fiammetta;
    delete plan.drones;
    delete plan.description;
    delete plan.description_post;
    plan.rooms = { power: [{}], manufacture: [{ product: '' }] };

    expect(buildMaaExportPayload(input).plans[0]).toEqual({
      name: '第1班',
      description: '',
      rooms: {
        power: [{ operators: [], skip: false, sort: false, autofill: false }],
        manufacture: [{ operators: [], skip: false, sort: false, autofill: false, product: '' }],
      },
    });
  });

  it('removes calculation details and produces a smaller serialized payload', () => {
    const input = richResult();
    const exported = buildMaaExportPayload(input);
    const keys = collectKeys(exported);

    expect(keys).not.toEqual(expect.arrayContaining([
      'raw_results',
      'daily_production',
      'efficiency',
      'final_efficiency',
      'overflow',
      'mood',
      'dynamic_resources',
      'mood_valid',
      'search_nodes',
      'build_meta',
    ]));
    const fullBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
    const maaBytes = Buffer.byteLength(JSON.stringify(exported), 'utf8');
    const savedBytes = fullBytes - maaBytes;
    expect(savedBytes).toBeGreaterThan(0);
  });

  it('rejects malformed plans before producing a download', () => {
    const input = richResult();
    input.plans = [{ name: '损坏班次', rooms: { trading: [42] } } as never];

    expect(() => buildMaaExportPayload(input)).toThrow(MaaExportValidationError);
    expect(() => buildMaaExportPayload(input)).toThrow(/plans\.0\.rooms\.trading\.0/);
  });

  it('exports the facility counts and shift count for a three-shift 252 layout', () => {
    const input = richResult();
    input.buildingType = 252;
    input.facility_layout = [...FACILITY_IDS];
    input.planTimes = '3班';
    input.plans = Array.from({ length: 3 }, (_, index) => ({
      name: `第${index + 1}班`,
      rooms: {
        trading: [{}, {}],
        manufacture: [{}, {}, {}, {}, {}],
        power: [{}, {}],
        dormitory: [{}, {}, {}, {}],
      },
    })) as OptimizeResult['plans'];

    const exported = buildMaaExportPayload(input);
    expect(exported.scheduleType).toEqual({
      planTimes: 3,
      trading: 2,
      manufacture: 5,
      power: 2,
      dormitory: 4,
    });
    expect(Object.keys(exported).at(-1)).toBe('scheduleType');
    delete input.facility_layout;
    expect(() => buildMaaExportPayload(input)).toThrow(/缺少设施位置/);
  });

  it('counts rooms available across shifts when room lists differ', () => {
    const input = richResult();
    input.plans.push({
      name: '第2班',
      rooms: {
        manufacture: [{ product: 'Gold' }],
        power: [{ operators: [] }],
      },
    } as OptimizeResult['plans'][number]);

    expect(buildMaaExportPayload(input).scheduleType).toEqual({
      planTimes: 2,
      trading: 1,
      manufacture: 1,
      power: 1,
      dormitory: 1,
    });
  });

  it('uses saved positions for every shift and adjusts drone indexes', () => {
    const input = richResult();
    input.facility_layout = ['manufacture_3', 'trading_2', 'power_2', 'manufacture_1', 'manufacture_4', 'trading_1', 'power_1', 'manufacture_5', 'manufacture_2'];
    input.plans = [0, 1, 2].map((shift) => ({
      name: `第${shift + 1}班`,
      rooms: {
        trading: [
          { operators: [`低级贸易${shift}`], level: 2 },
          { operators: [`高级贸易${shift}`], level: 3 },
        ],
        manufacture: [
          { operators: [`低级制造${shift}`], facility_level: 1 },
          { operators: [`高级制造甲${shift}`], facility_level: 3 },
          { operators: [`中级制造${shift}`], facility_level: 2 },
          { operators: [`高级制造乙${shift}`], facility_level: 3 },
          { operators: [`另一个制造${shift}`], facility_level: 2 },
        ],
        power: [{ operators: ['发电甲'] }, { operators: ['发电乙'] }],
      },
      drones: { enable: true, room: ['manufacture', 'trading', 'power'][shift], index: 1, order: 'post' },
    })) as OptimizeResult['plans'];
    const original = structuredClone(input);

    const exported = buildMaaExportPayload(input);
    for (const [shift, plan] of exported.plans.entries()) {
      expect(plan.rooms.trading?.map((room) => room.operators[0])).toEqual([
        `高级贸易${shift}`, `低级贸易${shift}`,
      ]);
      expect(plan.rooms.manufacture?.map((room) => room.operators[0])).toEqual([
        `中级制造${shift}`, `低级制造${shift}`, `高级制造乙${shift}`, `另一个制造${shift}`, `高级制造甲${shift}`,
      ]);
      expect(plan.drones?.index).toBe(2);
      expect(plan.rooms.power?.map((room) => room.operators[0])).toEqual(['发电乙', '发电甲']);
    }
    expect(input).toEqual(original);
  });

  it('preserves original order without saved positions regardless of levels', () => {
    const input = richResult();
    input.plans[0].rooms.manufacture = [
      { operators: ['未知等级'] },
      { operators: ['三级'], level: 3 },
      { operators: ['另一个三级'], facility_level: 3 },
      { operators: ['另一个未知等级'] },
    ];

    expect(buildMaaExportPayload(input).plans[0].rooms.manufacture?.map((room) => room.operators[0]))
      .toEqual(['未知等级', '三级', '另一个三级', '另一个未知等级']);
  });

  it('rejects mixed-level legacy results without facility positions', () => {
    const input = richResult();
    input.plans[0].rooms.trading = [{ level: 3 }, { level: 2 }];
    expect(() => buildMaaExportPayload(input)).toThrow(/缺少设施位置/);
  });

  it('rejects invalid positions and room counts that do not match the saved layout', () => {
    const input = richResult();
    input.facility_layout = Array(9).fill('trading_1');
    expect(() => buildMaaExportPayload(input)).toThrow(MaaExportValidationError);
    input.facility_layout = ['trading_1', 'trading_2', 'manufacture_1', 'manufacture_2', 'manufacture_3', 'manufacture_4', 'manufacture_5', 'power_1', 'power_2'];
    expect(() => buildMaaExportPayload(input)).toThrow(/与设施布局不一致/);
  });
});

function richResult(): OptimizeResult {
  return {
    author: '开发者',
    title: '测试排班',
    description: '仅供测试',
    schedule_mode: 'maa',
    buildingType: 253,
    planTimes: '1班',
    plans: [{
      name: '第1班',
      description: '12H',
      description_post: '执行完成',
      mood_valid: true,
      dynamic_resources: { perception: 12 },
      Fiammetta: {
        enable: true,
        target: '但书',
        order: 'pre',
        mood_recovery: { before: 0, after: 24 },
      },
      drones: {
        enable: true,
        room: 'manufacture',
        index: 1,
        order: 'post',
        mode: 'manual',
        efficiency: 120,
        reason: 'highest_efficiency',
      },
      rooms: {
        trading: [{
          operators: ['巫恋', '龙舌兰'],
          skip: false,
          sort: true,
          autofill: false,
          product: 'LMD',
          efficiency: 180,
          final_efficiency: 190,
          overflow: { display_efficiency: 190 },
          mood: { 巫恋: { start: 24, end: 12 } },
          dynamic_resources: { order_limit: 4 },
        }],
        dormitory: [{ autofill: true, mood: { 但书: { start: 0, end: 24 } } }],
        processing: [{ operators: ['年'] }],
        training: [{ operators: ['梅尔'] }],
        unsupported_internal_room: [{ operators: ['不应导出'] }],
      },
    }],
    raw_results: [{
      total_efficiency: 190,
      assignment_detail: [{ rule: '测试规则', ops: ['巫恋'], eff: 90, workplace: '贸易站1' }],
    }],
    daily_production: { manufacturing: { LMD: 1000 } },
    total_efficiency: 190,
    raw_total_efficiency: 180,
    search_nodes: 1000,
    build_meta: {
      frontend_version: 'test',
      backend_version: 'test',
      data_version: 'test',
      generated_at: '2026-07-26T00:00:00.000Z',
      source_summary: 'test',
      git_sha: 'test',
    },
  } as unknown as OptimizeResult;
}

function collectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}
