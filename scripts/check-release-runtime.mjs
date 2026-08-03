import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.argv[2] || process.cwd())
for (const path of ['server/dist/index.js', 'server/dist/migrate.js', 'server/dist/routes.js']) {
  const absolutePath = resolve(root, path)
  await access(absolutePath)
  const result = spawnSync(process.execPath, ['--check', absolutePath], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`runtime syntax check failed for ${path}: ${result.stderr || result.stdout}`)
}

await import(pathToFileURL(resolve(root, 'server/dist/routes.js')).href)
console.log('[check-release-runtime] server bundles load with locked production dependencies')
