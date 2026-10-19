import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateChangelogEnvelope } from './changelog-lib.mjs'
import { ARTIFACT_KINDS, isAllowedArtifactPath, requireArtifactKind } from './release-artifact-config.mjs'
import { containsPrivateOptimizerSourcePath } from './private-optimizer-sources.mjs'
import { atomicWriteFile } from './atomic-write.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(process.env.RELEASE_ROOT || repositoryRoot)
const allowSourceTree = process.env.RELEASE_ALLOW_SOURCE_TREE === 'true'
const [command, ...rawArguments] = process.argv.slice(2)
const argumentsMap = parseArguments(rawArguments)

if (command === 'create') {
  await createReleaseManifest(requireArtifactKind(argumentsMap.kind))
} else if (command === 'decision') {
  await writeDecision(argumentsMap.deployable === 'true')
} else if (command === 'verify') {
  await verifyReleaseManifest(requireArtifactKind(argumentsMap.kind))
} else {
  throw new Error('Usage: release-artifact.mjs <create|verify> --kind <public|worker|combined> --sha <sha>; or decision --sha <sha> --deployable <true|false>')
}

async function createReleaseManifest(kind) {
  const targetSha = requireSha(argumentsMap.sha || process.env.VERSION_SOURCE_SHA || process.env.GITHUB_SHA)
  const files = await collectArtifactHashes(root, kind, false)
  assertArtifactFiles(kind, files)
  const buildMeta = await readArtifactBuildMetadata(root, files)
  if (buildMeta.git_sha !== targetSha) throw new Error(`compiled build metadata SHA mismatch: ${buildMeta.git_sha || 'missing'}`)
  const changelog = await readChangelogEnvelope(root, targetSha, buildMeta)
  if (kind === 'public') {
    await assertPublicArtifactDoesNotLeakPrivateSources(root, files)
    await assertPublicRuntimeContract(root)
  }
  const manifest = {
    schema_version: 3,
    artifact_kind: kind,
    target_sha: targetSha,
    deployable: buildMeta.source_mode === 'full',
    built_at: buildMeta.generated_at,
    build_context: buildMeta.build_context,
    build_meta: buildMeta,
    github_run_id: argumentsMap['run-id'] || process.env.GITHUB_RUN_ID || 'unknown',
    github_run_url: argumentsMap['run-url'] || process.env.GITHUB_RUN_URL || 'unknown',
    node_version: process.version,
    pnpm_version: resolvePnpmVersion(),
    changelog,
    files,
  }
  await writeJson(join(root, 'build-manifest.json'), manifest)
}

async function writeDecision(deployable, explicitSha) {
  const targetSha = requireSha(explicitSha || argumentsMap.sha || process.env.GITHUB_SHA)
  await writeJson(join(root, 'deployment-decision.json'), {
    schema_version: 1,
    target_sha: targetSha,
    deployable,
    reason: deployable ? 'build-relevant release artifacts' : (argumentsMap.reason || 'no build-relevant changes'),
  })
}

async function verifyReleaseManifest(kind) {
  const targetSha = requireSha(argumentsMap.sha || process.env.TARGET_SHA)
  const manifest = JSON.parse(await readFile(join(root, 'build-manifest.json'), 'utf8'))
  if (manifest.schema_version !== 3) throw new Error('unsupported build manifest schema')
  if (manifest.artifact_kind !== kind) {
    throw new Error(`artifact kind mismatch: expected ${kind}, received ${manifest.artifact_kind || 'missing'}`)
  }
  if (manifest.target_sha !== targetSha) throw new Error(`artifact target SHA mismatch: ${manifest.target_sha || 'missing'}`)
  if (manifest.build_meta?.git_sha !== targetSha) throw new Error('artifact build metadata SHA mismatch')
  if (manifest.deployable !== (manifest.build_meta?.source_mode === 'full')) {
    throw new Error('artifact deployability does not match efficiency data source mode')
  }
  if (manifest.built_at !== manifest.build_meta?.generated_at || manifest.build_context !== manifest.build_meta?.build_context) {
    throw new Error('artifact manifest build metadata mismatch')
  }
  const changelog = await readChangelogEnvelope(root, targetSha, manifest.build_meta)
  if (JSON.stringify(manifest.changelog) !== JSON.stringify(changelog)) throw new Error('artifact changelog metadata mismatch')

  const expectedFiles = manifest.files
  if (!expectedFiles || typeof expectedFiles !== 'object') throw new Error('artifact file hashes are missing')
  assertArtifactFiles(kind, expectedFiles)

  const actualFiles = await collectArtifactHashes(root, kind, allowSourceTree)
  assertArtifactFiles(kind, actualFiles)
  const expectedPaths = Object.keys(expectedFiles).sort()
  const actualPaths = Object.keys(actualFiles).sort()
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) throw new Error('artifact file list does not match manifest')
  for (const path of expectedPaths) {
    if (actualFiles[path] !== expectedFiles[path]) throw new Error(`artifact hash mismatch: ${path}`)
  }
  const compiledBuildMeta = await readArtifactBuildMetadata(root, actualFiles)
  if (JSON.stringify(compiledBuildMeta) !== JSON.stringify(manifest.build_meta)) throw new Error('compiled build metadata does not match manifest')
  if (kind === 'public') {
    await assertPublicArtifactDoesNotLeakPrivateSources(root, actualFiles)
    await assertPublicRuntimeContract(root)
  }
  process.stdout.write(`Verified ${kind} release artifact for ${targetSha}\n`)
}

