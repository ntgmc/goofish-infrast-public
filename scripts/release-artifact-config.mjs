export const ARTIFACT_KINDS = Object.freeze({
  public: Object.freeze({
    required: Object.freeze([
      'dist/index.html',
      'server/dist/index.js',
      'server/dist/index.js.map',
      'server/dist/migrate.js',
      'server/dist/migrate.js.map',
      'server/dist/routes.js',
      'server/dist/routes.js.map',
      'changelog-release.json',
      'changelog-release.md',
    ]),
    recursiveRoots: Object.freeze(['dist']),
  }),
  worker: Object.freeze({
    required: Object.freeze([
      'server/dist/worker.js',
      'server/dist/worker.js.map',
      'server/dist/optimize-worker.js',
      'server/dist/optimize-worker.js.map',
      'changelog-release.json',
      'changelog-release.md',
    ]),
    recursiveRoots: Object.freeze([]),
  }),
  combined: Object.freeze({
    required: Object.freeze([
      'dist/index.html',
      'server/dist/all.js',
      'server/dist/all.js.map',
      'server/dist/optimize-worker.js',
      'server/dist/optimize-worker.js.map',
      'server/dist/migrate.js',
      'server/dist/migrate.js.map',
      'changelog-release.json',
      'changelog-release.md',
    ]),
    recursiveRoots: Object.freeze(['dist']),
  }),
})

export function requireArtifactKind(value) {
  const kind = String(value || '').trim()
  if (!Object.hasOwn(ARTIFACT_KINDS, kind)) {
    throw new Error('artifact kind must be one of: public, worker, combined')
  }
  return kind
}

export function isAllowedArtifactPath(kind, path) {
  const definition = ARTIFACT_KINDS[kind]
  if (definition.required.includes(path)) return true
  return definition.recursiveRoots.some((root) => path.startsWith(`${root}/`))
}
