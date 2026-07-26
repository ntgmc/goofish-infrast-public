import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseGitLog } from './changelog-lib.mjs'

export function resolveChangelogGitRoot(sourceRoot, configuredRoot) {
  const value = String(configuredRoot ?? '').trim()
  return value ? resolve(sourceRoot, value) : sourceRoot
}

export function readChangelogCommits(fromSha, toSha, gitRoot) {
  if (fromSha === toSha) throw new Error('the changelog range must use distinct previous and target SHAs')
  try {
    runGit(gitRoot, ['merge-base', '--is-ancestor', fromSha, toSha])
  } catch {
    throw new Error(`the previous changelog SHA ${fromSha} is not an ancestor of ${toSha}`)
  }

  const output = runGit(gitRoot, ['log', `${fromSha}..${toSha}`, '--format=%H%x1f%s%x1f%b%x1e'])
  return parseGitLog(output)
}

function runGit(gitRoot, argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: gitRoot, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout)
  return result.stdout
}
