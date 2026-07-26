import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

const entryPointGroups = {
  public: {
    index: 'server/index.ts',
    migrate: 'server/migrate.ts',
    routes: 'server/routes.ts',
  },
  private: {
    all: 'server/all.ts',
    worker: 'server/worker.ts',
    'optimize-worker': 'server/optimize-worker.ts',
  },
}

const scope = readScope(process.argv.slice(2))
const entryPoints = scope === 'release'
  ? { ...entryPointGroups.public, ...entryPointGroups.private }
  : entryPointGroups[scope]

await rm('server/dist', { recursive: true, force: true })

await build({
  entryPoints,
  outdir: 'server/dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external: ['@node-rs/argon2', 'pg', 'qrcode'],
  logLevel: 'info',
})

function readScope(argumentsList) {
  if (argumentsList.length === 0) return 'public'
  if (argumentsList.length !== 2 || argumentsList[0] !== '--scope') {
    throw new Error('Usage: build-server.mjs [--scope public|private|release]')
  }
  const requestedScope = argumentsList[1]
  if (!['public', 'private', 'release'].includes(requestedScope)) {
    throw new Error(`Unsupported server build scope: ${requestedScope}`)
  }
  return requestedScope
}
