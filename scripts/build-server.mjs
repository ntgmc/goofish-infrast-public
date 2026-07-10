import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

await rm('server/dist', { recursive: true, force: true })

await build({
  entryPoints: {
    index: 'server/index.ts',
    routes: 'server/routes.ts',
    'optimize-worker': 'server/optimize-worker.ts',
  },
  outdir: 'server/dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external: ['@node-rs/argon2', 'pg', 'qrcode'],
  logLevel: 'info',
})
