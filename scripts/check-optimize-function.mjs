import * as esbuild from 'esbuild';

const optimizeEntry = 'netlify/functions/optimize.ts';

const buildResult = await esbuild.build({
  entryPoints: [optimizeEntry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  packages: 'external',
});

const bundledCode = buildResult.outputFiles[0]?.text;
if (!bundledCode) {
  throw new Error('Failed to bundle optimize function.');
}

const functionUrl = `data:text/javascript;base64,${Buffer.from(bundledCode).toString('base64')}`;
const optimizeModule = await import(functionUrl);

const config = {
  layout: '',
  desc: '',
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
  operators: [],
  config,
  ignore_elite: false,
});
assertOptimizeShape(current, 'current result');

const previousNetlify = process.env.NETLIFY;
process.env.NETLIFY = 'true';
try {
  const potential = await callOptimize({
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
