const normalize = (path) => path.replaceAll('\\', '/').replace(/^\.\//, '')

const PRIVATE_OPTIMIZER_EXACT_PATHS = Object.freeze([
  'server/all.ts',
  'server/worker.ts',
  'server/optimize-worker.ts',
  'server/optimization/jobs/result-formatting.ts',
])

const PRIVATE_OPTIMIZER_PATH_PREFIXES = Object.freeze([
  'server/optimization/candidates/',
  'server/optimization/domain/',
  'server/optimization/economics/',
  'server/optimization/engine/',
  'server/optimization/formatting/',
  'server/optimization/rules/',
  'server/optimization/scenario-comparison/',
  'server/optimization/solvers/',
  'server/optimization/jobs/executor',
])

export function isPrivateOptimizerSource(path) {
  const normalized = normalize(path)
  return PRIVATE_OPTIMIZER_EXACT_PATHS.includes(normalized)
    || PRIVATE_OPTIMIZER_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export function containsPrivateOptimizerSourcePath(value) {
  const normalized = normalize(String(value)).replace(/^(?:\.\.\/)+/, '')
  if (isPrivateOptimizerSource(normalized)) return true
  const serverOffset = normalized.indexOf('server/')
  return serverOffset >= 0 && isPrivateOptimizerSource(normalized.slice(serverOffset))
}
