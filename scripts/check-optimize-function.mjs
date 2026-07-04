import * as esbuild from 'esbuild';
import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const optimizeEntry = 'netlify/functions/optimize.ts';
const freePreviewEntry = 'netlify/functions/free-preview.ts';
const redeemCdkEntry = 'netlify/functions/redeem-cdk.ts';
const adminSecret = 'check-optimize-secret';
const bundleDir = resolve('.cache/check-functions');
process.env.MAA_ADMIN_SECRET = adminSecret;
process.env.CDK_HASH_SECRET = 'check-cdk-secret';
process.env.NODE_ENV = 'test';
await mkdir(bundleDir, { recursive: true });

const optimizeModule = await bundleFunction(optimizeEntry);
const freePreviewModule = await bundleFunction(freePreviewEntry);
const redeemCdkModule = await bundleFunction(redeemCdkEntry);
const licenseUtilsModule = await bundleFunction('netlify/functions/license-utils.ts');
globalThis.__maaCdkRecordStoreForTesting = createMemoryCdkRecordStore();
globalThis.__maaUsageEventStoreForTesting = createMemoryUsageEventStore();

const config = {
  layout: '3-3-3',
  desc: '333 搓玉流',
  trading_stations_count: 3,
  manufacturing_stations_count: 3,
  product_requirements: {
    trading_stations: { LMD: 2, Orundum: 1 },
    manufacturing_stations: {
      'Pure Gold': 2,
      'Originium Shard': 1,
      'Battle Record': 0,
    },
  },
  Fiammetta: { enable: true },
  drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
};

const rotationConfig = {
  ...config,
  desc: '333 游戏内轮换烟测',
  schedule_mode: 'rotation',
};

const sampleOperators = [
  { id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 4 },
  { id: 'char_010_chen', name: '陈', own: true, elite: 1, rarity: 5 },
  { id: 'char_4080_lin', name: '林', own: true, elite: 0, rarity: 5 },
];

async function bundleFunction(entryPoint) {
  const outputPath = resolve(bundleDir, `${entryPoint.replace(/[\\/.:]/g, '-')}.cjs`);
  const buildResult = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });

  const bundledCode = buildResult.outputFiles[0]?.text;
  if (!bundledCode) {
    throw new Error(`Failed to bundle ${entryPoint}.`);
  }

  await writeFile(outputPath, bundledCode, 'utf8');
  const imported = await import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
  return imported.default ?? imported;
}

function createMemoryCdkRecordStore() {
  const records = new Map();
  return {
    get: async (key) => records.get(key) ?? null,
    set: async (key, record) => {
      records.set(key, record);
    },
    delete: async (key) => {
      records.delete(key);
    },
    list: async (prefix) => [...records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, record]) => record),
  };
}

function createMemoryUsageEventStore() {
  const records = new Map();
  return {
    set: async (key, record) => {
      records.set(key, record);
    },
    list: async (prefix) => [...records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, record]) => record),
  };
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function signLicense(unsignedLicense) {
  const digest = createHmac('sha256', adminSecret)
    .update(canonicalJson(unsignedLicense))
    .digest('hex');
  return `skadi-${digest.slice(0, 8)}-${digest.slice(8, 16)}`;
}

function createLicense(permission, orderHash = `${permission}-smoke-test`) {
  const unsignedLicense = {
    version: 1,
    order_hash: orderHash,
    operators: [],
    config,
    permission,
    issued_at: '2026-01-01T00:00:00Z',
  };
  return {
    ...unsignedLicense,
    sig: signLicense(unsignedLicense),
  };
}

const license = createLicense('growth');
const recommendedLicense = createLicense('recommended');
const advancedLicense = createLicense('advanced');
const activationToken = '0123456789abcdef0123456789abcdef';
const issuedWithToken = licenseUtilsModule.createSignedLicenseFile({
  adminSecret,
  operators: sampleOperators,
  config,
  permission: 'advanced',
  codeHash: 'activation-token-smoke',
  activationToken,
});
if (issuedWithToken.license.activation_token !== activationToken) {
  throw new Error('license signing: missing activation_token');
}
const reissuedWithToken = licenseUtilsModule.reissueSignedLicenseFile(advancedLicense, 'advanced', adminSecret, {
  activationToken,
});
if (reissuedWithToken.license.activation_token !== activationToken) {
  throw new Error('license reissue: missing activation_token');
}

