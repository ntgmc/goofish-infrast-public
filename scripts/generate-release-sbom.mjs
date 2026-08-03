import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeFileIfChanged } from './atomic-write.mjs'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const packageLockSource = await readFile(resolve(root, 'package-lock.json'), 'utf8')
const packageLock = JSON.parse(packageLockSource)
if (packageLock.lockfileVersion < 3 || !packageLock.packages) throw new Error('release SBOM requires an npm lockfileVersion 3 packages map')

const components = Object.entries(packageLock.packages)
  .filter(([path, entry]) => path.startsWith('node_modules/') && entry.version && entry.dev !== true)
  .map(([path, entry]) => {
    const name = entry.name || path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    return {
      type: 'library',
      'bom-ref': `pkg:npm/${encodeURIComponent(name)}@${entry.version}`,
      name,
      version: entry.version,
      purl: `pkg:npm/${encodeURIComponent(name)}@${entry.version}`,
      ...(entry.license ? { licenses: [{ license: { name: entry.license } }] } : {}),
    }
  })
  .sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']))

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${contentUuid(packageLockSource)}`,
  version: 1,
  metadata: {
    component: {
      type: 'application',
      name: packageJson.name,
      version: packageJson.version,
      'bom-ref': `pkg:npm/${encodeURIComponent(packageJson.name)}@${packageJson.version}`,
    },
  },
  components,
}

await writeFileIfChanged(resolve(root, 'release-sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`)
JSON.parse(await readFile(resolve(root, 'release-sbom.cdx.json'), 'utf8'))
console.log(`[generate-release-sbom] wrote ${components.length} locked production components`)

function contentUuid(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
}
