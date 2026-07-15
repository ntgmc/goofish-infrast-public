import { parentPort, workerData } from 'node:worker_threads'

const busyMs = Number(workerData?.job?.payload_json?.busyMs ?? 1_000)
const deadline = Date.now() + busyMs
while (Date.now() < deadline) {
  // Intentionally block this worker's event loop to exercise the parent timeout.
}
parentPort?.postMessage({ type: 'succeeded', result: { completed: true } })
