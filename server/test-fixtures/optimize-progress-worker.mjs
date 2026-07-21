import { parentPort } from 'node:worker_threads'

parentPort?.postMessage({ type: 'progress', stage: 'simulating_upgrades' })
setTimeout(() => {
  parentPort?.postMessage({ type: 'succeeded', result: { ok: true } })
}, 100)
