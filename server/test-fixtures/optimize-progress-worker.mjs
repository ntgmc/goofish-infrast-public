import { parentPort } from 'node:worker_threads'

parentPort?.postMessage({ type: 'progress', stage: 'simulating_upgrades' })
setTimeout(() => {
  parentPort?.postMessage({
    type: 'succeeded',
    result: {
      author: 'test',
      title: 'result',
      description: 'result',
      buildingType: 2,
      planTimes: '8h',
      plans: [],
      raw_results: [],
    },
  })
}, 100)
