import * as esbuild from 'esbuild';
import { createHmac } from 'node:crypto';

const optimizeEntry = 'netlify/functions/optimize.ts';
const freePreviewEntry = 'netlify/functions/free-preview.ts';
const adminSecret = 'check-optimize-secret';
process.env.MAA_ADMIN_SECRET = adminSecret;

const optimizeModule = await bundleFunction(optimizeEntry);
const freePreviewModule = await bundleFunction(freePreviewEntry);

const config = {
  layout: '333',
  desc: '3 贸易站 / 3 制造站',
  trading_stations_count: 3,
  manufacturing_stations_count: 3,
  product_requirements: {
    trading_stations: { LMD: 3, Orundum: 0 },
    manufacturing_stations: {
      'Pure Gold': 3,
      'Originium Shard': 0,
      'Battle Record': 0,
    },
  },
  Fiammetta: { enable: false },
  drones: { enable: false, order: '', targets: [] },
};

const sampleOperators = [
  { id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 4 },
  { id: 'char_010_chen', name: '陈', own: true, elite: 1, rarity: 5 },
  { id: 'char_4080_lin', name: '林', own: true, elite: 0, rarity: 5 },
];

async function bundleFunction(entryPoint) {
  const buildResult = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    packages: 'external',
  });

  const bundledCode = buildResult.outputFiles[0]?.text;
  if (!bundledCode) {
    throw new Error(`Failed to bundle ${entryPoint}.`);
  }

  const functionUrl = `data:text/javascript;base64,${Buffer.from(bundledCode).toString('base64')}`;
  return await import(functionUrl);
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

const unsignedLicense = {
  version: 1,
  order_hash: 'legacy-smoke-test',
  operators: [],
  config,
  permission: 'basic',
  issued_at: '2026-01-01T00:00:00Z',
};

const license = {
  ...unsignedLicense,
  sig: signLicense(unsignedLicense),
};

async function callOptimize(body) {
  const request = new Request('http://local/api/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await optimizeModule.default(request, {});
  const text = await response.text();
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

const current = await callOptimize({
  license,
  operators: [],
  config,
  ignore_elite: false,
});
assertOptimizeShape(current, 'current result');

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
