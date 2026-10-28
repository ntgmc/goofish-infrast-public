import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(root, '.cache/schedule-benchmark.html')
await mkdir(dirname(output), { recursive: true })
if (process.argv.includes('--test')) {
  const testFile = resolve(root, '.cache/schedule-benchmark-test.cjs')
  try {
    await build({ absWorkingDir: root, entryPoints: ['tools/schedule-benchmark/model.test.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: testFile, logLevel: 'warning' })
    const test = spawnSync(process.execPath, ['--test', testFile], { stdio: 'inherit' })
    process.exitCode = test.status ?? 1
  } finally { await rm(testFile, { force: true }) }
} else {
  const sources = await Promise.all(['src/lib/schedule-comparison.ts', 'src/lib/production-sanity.ts', 'src/lib/orundum-economy.ts', 'src/lib/recycling.ts', 'src/data/recycling.json'].map(path => readFile(resolve(root, path))))
  const valuation = createHash('sha256').update(Buffer.concat(sources)).digest('hex')
  const result = await build({
    absWorkingDir: root, entryPoints: ['tools/schedule-benchmark/app.tsx'], bundle: true,
    platform: 'browser', format: 'iife', target: 'es2022', minify: true, write: false,
    outfile: 'benchmark.js', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline',
  })
  const script = result.outputFiles.find(file => file.path.endsWith('.js')).text.replaceAll('</script', '<\\/script')
  const css = result.outputFiles.find(file => file.path.endsWith('.css')).text
  const html = `<!doctype html>
<html lang="zh-CN" data-valuation="${valuation}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link rel="icon" href="data:,"><title>MaaTool 三站排班测试工作台</title><style>${css}</style></head>
<body><div id="root"></div><script>${script}</script></body>
</html>
`
  await writeFile(output, html)
  console.log(`已生成离线工作台：${output}\n双击 HTML 即可使用，无需启动服务。`)
}
