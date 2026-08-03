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
      'server/database-schema-contract.json',
      'scripts/check-public-http-smoke.mjs',
      'scripts/check-release-runtime.mjs',
      'scripts/backup-manifest.mjs',
      'scripts/migration-verifier-lib.mjs',
      'scripts/verify-migrated-data.mjs',
      'scripts/write-pg-service.mjs',
      'package.json',
      'package-lock.json',
      'release-sbom.cdx.json',
      'changelog-release.json',
      'changelog-release.md',
    ]),
    recursiveRoots: Object.freeze(['dist']),
  }),
})

export function requireArtifactKind(value) {
  const kind = String(value || '').trim()
  if (!Object.hasOwn(ARTIFACT_KINDS, kind)) {
    throw new Error('artifact kind must be public')
  }
  return kind
}

export function isAllowedArtifactPath(kind, path) {
  const definition = ARTIFACT_KINDS[kind]
  if (definition.required.includes(path)) return true
  return definition.recursiveRoots.some((root) => path.startsWith(`${root}/`))
}