function assertArtifactFiles(kind, files) {
  for (const required of ARTIFACT_KINDS[kind].required) {
    if (!files[required]) throw new Error(`required ${kind} artifact entry is missing from manifest: ${required}`)
  }
  for (const path of Object.keys(files)) {
    if (!isAllowedArtifactPath(kind, path)) throw new Error(`unexpected ${kind} artifact entry: ${path}`)
  }
}

async function assertPublicArtifactDoesNotLeakPrivateSources(base, files) {
  const serverPaths = Object.keys(files).filter((path) => path.startsWith('server/dist/'))
  const expectedServerPaths = ARTIFACT_KINDS.public.required.filter((path) => path.startsWith('server/dist/')).sort()
  if (JSON.stringify(serverPaths.sort()) !== JSON.stringify(expectedServerPaths)) {
    throw new Error(`public server output is not exact: ${serverPaths.join(', ')}`)
  }

  for (const path of serverPaths.filter((path) => path.endsWith('.map'))) {
    let map
    try {
      map = JSON.parse(await readFile(join(base, path), 'utf8'))
    } catch (error) {
      throw new Error(`invalid public sourcemap ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const source of map.sources || []) {
      if (isPrivatePublicMapReference(source)) throw new Error(`public sourcemap references private optimizer source: ${source}`)
    }
    for (const content of map.sourcesContent || []) {
      if (typeof content === 'string' && containsPrivateImport(content)) {
        throw new Error(`public sourcemap embeds a private optimizer import: ${path}`)
      }
    }
  }
}

async function assertPublicRuntimeContract(base) {
  const [packageJson, packageLock, sbom] = await Promise.all([
    readFile(join(base, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(base, 'pnpm-lock.yaml')),
    readFile(join(base, 'release-sbom.cdx.json'), 'utf8').then(JSON.parse),
  ])
  if (!String(packageJson.engines?.node ?? '').includes('24')) throw new Error('public artifact must declare the Node 24 runtime')
  if (!/^pnpm@12\./.test(packageJson.packageManager ?? '')) throw new Error('public artifact must pin pnpm 12')
  if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.6' || !Array.isArray(sbom.components) || sbom.components.length === 0) {
    throw new Error('public release SBOM is missing or invalid')
  }
  const lockHash = createHash('sha256').update(packageLock).digest('hex')
  if (!sbom.metadata?.properties?.some((property) => property.name === 'goofish:lockfile:sha256' && property.value === lockHash)) {
    throw new Error('public release SBOM does not match the pnpm lockfile')
  }
  for (const dependency of ['@aws-sdk/client-sesv2', '@node-rs/argon2', 'pg', 'qrcode']) {
    if (!packageJson.dependencies?.[dependency]) throw new Error(`public runtime dependency is not declared: ${dependency}`)
    if (!sbom.components.some((component) => (component.group ? `${component.group}/${component.name}` : component.name) === dependency && component.version)) {
      throw new Error(`public runtime dependency is not locked in the SBOM: ${dependency}`)
    }
  }
}

function isPrivatePublicMapReference(value) {
  const normalized = String(value).replaceAll('\\', '/')
  if (containsPrivateOptimizerSourcePath(normalized)) return true
  return /(?:^|\/)(?:all|worker|optimize-worker|optimize-job-runner)\.ts$/.test(normalized)
    || /optimization\/(?:candidates|domain|economics|engine|formatting|rules|solvers)\//.test(normalized)
    || /optimization\/scenario-comparison\/service\.ts$/.test(normalized)
    || /optimization\/jobs\/(?:executor(?:-[^/]*)?|result-formatting)\.ts$/.test(normalized)
}

function containsPrivateImport(content) {
  return /(?:from\s+|import\s*\()['"][^'"]*(?:optimize-job-runner|optimization\/jobs\/(?:executor|result-formatting)|optimization\/scenario-comparison\/service|optimization\/(?:candidates|domain|economics|engine|formatting|rules|solvers)\/)/.test(content)
}

async function readChangelogEnvelope(releaseRoot, targetSha, buildMeta) {
  let envelope
  let notes
  try {
    [envelope, notes] = await Promise.all([
      readFile(join(releaseRoot, 'changelog-release.json'), 'utf8').then((source) => JSON.parse(source)),
      readFile(join(releaseRoot, 'changelog-release.md'), 'utf8'),
    ])
  } catch (error) {
    throw new Error(`release changelog metadata is missing or invalid: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!notes.trim().startsWith('#')) throw new Error('release changelog notes must start with a Markdown heading')
  validateChangelogEnvelope(envelope)
  if (!envelope.candidate) throw new Error('release artifacts require a candidate changelog')

  const release = envelope.release
  if (release.targetSha !== targetSha) throw new Error('release changelog target SHA mismatch')
  if (release.version !== buildMeta.frontend_version || release.version !== buildMeta.backend_version) {
    throw new Error('release changelog version does not match build metadata')
  }
  return envelope
}

async function collectArtifactHashes(base, kind, ignoreUnrelatedSourceFiles) {
  const output = {}
  const files = ignoreUnrelatedSourceFiles
    ? await collectArtifactSurfaceFiles(base, kind)
    : await walk(base)
  for (const file of files) {
    const key = relative(base, file).replace(/\\/g, '/')
    if (key === 'build-manifest.json' || key === 'deployment-decision.json') continue
    output[key] = createHash('sha256').update(await readFile(file)).digest('hex')
  }
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

async function collectArtifactSurfaceFiles(base, kind) {
  const files = []
  const definition = ARTIFACT_KINDS[kind]
  for (const recursiveRoot of definition.recursiveRoots) {
    files.push(...await walkIfPresent(join(base, recursiveRoot)))
  }
  files.push(...await walkIfPresent(join(base, 'server/dist')))
  for (const path of definition.required) {
    try {
      await readFile(join(base, path))
      files.push(join(base, path))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return [...new Set(files)]
}

async function walkIfPresent(directory) {
  try {
    return await walk(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`artifact contains unsupported filesystem entry: ${path}`)
  }
  return files
}

async function readArtifactBuildMetadata(base, files) {
  const metadata = []
  let frontendEntries = 0
  for (const path of Object.keys(files).filter((path) => path.endsWith('.js') && (path.startsWith('dist/') || path.startsWith('server/dist/')))) {
    const source = await readFile(join(base, path), 'utf8')
    const match = source.match(/(?:^|\n)\/\*! APP_BUILD_META ([^\r\n]+) \*\//)
    if (!match) {
      if (path.startsWith('server/dist/')) throw new Error(`compiled build metadata is missing: ${path}`)
      continue
    }
    metadata.push({ path, value: JSON.parse(match[1]) })
    if (path.startsWith('dist/')) frontendEntries += 1
  }
  if (frontendEntries === 0) throw new Error('frontend compiled build metadata is missing')
  const buildMeta = metadata[0].value
  for (const entry of metadata) {
    if (JSON.stringify(entry.value) !== JSON.stringify(buildMeta)) throw new Error(`compiled build metadata mismatch: ${entry.path}`)
  }
  return buildMeta
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    if (!key?.startsWith('--') || values[index + 1] === undefined) throw new Error(`invalid argument: ${key || ''}`)
    parsed[key.slice(2)] = values[index + 1]
  }
  return parsed
}

function requireSha(value) {
  const sha = String(value || '').trim().toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('a full 40-character target SHA is required')
  return sha
}

function resolvePnpmVersion() {
  const userAgentVersion = process.env.npm_config_user_agent?.match(/^pnpm\/([^ ]+)/)?.[1]
  if (userAgentVersion) return userAgentVersion
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  return execFileSync(command, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim()
}

async function writeJson(path, value) {
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`)
  JSON.parse(await readFile(path, 'utf8'))
}
