import { build } from 'esbuild'

await build({
  entryPoints: {
    index: 'server/index.ts',
    routes: 'server/routes.ts',
  },
  outdir: 'server/dist',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external: ['pg'],
  logLevel: 'info',
})
