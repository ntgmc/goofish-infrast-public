import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile } from './atomic-write.mjs'
import { ARTIFACT_KINDS, isAllowedArtifactPath, requireArtifactKind } from './release-artifact-config.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = resolve(process.env.RELEASE_SOURCE_ROOT || repositoryRoot)
const argumentsMap = parseArguments(process.argv.slice(2))
const kind = requireArtifactKind(argumentsMap.kind)
if (!argumentsMap.output) throw new Error('--output is required')
const output = resolve(argumentsMap.output)

assertChildPath(sourceRoot, output, 'artifact staging output')
await assertDirectory(sourceRoot, 'release source root')
await assertNoSymlinkComponents(sourceRoot, dirname(output))
await mkdir(dirname(output), { recursive: true })
await assertNoSymlinkComponents(sourceRoot, dirname(output))
const realSourceRoot = await realpath(sourceRoot)
const realOutputParent = await realpath(dirname(output))
assertChildPath(realSourceRoot, realOutputParent, 'artifact staging output parent', true)

const outputName = basename(output)
const markerPath = join(dirname(output), `.${outputName}.release-staging-marker.json`)
const temporaryPath = join(dirname(output), `.${outputName}.tmp-${process.pid}-${randomUUID()}`)
const backupPath = join(dirname(output), `.${outputName}.previous-${process.pid}-${randomUUID()}`)
const outputExists = await pathExists(output)
if (outputExists) await assertManagedOutput(output, markerPath, kind, outputName)

let movedPrevious = false
let published = false
try {
  await mkdir(temporaryPath, { recursive: false, mode: 0o700 })
  const definition = ARTIFACT_KINDS[kind]
  for (const recursiveRoot of definition.recursiveRoots) {
    const source = join(sourceRoot, recursiveRoot)
    await assertTreeContainsOnlyFilesAndDirectories(source)
    await cp(source, join(temporaryPath, recursiveRoot), { recursive: true, errorOnExist: true })
  }
  for (const path of definition.required) {
    if (definition.recursiveRoots.some((recursiveRoot) => path.startsWith(`${recursiveRoot}/`))) continue
    const source = join(sourceRoot, path)
    await assertRegularFile(source)
    const target = join(temporaryPath, path)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { errorOnExist: true })
  }
  await assertStagedArtifactSurface(temporaryPath, kind)

  if (outputExists) {
    await rename(output, backupPath)
    movedPrevious = true
  }
  try {
    await rename(temporaryPath, output)
    await atomicWriteFile(markerPath, `${JSON.stringify({
      schema_version: 1,
      kind,
      output: outputName,
    })}\n`)
    published = true
  } catch (error) {
    await rm(output, { recursive: true, force: true })
    if (movedPrevious) {
      await rename(backupPath, output)
      movedPrevious = false
    }
    throw error
  }
} finally {
  await rm(temporaryPath, { recursive: true, force: true })
  if (published && movedPrevious) await rm(backupPath, { recursive: true, force: true })
}

process.stdout.write(`Staged ${kind} artifact at ${output}\n`)

async function assertManagedOutput(path, marker, expectedKind, expectedOutput) {
  const stats = await lstat(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('existing artifact staging output must be a managed directory')
  let metadata
  try {
    metadata = JSON.parse(await readFile(marker, 'utf8'))
  } catch {
    throw new Error('refusing to replace an artifact staging directory without a valid tool marker')
  }
  if (metadata.schema_version !== 1 || metadata.kind !== expectedKind || metadata.output !== expectedOutput) {
    throw new Error('artifact staging marker does not match the requested output')
  }
}

async function assertStagedArtifactSurface(base, artifactKind) {
  const files = await listFiles(base)
  for (const file of files) {
    const path = relative(base, file).replaceAll('\\', '/')
    if (!isAllowedArtifactPath(artifactKind, path)) throw new Error(`unexpected staged artifact entry: ${path}`)
  }
  for (const required of ARTIFACT_KINDS[artifactKind].required) {
    if (!files.some((file) => relative(base, file).replaceAll('\\', '/') === required)) {
      throw new Error(`required staged artifact entry is missing: ${required}`)
    }
  }
}

async function listFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`staged artifact contains unsupported filesystem entry: ${path}`)
  }
  return files
}

async function assertTreeContainsOnlyFilesAndDirectories(path) {
  const stats = await lstat(path)
  if (stats.isSymbolicLink()) throw new Error(`release source contains a symbolic link: ${path}`)
  if (stats.isFile()) return
  if (!stats.isDirectory()) throw new Error(`release source contains an unsupported filesystem entry: ${path}`)
  for (const entry of await readdir(path)) await assertTreeContainsOnlyFilesAndDirectories(join(path, entry))
}

async function assertRegularFile(path) {
  const stats = await lstat(path)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`release source must be a regular file: ${path}`)
  const resolved = await realpath(path)
  assertChildPath(await realpath(sourceRoot), resolved, 'release source file', true)
}

async function assertDirectory(path, label) {
  const stats = await lstat(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} must be a real directory`)
}

async function assertNoSymlinkComponents(root, targetParent) {
  const pathFromRoot = relative(root, targetParent)
  if (pathFromRoot.startsWith('..') || pathFromRoot === '..') throw new Error('artifact staging output parent is outside the release source root')
  let current = root
  for (const part of pathFromRoot.split(/[\\/]/).filter(Boolean)) {
    current = join(current, part)
    try {
      const stats = await lstat(current)
      if (stats.isSymbolicLink()) throw new Error(`artifact staging path contains a symbolic link: ${current}`)
      if (!stats.isDirectory()) throw new Error(`artifact staging path component is not a directory: ${current}`)
    } catch (error) {
      if (error?.code === 'ENOENT') break
      throw error
    }
  }
}

function assertChildPath(root, child, label, allowEqual = false) {
  const pathFromRoot = relative(root, child)
  if ((!allowEqual && pathFromRoot === '') || pathFromRoot === '..' || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || resolve(root, pathFromRoot) !== resolve(child)) {
    throw new Error(`${label} must be inside the release source root`)
  }
}

async function pathExists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
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
