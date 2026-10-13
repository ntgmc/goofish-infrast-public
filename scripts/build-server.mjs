import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import { APP_BUILD_META } from '../src/lib/.generated/build-meta.ts'

const entryPoints = {
  index: 'server/index.ts',
  migrate: 'server/migrate.ts',
  routes: 'server/routes.ts',
  'cultivation-worker': 'server/cultivation/cultivation-worker.ts',
  'import-prts-planning': 'scripts/import-prts-planning.mjs',
  'sync-prts-planning': 'scripts/sync-prts-planning.mjs',
}

readScope(process.argv.slice(2))

await rm('server/dist', { recursive: true, force: true })

await build({
  entryPoints,
  outdir: 'server/dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  banner: { js: `/*! APP_BUILD_META ${JSON.stringify(APP_BUILD_META).replaceAll('*/', '*\\/')} */` },
  external: ['@aws-sdk/client-sesv2', '@node-rs/argon2', 'pg', 'qrcode'],
  logLevel: 'info',
})

function readScope(argumentsList) {
  if (argumentsList.length === 0) return 'public'
  if (argumentsList.length !== 2 || argumentsList[0] !== '--scope') {
    throw new Error('Usage: build-server.mjs [--scope public]')
  }
  const requestedScope = argumentsList[1]
  if (requestedScope !== 'public') {
    throw new Error(`Unsupported server build scope: ${requestedScope}`)
  }
  return requestedScope
}