async function callOptimizeRaw(body) {
  const request = new Request('http://local/api/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await optimizeModule.default(request, {});
  const text = await response.text();
  return { response, text };
}

async function callOptimize(body) {
  const { response, text } = await callOptimizeRaw(body);
  if (!response.ok) {
    throw new Error(`optimize returned ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function callFreePreview(body) {
  const request = new Request('http://local/api/free-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await freePreviewModule.default(request, {});
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`free-preview returned ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function callRedeemCdk(body) {
  const request = new Request('http://local/api/redeem-cdk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await redeemCdkModule.default(request, {});
  return { response, text: await response.text() };
}

function assertOptimizeShape(result, label) {
  if (!Array.isArray(result.plans)) {
    throw new Error(`${label}: missing plans array`);
  }
  if (!Array.isArray(result.raw_results)) {
    throw new Error(`${label}: missing raw_results array`);
  }
  if (typeof result.title !== 'string') {
    throw new Error(`${label}: missing title`);
  }
  if (!result.build_meta || typeof result.build_meta !== 'object') {
    throw new Error(`${label}: missing build_meta`);
  }
  for (const key of ['frontend_version', 'backend_version', 'data_version', 'generated_at', 'source_summary']) {
    if (typeof result.build_meta[key] !== 'string' || result.build_meta[key].length === 0) {
      throw new Error(`${label}: invalid build_meta.${key}`);
    }
  }
}

function assertNoFiammettaInRooms(result, label, { includeDormitories = true } = {}) {
  const blockedRoomTypes = includeDormitories
    ? null
    : new Set(['trading', 'manufacturing', 'power', 'control', 'meeting', 'hire']);
  for (const plan of result.plans ?? []) {
    for (const [roomType, rooms] of Object.entries(plan.rooms ?? {})) {
      if (!Array.isArray(rooms)) continue;
      if (blockedRoomTypes && !blockedRoomTypes.has(roomType)) continue;
      for (const [index, room] of rooms.entries()) {
        if (Array.isArray(room?.operators) && room.operators.includes('菲亚梅塔')) {
          throw new Error(`${label}: unexpected Fiammetta in ${roomType} ${index + 1}`);
        }
      }
    }
  }
}

const current = await callOptimize({
  license,
  operators: [],
  config,
  ignore_elite: false,
});
assertOptimizeShape(current, 'current result');
assertNoFiammettaInRooms(current, 'current result', { includeDormitories: false });

const recommendedCurrent = await callOptimize({
  license: recommendedLicense,
  operators: [],
  config,
  ignore_elite: false,
});
assertOptimizeShape(recommendedCurrent, 'recommended current result');
if (recommendedCurrent.upgrade_suggestions !== undefined || recommendedCurrent.current_result !== undefined) {
  throw new Error('recommended current result: leaked upgrade fields');
}

const recommendedUpgrade = await callOptimizeRaw({
  license: recommendedLicense,
  operators: [],
  config,
  ignore_elite: true,
  include_current: true,
});
if (recommendedUpgrade.response.status !== 403) {
  throw new Error(`recommended upgrade guard: expected 403, got ${recommendedUpgrade.response.status}`);
}

const cdkValidation = await callRedeemCdk({
  code: 'MAA-TEST-TEST-TEST',
  validate_only: true,
});
if (cdkValidation.response.status !== 404) {
  throw new Error(`cdk validate_only guard: expected 404, got ${cdkValidation.response.status}: ${cdkValidation.text}`);
}

const customConfig = {
  ...config,
  desc: 'advanced custom smoke config',
};
const advancedCustom = await callOptimize({
  license: advancedLicense,
  operators: [],
  config: customConfig,
  ignore_elite: false,
});
assertOptimizeShape(advancedCustom, 'advanced custom result');

const fiammettaDisabledResult = await callOptimize({
  license: advancedLicense,
  operators: [],
  config: {
    ...config,
    Fiammetta: { enable: false },
  },
  ignore_elite: false,
});
assertOptimizeShape(fiammettaDisabledResult, 'Fiammetta disabled result');
assertNoFiammettaInRooms(fiammettaDisabledResult, 'Fiammetta disabled result');

const rotationResult = await callOptimize({
  license: advancedLicense,
  operators: [],
  config: rotationConfig,
  ignore_elite: false,
});
assertOptimizeShape(rotationResult, 'rotation result');
assertNoFiammettaInRooms(rotationResult, 'rotation result');
if (rotationResult.schedule_mode !== 'rotation') {
  throw new Error(`rotation result: expected schedule_mode rotation, got ${rotationResult.schedule_mode}`);
}
if (!rotationResult.rotation_mode?.quick_switch || rotationResult.rotation_mode.queue_count !== 2) {
  throw new Error('rotation result: missing quick switch queue metadata');
}
if (!Array.isArray(rotationResult.plans) || rotationResult.plans.length !== 2) {
  throw new Error(`rotation result: expected 2 preset queues, got ${rotationResult.plans?.length}`);
}
if (rotationResult.shift_hours !== undefined || rotationResult.total_schedule_hours !== undefined) {
  throw new Error('rotation result: leaked fixed shift timing fields');
}
if (rotationResult.daily_production !== undefined || rotationResult.total_efficiency !== undefined) {
  throw new Error('rotation result: leaked production or total efficiency fields');
}
for (const plan of rotationResult.plans) {
  if (plan.Fiammetta?.enable || plan.Fiammetta?.target) {
    throw new Error('rotation result: Fiammetta should be disabled');
  }
  if (plan.mood_valid === false || plan.mood_errors !== undefined) {
    throw new Error('rotation result: should not report fixed-shift mood errors');
  }
  if (plan.drones !== undefined) {
    throw new Error('rotation result: plan.drones should be omitted');
  }
  if (Array.isArray(plan.rooms?.dormitory) && plan.rooms.dormitory.length > 0) {
    throw new Error('rotation result: dormitory rooms should be omitted');
  }
  for (const rooms of Object.values(plan.rooms ?? {})) {
    if (!Array.isArray(rooms)) continue;
    for (const room of rooms) {
      for (const mood of Object.values(room.mood ?? {})) {
        if (mood?.red_face) {
          throw new Error('rotation result: should not mark red-face risk from preset queues');
        }
      }
    }
  }
}

const restrictedPreset = licenseUtilsModule.resolveConfigForPermission('growth', config);
if (!restrictedPreset.ok) {
  throw new Error(`growth preset config guard: ${restrictedPreset.message}`);
}
const restrictedRotationPreset = licenseUtilsModule.resolveConfigForPermission('growth', rotationConfig);
if (!restrictedRotationPreset.ok) {
  throw new Error(`growth rotation preset config guard: ${restrictedRotationPreset.message}`);
}
if (restrictedRotationPreset.config.schedule_mode !== 'rotation') {
  throw new Error('growth rotation preset config guard: expected rotation mode to be preserved');
}
const customRestrictedConfig = {
  ...config,
  layout: '2-4-3',
  trading_stations_count: 2,
  manufacturing_stations_count: 4,
  product_requirements: {
    trading_stations: { LMD: 2 },
    manufacturing_stations: { 'Pure Gold': 4 },
  },
};
const restrictedCustom = licenseUtilsModule.resolveConfigForPermission('growth', customRestrictedConfig);
if (restrictedCustom.ok) {
  throw new Error('growth custom config guard: expected rejection');
}
const advancedCustomConfig = licenseUtilsModule.resolveConfigForPermission('advanced', customRestrictedConfig);
if (!advancedCustomConfig.ok) {
  throw new Error(`advanced custom config guard: ${advancedCustomConfig.message}`);
}

const preview = await callFreePreview({
  operators: sampleOperators,
  config,
});
if (preview.operator_count !== sampleOperators.length) {
  throw new Error('free-preview result: invalid operator_count');
}
if (preview.plans !== undefined || preview.raw_results !== undefined) {
  throw new Error('free-preview result: leaked full optimize fields');
}
if (!preview.support?.label || !Array.isArray(preview.directions) || !preview.potential_range?.label) {
  throw new Error('free-preview result: invalid preview shape');
}

const previousNetlify = process.env.NETLIFY;
process.env.NETLIFY = 'true';
try {
  const potential = await callOptimize({
    license,
    operators: [],
    config,
    ignore_elite: true,
    include_current: true,
  });
  assertOptimizeShape(potential, 'potential result');
  assertOptimizeShape(potential.current_result, 'current_result');
  if (
    potential.upgrade_suggestions !== undefined &&
    !Array.isArray(potential.upgrade_suggestions)
  ) {
    throw new Error('potential result: invalid upgrade_suggestions');
  }
  if (potential.upgrade_task_payload !== undefined) {
    if (!Array.isArray(potential.upgrade_task_payload.tasks)) {
      throw new Error('potential result: invalid upgrade_task_payload');
    }
    if (
      potential.upgrade_task_payload.currentFiammettaTargets !== undefined &&
      !Array.isArray(potential.upgrade_task_payload.currentFiammettaTargets)
    ) {
      throw new Error('potential result: invalid currentFiammettaTargets');
    }
    if (
      potential.upgrade_task_payload.potentialFiammettaTargets !== undefined &&
      !Array.isArray(potential.upgrade_task_payload.potentialFiammettaTargets)
    ) {
      throw new Error('potential result: invalid potentialFiammettaTargets');
    }
    const suggestionResult = await callOptimize({
      license,
      operators: [],
      config,
      ignore_elite: true,
      suggestions_only: true,
      upgrade_task_payload: potential.upgrade_task_payload,
    });
    if (!Array.isArray(suggestionResult.upgrade_suggestions)) {
      throw new Error('suggestions_only result: invalid upgrade_suggestions');
    }
    if (!suggestionResult.build_meta?.backend_version) {
      throw new Error('suggestions_only result: missing build_meta');
    }
  }
} finally {
  if (previousNetlify === undefined) {
    delete process.env.NETLIFY;
  } else {
    process.env.NETLIFY = previousNetlify;
  }
}

console.log('optimize function smoke check ok');
