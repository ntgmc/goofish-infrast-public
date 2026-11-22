import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = new URL('../', import.meta.url)
const output = new URL('.cache/aktools-deploy/', root)
const result = await build({
  absWorkingDir: fileURLToPath(root), entryPoints: ['deploy/aktools/clock.ts'],
  bundle: true, write: false, minify: true, format: 'iife', target: ['es2022'],
})
const script = result.outputFiles[0].text.trim()
const sharedStyles = await Promise.all(['tokens.css', 'src/pages/v2/value-clock.css'].map((path) => readFile(new URL(path, root), 'utf8')))
const template = await readFile(new URL('deploy/aktools/index.html', root), 'utf8')
const html = template.replace('/* __SHARED_STYLES__ */', sharedStyles.join('\n'))
  .replace('/* __CLOCK_SCRIPT__ */', () => script)
  .replace('__SCRIPT_HASH__', createHash('sha256').update(script).digest('base64'))
await mkdir(output, { recursive: true })
await writeFile(new URL('index.html', output), html)
for (const name of ['value-clock.conf', 'apply.sh']) await copyFile(new URL(`deploy/aktools/${name}`, root), new URL(name, output))
console.log(`AkTools: ${fileURLToPath(output)} (${Buffer.byteLength(html)} bytes; live API only)`)
