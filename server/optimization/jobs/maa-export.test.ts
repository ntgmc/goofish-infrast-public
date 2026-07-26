import { describe, expect, it } from 'vitest';
import type { OptimizeResult } from '../../../src/lib/types';
import { buildMaaExportPayload } from './maa-export';

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
      git_sha: 'test',
      build_time: '2026-07-26T00:00:00.000Z',
    },
  } as unknown as OptimizeResult;
}

function collectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}
