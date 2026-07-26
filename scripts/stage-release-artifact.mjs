import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARTIFACT_KINDS, requireArtifactKind } from './release-artifact-config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argumentsMap = parseArguments(process.argv.slice(2))
const kind = requireArtifactKind(argumentsMap.kind)
const output = resolve(argumentsMap.output || '')
if (!argumentsMap.output) throw new Error('--output is required')
if (output === root || !output.startsWith(`${root}\\`) && !output.startsWith(`${root}/`)) {
  throw new Error('artifact staging output must be inside the repository workspace')
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

const definition = ARTIFACT_KINDS[kind]
for (const recursiveRoot of definition.recursiveRoots) {
  await cp(join(root, recursiveRoot), join(output, recursiveRoot), { recursive: true })
}
for (const path of definition.required) {
  if (definition.recursiveRoots.some((recursiveRoot) => path.startsWith(`${recursiveRoot}/`))) continue
  const target = join(output, path)
  await mkdir(dirname(target), { recursive: true })
  await cp(join(root, path), target)
}

process.stdout.write(`Staged ${kind} artifact at ${output}\n`)

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    if (!key?.startsWith('--') || values[index + 1] === undefined) throw new Error(`invalid argument: ${key || ''}`)
    parsed[key.slice(2)] = values[index + 1]
  }
  return parsed
}
