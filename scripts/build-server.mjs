import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

const entryPoints = {
  index: 'server/index.ts',
  migrate: 'server/migrate.ts',
  routes: 'server/routes.ts',
}

readScope(process.argv.slice(2))

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
    throw new Error('Usage: build-server.mjs [--scope public]')
  }
  const requestedScope = argumentsList[1]
  if (requestedScope !== 'public') {
    throw new Error(`Unsupported server build scope: ${requestedScope}`)
  }
  return requestedScope
}
