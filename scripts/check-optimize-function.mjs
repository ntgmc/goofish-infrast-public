import { Worker } from 'node:worker_threads';
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
} finally {
  if (previousNetlify === undefined) {
    delete process.env.NETLIFY;
  } else {
    process.env.NETLIFY = previousNetlify;
  }
}

const worker = new Worker(new URL(functionUrl), {
  workerData: {
    kind: 'upgrade-simulation',
    operators: [],
    config,
    tasks: [],
    baselineScore: 0,
    deadlineAt: Date.now() + 1000,
    reserveMs: 100,
  },
});

const workerMessage = await new Promise((resolve, reject) => {
  worker.once('message', resolve);
  worker.once('error', reject);
  worker.once('exit', (code) => {
    if (code !== 0) reject(new Error(`worker exited with ${code}`));
  });
});

if (!workerMessage || !Array.isArray(workerMessage.results)) {
  throw new Error('worker smoke check returned an invalid message');
}

console.log('optimize function smoke check ok');
