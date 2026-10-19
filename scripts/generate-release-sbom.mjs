import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeFileIfChanged } from './atomic-write.mjs'

const root = resolve(import.meta.dirname, '..')
const lock = await readFile(resolve(root, 'pnpm-lock.yaml'))
const sbom = JSON.parse(execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
  'sbom', '--sbom-format', 'cyclonedx', '--sbom-spec-version', '1.6',
  '--sbom-type', 'application', '--prod', '--lockfile-only',
], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 16 * 1024 * 1024 }))
sbom.metadata.properties = [
  ...(sbom.metadata.properties ?? []),
  { name: 'goofish:lockfile:sha256', value: createHash('sha256').update(lock).digest('hex') },
]
await writeFileIfChanged(resolve(root, 'release-sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`)
console.log(`[generate-release-sbom] wrote ${sbom.components.length} locked production components`)
