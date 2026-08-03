import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readlink, rm, symlink } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPrivateOptimizerSource } from './private-optimizer-sources.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = await mkdtemp(join(root, '.public-export-check-'))
const includedTopLevel = new Set([
  'src',
  'server',
  'scripts',
  'public',
  'product',
  'tools',
  'index.html',
  'package.json',
  'package-lock.json',
  'optimizer-port-contract.json',
  'tsconfig.json',
  'tsconfig.server.json',
  'vite.config.ts',
  'vitest.config.ts',
  'tokens.css',
])

try {
  await copyPublicWorkspace(root, temporaryRoot)
  const nodeModulesTarget = join(root, 'node_modules')
  await symlink(nodeModulesTarget, join(temporaryRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')

  runNpm(['run', 'build'], temporaryRoot)
  runNpm(['run', 'check:architecture:public'], temporaryRoot)
  runNpm(['test'], temporaryRoot)

  const serverOutputs = (await readdir(join(temporaryRoot, 'server/dist'))).sort()
  const expectedOutputs = ['index.js', 'index.js.map', 'migrate.js', 'migrate.js.map', 'routes.js', 'routes.js.map']
  if (JSON.stringify(serverOutputs) !== JSON.stringify(expectedOutputs)) {
    throw new Error(`public server output mismatch: ${serverOutputs.join(', ')}`)
  }
  process.stdout.write('Public export builds and tests without private optimizer sources\n')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

async function copyPublicWorkspace(sourceRoot, targetRoot) {
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (!includedTopLevel.has(entry.name)) continue
    await cp(join(sourceRoot, entry.name), join(targetRoot, entry.name), {
      recursive: true,
      dereference: false,
      filter: (source) => {
        const path = relative(sourceRoot, source).replaceAll('\\', '/')
        if (path === 'server/dist' || path.startsWith('server/dist/')) return false
        return !isPrivateOptimizerSource(path)
      },
    })
  }

  // fs.cp preserves ordinary symlinks; reject any unexpected workspace link that
  // would escape the temporary public tree before commands are executed there.
  await assertNoEscapingSymlinks(targetRoot, targetRoot)
}

async function assertNoEscapingSymlinks(directory, publicRoot) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await assertNoEscapingSymlinks(path, publicRoot)
    } else if (entry.isSymbolicLink()) {
      const target = resolve(dirname(path), await readlink(path))
      if (target !== publicRoot && !target.startsWith(`${publicRoot}\\`) && !target.startsWith(`${publicRoot}/`)) {
        throw new Error(`public export contains an escaping symlink: ${relative(publicRoot, path)}`)
      }
    }
  }
}

function runNpm(argumentsList, cwd) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(command, argumentsList, {
    cwd,
    env: {
      ...process.env,
      BUILD_CONTEXT: 'public-export-check',
      GENERATE_CHANGELOG_CANDIDATE: 'false',
    },
    encoding: 'utf8',
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${argumentsList.join(' ')} failed\n${result.error?.message || ''}\n${result.stdout || ''}\n${result.stderr || ''}`)
  }
}
