import { build } from 'esbuild'

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
  external: ['pg', 'qrcode'],
  logLevel: 'info',
})
