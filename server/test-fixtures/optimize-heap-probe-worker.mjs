import { parentPort } from 'node:worker_threads'
import { getHeapStatistics } from 'node:v8'
import { writeFileSync } from 'node:fs'

writeFileSync('/tmp/optimize-heap-probe-result.json', JSON.stringify({ heapLimitMb: getHeapStatistics().heap_size_limit / 1024 / 1024 }))
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
