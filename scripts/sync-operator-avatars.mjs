import { mkdtemp, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_OWNER = 'ZOOT-Plus'
const SOURCE_REPO = 'zoot-plus-frontend'
const SOURCE_REF = 'dev'
const SOURCE_PATH = 'public/assets/operator-avatars/webp96'
const API_VERSION = '2022-11-28'
const CONCURRENCY = 6
const FETCH_ATTEMPTS = 4
const RETRY_BASE_DELAY_MS = 750

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targetDir = resolve(root, 'public/webp96')
const checkOnly = process.argv.includes('--check')
const token = process.env.OPERATOR_AVATAR_SOURCE_TOKEN || process.env.GITHUB_TOKEN || ''
const tempDir = await mkdtemp(join(tmpdir(), 'operator-avatars-'))
let exitCode = 0

try {
  const remoteFiles = await listRemoteAvatarFiles()
  await downloadRemoteFiles(remoteFiles, tempDir)

  const plan = await compareFiles(remoteFiles, tempDir, targetDir)
  printPlan(plan)

  if (!plan.hasChanges) {
    console.log('Operator avatars are already up to date.')
  } else if (checkOnly) {
    console.error('Operator avatars are out of sync. Run npm run sync:operator-avatars to update them.')
    exitCode = 1
  } else {
    await applyPlan(plan, tempDir, targetDir)
    console.log('Operator avatars synced successfully.')
  }
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

if (exitCode !== 0) process.exit(exitCode)

async function listRemoteAvatarFiles() {
  const url = new URL(`https://api.github.com/repos/${SOURCE_OWNER}/${SOURCE_REPO}/contents/${SOURCE_PATH}`)
  url.searchParams.set('ref', SOURCE_REF)

  const response = await fetchWithRetry(url, {
    headers: githubHeaders({ accept: 'application/vnd.github+json' }),
  }, `Failed to list ${SOURCE_OWNER}/${SOURCE_REPO}:${SOURCE_PATH}`)

  if (!response.ok) {
    throw new Error(await formatGithubError(response, `Failed to list ${SOURCE_OWNER}/${SOURCE_REPO}:${SOURCE_PATH}`))
  }

  const payload = await response.json()
  if (!Array.isArray(payload)) {
    throw new Error(`Expected GitHub Contents API to return an array for ${SOURCE_PATH}.`)
  }

  const files = payload
    .filter((entry) => entry?.type === 'file' && typeof entry.name === 'string' && entry.name.endsWith('.webp'))
    .map((entry) => ({
      name: entry.name,
      size: Number(entry.size),
      sha: String(entry.sha || ''),
      downloadUrl: String(entry.download_url || ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (files.length === 0) {
    throw new Error(`No .webp files found in ${SOURCE_OWNER}/${SOURCE_REPO}:${SOURCE_PATH}.`)
  }

  const seen = new Set()
  for (const file of files) {
    if (!file.downloadUrl) throw new Error(`GitHub did not provide a download_url for ${file.name}.`)
    if (seen.has(file.name)) throw new Error(`Duplicate remote avatar file name: ${file.name}.`)
    seen.add(file.name)
  }

  return files
}

async function downloadRemoteFiles(files, destinationDir) {
  await mkdir(destinationDir, { recursive: true })
  let nextIndex = 0

  async function worker() {
    while (nextIndex < files.length) {
      const index = nextIndex
      nextIndex += 1
      const file = files[index]
      await downloadFile(file, join(destinationDir, file.name))
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker()))
}

async function downloadFile(file, destinationPath) {
  const response = await fetchWithRetry(file.downloadUrl, {
    headers: githubHeaders({ accept: 'application/octet-stream', includeAuth: false }),
  }, `Failed to download ${file.name}`)

  if (!response.ok) {
    throw new Error(await formatGithubError(response, `Failed to download ${file.name}`))
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (Number.isFinite(file.size) && file.size > 0 && bytes.length !== file.size) {
    throw new Error(`Downloaded ${file.name} with ${bytes.length} bytes, expected ${file.size}.`)
  }

  await writeFile(destinationPath, bytes)
}

async function compareFiles(remoteFiles, sourceDir, destinationDir) {
  const remoteNames = new Set(remoteFiles.map((file) => file.name))
  const localNames = new Set(await listLocalWebpFiles(destinationDir))
  const added = []
  const updated = []
  const deleted = []

  for (const file of remoteFiles) {
    const sourcePath = join(sourceDir, file.name)
    const destinationPath = join(destinationDir, file.name)

    if (!localNames.has(file.name)) {
      added.push(file.name)
      continue
    }

    const [sourceBytes, destinationBytes] = await Promise.all([
      readFile(sourcePath),
      readFile(destinationPath),
    ])
    if (!sourceBytes.equals(destinationBytes)) updated.push(file.name)
  }

  for (const fileName of localNames) {
    if (!remoteNames.has(fileName)) deleted.push(fileName)
  }

  return {
    added,
    updated,
    deleted,
    remoteFiles,
    hasChanges: added.length > 0 || updated.length > 0 || deleted.length > 0,
  }
}

async function applyPlan(plan, sourceDir, destinationDir) {
  await mkdir(destinationDir, { recursive: true })

  for (const fileName of [...plan.added, ...plan.updated]) {
    await writeFile(join(destinationDir, fileName), await readFile(join(sourceDir, fileName)))
  }

  for (const fileName of plan.deleted) {
    await unlink(join(destinationDir, fileName))
  }
}

async function listLocalWebpFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.webp'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function printPlan(plan) {
  console.log(`Source: ${SOURCE_OWNER}/${SOURCE_REPO}@${SOURCE_REF}/${SOURCE_PATH}`)
  console.log(`Target: ${relativeToRoot(targetDir)}`)
  console.log(`Remote files: ${plan.remoteFiles.length}`)
  console.log(`Changes: +${plan.added.length} ~${plan.updated.length} -${plan.deleted.length}`)
  printFileGroup('Added', plan.added)
  printFileGroup('Updated', plan.updated)
  printFileGroup('Deleted', plan.deleted)
}

function printFileGroup(label, files) {
  if (files.length === 0) return
  const visible = files.slice(0, 20)
  console.log(`${label}: ${visible.join(', ')}${files.length > visible.length ? `, ... (${files.length - visible.length} more)` : ''}`)
}

function githubHeaders({ accept, includeAuth = true }) {
  const headers = {
    Accept: accept,
    'User-Agent': 'goofish-infrast-operator-avatar-sync',
    'X-GitHub-Api-Version': API_VERSION,
  }
  if (includeAuth && token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function fetchWithRetry(url, options, message) {
  let lastError = null

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, options)
      if (!shouldRetryResponse(response) || attempt === FETCH_ATTEMPTS) return response

      await response.arrayBuffer().catch(() => {})
      await delay(readRetryDelay(response) ?? RETRY_BASE_DELAY_MS * attempt)
    } catch (error) {
      lastError = error
      if (attempt === FETCH_ATTEMPTS) break
      await delay(RETRY_BASE_DELAY_MS * attempt)
    }
  }

  throw new Error(`${message}: ${formatFetchError(lastError)}`)
}

function shouldRetryResponse(response) {
  return response.status === 429 || response.status >= 500
}

function readRetryDelay(response) {
  const retryAfter = response.headers.get('retry-after')
  if (!retryAfter) return null

  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const date = Date.parse(retryAfter)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())

  return null
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms)
  })
}

function formatFetchError(error) {
  if (!error) return 'unknown fetch error'
  const cause = error.cause?.code ? ` (${error.cause.code})` : ''
  return `${error.message || String(error)}${cause}`
}

async function formatGithubError(response, message) {
  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = response.headers.get('x-ratelimit-reset')
  const rateLimitHint = remaining === '0'
    ? ` GitHub API rate limit is exhausted${reset ? ` until ${new Date(Number(reset) * 1000).toISOString()}` : ''}; set OPERATOR_AVATAR_SOURCE_TOKEN or GITHUB_TOKEN.`
    : ''

  let body = ''
  try {
    body = await response.text()
  } catch {
  }

  return `${message}: ${response.status} ${response.statusText}.${rateLimitHint}${body ? ` Response: ${body.slice(0, 500)}` : ''}`
}

function relativeToRoot(filePath) {
  return filePath.startsWith(root) ? filePath.slice(root.length + 1).replace(/\\/g, '/') : basename(filePath)
}
