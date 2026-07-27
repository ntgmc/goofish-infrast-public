import { appendFile } from 'node:fs/promises'
import OpenAI from 'openai'
import {
  buildChangeExtractionMessages,
  buildCommitAnalysisChunks,
  buildReductionFacts,
  buildReductionMessages,
  comparePublicSourceLocks,
  createDirectModelResult,
  normalizeChangeExtraction,
  normalizeReductionResult,
  validatePublicComparisonStatus,
} from './pr-changelog-analysis-lib.mjs'
import {
  createPrChangelogPayload,
  normalizeManualSummary,
  renderPrChangelogBlock,
} from './pr-changelog-lib.mjs'

const repository = requireEnvironment('GITHUB_REPOSITORY')
const githubToken = requireEnvironment('GITHUB_TOKEN')
const openaiApiKey = requireEnvironment('OPENAI_API_KEY')
const pullRequestNumber = parsePullRequestNumber(requireEnvironment('PR_NUMBER'))
const manualSummary = normalizeManualSummary(process.env.MANUAL_CHANGELOG_SUMMARY)
const githubApiUrl = String(process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '')
const openaiBaseUrl = String(process.env.OPENAI_BASE_URL ?? 'https://api.krill-ai.net/codex/v1').replace(/\/$/, '')
const openaiModel = String(process.env.OPENAI_MODEL ?? 'gpt-5.6-luna').trim()
const changelogBotLogin = String(process.env.CHANGELOG_BOT_LOGIN ?? 'github-actions[bot]').trim()
const publicLockPath = String(process.env.CHANGELOG_PUBLIC_LOCK_PATH ?? 'public-source.lock.json').trim()
const chunkMaxChars = parseIntegerEnvironment('CHANGELOG_CHUNK_MAX_CHARS', 24000, 4000, 100000)
const analysisConcurrency = parseIntegerEnvironment('CHANGELOG_ANALYSIS_CONCURRENCY', 3, 1, 8)
const githubReadConcurrency = parseIntegerEnvironment('CHANGELOG_GITHUB_READ_CONCURRENCY', 5, 1, 10)
const [owner, repo] = repository.split('/')
const openai = new OpenAI({ apiKey: openaiApiKey, baseURL: openaiBaseUrl })

if (!owner || !repo) throw new Error('GITHUB_REPOSITORY 必须使用 owner/repo 格式')
if (!openaiModel) throw new Error('OPENAI_MODEL 不能为空')
if (!changelogBotLogin) throw new Error('CHANGELOG_BOT_LOGIN 不能为空')
if (!publicLockPath) throw new Error('CHANGELOG_PUBLIC_LOCK_PATH 不能为空')

let statusSha = null

try {
  const pullRequest = await githubRequest(`/repos/${repository}/pulls/${pullRequestNumber}`)
  if (pullRequest.state !== 'open') throw new Error(`PR #${pullRequestNumber} 不是打开状态`)
  if (pullRequest.base?.ref !== 'main') throw new Error(`PR #${pullRequestNumber} 的目标分支不是 main`)
  if (!pullRequest.base?.sha || !pullRequest.head?.sha) throw new Error(`PR #${pullRequestNumber} 缺少 base/head SHA`)
  statusSha = pullRequest.head.sha

  await writeCommitStatus('pending', '正在分块分析 PR 与关联公共源码变更')

  const pullRequestFiles = await listPullRequestFiles()
  const privateCommitRefs = await listPullRequestCommits()
  let privateUnits = await loadCommitUnits(repository, privateCommitRefs, 'private')
  const publicRange = await resolvePublicSourceRange(pullRequest, pullRequestFiles)
  let publicUnits = []
  if (publicRange) {
    const publicCommitRefs = await listComparedCommits(publicRange)
    publicUnits = await loadCommitUnits(publicRange.repository, publicCommitRefs, 'public')
    privateUnits = privateUnits
      .map((unit) => ({ ...unit, files: unit.files.filter((file) => file.filename !== publicLockPath) }))
      .filter((unit) => unit.files.length > 0)
  }

  let units = [...privateUnits, ...publicUnits]
  if (units.length === 0) {
    units = [{
      source: 'private',
      repository,
      sha: statusSha,
      subject: pullRequest.title,
      files: publicRange ? pullRequestFiles.filter((file) => file.filename !== publicLockPath) : pullRequestFiles,
    }].filter((unit) => unit.files.length > 0)
  }
  if (units.length === 0) throw new Error('没有可供 changelog 分析的实际文件变更')

  const chunks = buildCommitAnalysisChunks(units, chunkMaxChars)
  if (chunks.length === 0) throw new Error('PR 变更无法生成 changelog 分析分块')
  const compression = calculateCompression(chunks)
  console.log([
    `[record-pr-changelog] commits private=${privateUnits.length} public=${publicUnits.length} chunks=${chunks.length}`,
    `diff_chars=${compression.originalChars}->${compression.compactedChars}`,
    `estimated_diff_tokens=${compression.originalTokens}->${compression.compactedTokens}`,
    `saved=${compression.savedPercent}%`,
  ].join(' '))

  const pullRequestBody = removeGeneratedChangelogBlock(pullRequest.body)
  const extractions = await mapWithConcurrency(chunks, analysisConcurrency, async (chunk) => {
    const messages = buildChangeExtractionMessages({
      pullRequestTitle: pullRequest.title,
      pullRequestBody: chunks.length === 1 ? pullRequestBody : undefined,
      manualSummary: chunks.length === 1 ? manualSummary : undefined,
      chunk,
    })
    return requestValidatedJson(messages, `extract ${chunk.id}`, (value) => normalizeChangeExtraction(value, chunk))
  })
  const facts = buildReductionFacts(extractions)
  if (facts.length === 0) throw new Error('分块分析未提取到任何 changelog 事实')

  let modelResult
  if (extractions.length === 1) {
    modelResult = createDirectModelResult(extractions[0])
    console.log('[record-pr-changelog] single chunk: skipped reduce request to save tokens')
  } else if (facts.length === 1) {
    modelResult = createDirectModelResult({ summary: facts[0].summary, changes: facts })
    console.log('[record-pr-changelog] one deduplicated fact: skipped reduce request to save tokens')
  } else {
    const messages = buildReductionMessages({
      title: pullRequest.title,
      body: pullRequestBody,
      manualSummary,
      facts,
    })
    modelResult = await requestValidatedJson(messages, 'reduce', (value) => normalizeReductionResult(value, facts))
  }

  const payload = createPrChangelogPayload({
    pullRequestNumber,
    headSha: statusSha,
    manualSummary,
    modelResult,
    generatedAt: new Date().toISOString(),
    model: openaiModel,
  })
  const block = renderPrChangelogBlock(payload)
  await writeChangelogComment(block)
  await writeCommitStatus('success', 'OpenAI 分块 changelog 总结已记录')
  await writeStepSummary(payload, {
    fileCount: pullRequestFiles.length,
    privateCommitCount: privateUnits.length,
    publicCommitCount: publicUnits.length,
    chunkCount: chunks.length,
    compression,
    publicRange,
  })
  console.log(`Recorded Chinese changelog summary for PR #${pullRequestNumber}.`)
} catch (error) {
  if (statusSha) {
    try {
      await writeCommitStatus('failure', 'changelog 生成失败，请查看工作流日志')
    } catch (statusError) {
      console.error(`Failed to update commit status: ${statusError.message}`)
    }
  }
  console.error(`[record-pr-changelog] ${formatError(error)}`)
  process.exitCode = 1
}

async function listPullRequestFiles() {
  return readPaginatedArray(
    (page) => `/repos/${repository}/pulls/${pullRequestNumber}/files?per_page=100&page=${page}`,
    'GitHub PR files API',
  )
}

async function listPullRequestCommits() {
  return readPaginatedArray(
    (page) => `/repos/${repository}/pulls/${pullRequestNumber}/commits?per_page=100&page=${page}`,
    'GitHub PR commits API',
  )
}

async function loadCommitUnits(targetRepository, commitRefs, source) {
  const uniqueShas = [...new Set(commitRefs.map((commit) => String(commit?.sha ?? '').trim().toLowerCase()).filter(Boolean))]
  return mapWithConcurrency(uniqueShas, githubReadConcurrency, async (sha) => {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${source} commit SHA 无效：${sha}`)
    const commit = await readCommit(targetRepository, sha)
    return {
      source,
      repository: targetRepository,
      sha,
      subject: String(commit.commit?.message ?? '').split(/\r?\n/, 1)[0],
      files: commit.files,
    }
  })
}

async function readCommit(targetRepository, sha) {
  let metadata = null
  const files = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await githubRequest(`/repos/${targetRepository}/commits/${sha}?per_page=100&page=${page}`)
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error(`GitHub commit API 返回了无效数据：${targetRepository}@${sha}`)
    metadata ??= response
    const batch = Array.isArray(response.files) ? response.files : []
    files.push(...batch)
    if (batch.length < 100) break
  }
  return { ...metadata, files }
}

async function resolvePublicSourceRange(pullRequest, files) {
  if (!files.some((file) => file?.filename === publicLockPath)) return null
  const baseLock = await readRepositoryJsonFile(repository, publicLockPath, pullRequest.base.sha)
  const headLock = await readRepositoryJsonFile(repository, publicLockPath, pullRequest.head.sha)
  return comparePublicSourceLocks(baseLock, headLock)
}

async function readRepositoryJsonFile(targetRepository, path, ref) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  const response = await githubRequest(`/repos/${targetRepository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`)
  if (!response || typeof response.content !== 'string' || response.encoding !== 'base64') {
    throw new Error(`GitHub Contents API 未返回 ${path} 的 base64 内容`)
  }
  try {
    return JSON.parse(Buffer.from(response.content.replace(/\s/g, ''), 'base64').toString('utf8'))
  } catch {
    throw new Error(`${path} 不是有效 JSON`)
  }
}

async function listComparedCommits(range) {
  const commits = []
  let comparisonStatus = null
  for (let page = 1; page <= 100; page += 1) {
    const response = await githubRequest(
      `/repos/${range.repository}/compare/${encodeURIComponent(range.base)}...${encodeURIComponent(range.head)}?per_page=100&page=${page}`,
    )
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('GitHub compare API 返回了无效数据')
    comparisonStatus ??= response.status
    const batch = Array.isArray(response.commits) ? response.commits : []
    commits.push(...batch)
    if (batch.length < 100) break
  }
  if (!validatePublicComparisonStatus(comparisonStatus)) return []
  console.log(`[record-pr-changelog] expanded public range ${range.repository}@${range.base.slice(0, 7)}..${range.head.slice(0, 7)} (${commits.length} commits)`)
  return commits
}

async function readPaginatedArray(pathForPage, label) {
  const items = []
  for (let page = 1; page <= 100; page += 1) {
    const batch = await githubRequest(pathForPage(page))
    if (!Array.isArray(batch)) throw new Error(`${label} 返回了无效数据`)
    items.push(...batch)
    if (batch.length < 100) break
  }
  return items
}

async function writeChangelogComment(body) {
  const comments = await readPaginatedArray(
    (page) => `/repos/${repository}/issues/${pullRequestNumber}/comments?per_page=100&page=${page}`,
    'GitHub PR comments API',
  )
  const existing = comments.find((comment) =>
    comment.user?.login === changelogBotLogin &&
    String(comment.body ?? '').includes('<!-- pr-changelog:start -->'))
  if (existing) {
    await githubRequest(`/repos/${repository}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      body: { body },
    })
    return
  }
  await githubRequest(`/repos/${repository}/issues/${pullRequestNumber}/comments`, {
    method: 'POST',
    body: { body },
  })
}

async function requestValidatedJson(messages, label, validate) {
  let correction = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const requestMessages = correction
      ? [...messages, { role: 'user', content: `上一响应未通过结构校验：${correction}。请重新输出完整 JSON。` }]
      : messages
    const value = await requestOpenAIJson(requestMessages, `${label} attempt=${attempt}`)
    try {
      return validate(value)
    } catch (error) {
      correction = formatError(error).slice(0, 1000)
      if (attempt === 2) throw new Error(`${label} 连续两次未通过结构校验：${correction}`, { cause: error })
      console.warn(`[record-pr-changelog] ${label} validation failed; retrying once: ${correction}`)
    }
  }
  throw new Error(`${label} validation unexpectedly exhausted`)
}

async function requestOpenAIJson(messages, label) {
  const inputChars = messages.reduce((total, message) => total + String(message.content ?? '').length, 0)
  console.log(`[record-pr-changelog] OpenAI ${label}: model=${openaiModel} input_chars=${inputChars} estimated_tokens=${Math.ceil(inputChars / 4)}`)
  let completion
  try {
    completion = await openai.chat.completions.create({ model: openaiModel, messages })
  } catch (error) {
    const status = error instanceof OpenAI.APIError ? `HTTP ${error.status}` : '未知状态'
    throw new Error(`OpenAI API 请求失败：${status}`, { cause: error })
  }
  if (completion.usage) {
    console.log(`[record-pr-changelog] OpenAI ${label} usage: prompt=${completion.usage.prompt_tokens ?? 'unknown'} completion=${completion.usage.completion_tokens ?? 'unknown'}`)
  }
  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('OpenAI API 未返回总结内容')
  const normalizedContent = String(content).replace(/^```(?:json)?\s*|\s*```$/gi, '').trim()
  try {
    return JSON.parse(normalizedContent)
  } catch {
    console.error(`[record-pr-changelog] OpenAI ${label} returned invalid JSON (${normalizedContent.length} chars)`)
    throw new Error('OpenAI 返回内容不是有效 JSON')
  }
}

async function githubRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${githubApiUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubToken}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const responseText = await response.text()
  let responseBody
  try {
    responseBody = JSON.parse(responseText)
  } catch {
    responseBody = null
  }
  if (!response.ok) {
    throw new Error(
      `GitHub API 请求失败：${method} ${path} -> HTTP ${response.status} ${response.statusText}${formatGitHubErrorDetails(responseBody)}`,
    )
  }
  return responseBody
}

function formatGitHubErrorDetails(responseBody) {
  if (!responseBody || typeof responseBody !== 'object' || Array.isArray(responseBody)) return ''
  const details = ['message', 'documentation_url', 'status']
    .flatMap((field) => {
      const value = responseBody[field]
      return typeof value === 'string' || typeof value === 'number'
        ? [`${field}=${String(value).trim().slice(0, 2000)}`]
        : []
    })
  return details.length > 0 ? `；${details.join('；')}` : ''
}

async function writeCommitStatus(state, description) {
  await githubRequest(`/repos/${repository}/statuses/${statusSha}`, {
    method: 'POST',
    body: {
      state,
      context: 'changelog/openai-summary',
      description,
      target_url: `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    },
  })
}

async function writeStepSummary(payload, analysis) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  const publicRangeLines = analysis.publicRange
    ? [`- Public 范围：\`${analysis.publicRange.repository}@${analysis.publicRange.base.slice(0, 7)}..${analysis.publicRange.head.slice(0, 7)}\``]
    : []
  await appendFile(summaryPath, [
    `## PR #${payload.pull_request} Changelog 已记录`,
    '',
    `- PR 文件：${analysis.fileCount}`,
    `- Private commits：${analysis.privateCommitCount}`,
    `- Public commits：${analysis.publicCommitCount}`,
    `- 分析分块：${analysis.chunkCount}`,
    `- Diff 压缩：${analysis.compression.originalChars} → ${analysis.compression.compactedChars} 字符（节省 ${analysis.compression.savedPercent}%）`,
    `- 估算 Diff token：${analysis.compression.originalTokens} → ${analysis.compression.compactedTokens}`,
    ...publicRangeLines,
    `- OpenAI 模型：${payload.model}`,
    `- 网站公开条目：${countItems(payload.public_sections)}`,
    `- 仓库内部条目：${countItems(payload.internal_sections)}`,
    `- Head SHA：\`${payload.head_sha}\``,
    '',
  ].join('\n'), 'utf8')
}

function calculateCompression(chunks) {
  const units = new Map()
  for (const chunk of chunks) {
    const unitId = chunk.id.replace(/C\d+$/, '')
    if (!units.has(unitId)) units.set(unitId, { originalChars: chunk.originalChars, compactedChars: chunk.compactedChars })
  }
  const originalChars = [...units.values()].reduce((total, unit) => total + unit.originalChars, 0)
  const compactedChars = [...units.values()].reduce((total, unit) => total + unit.compactedChars, 0)
  return {
    originalChars,
    compactedChars,
    originalTokens: Math.ceil(originalChars / 4),
    compactedTokens: Math.ceil(compactedChars / 4),
    savedPercent: originalChars > 0 ? Math.max(0, Math.round((1 - compactedChars / originalChars) * 100)) : 0,
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function removeGeneratedChangelogBlock(body) {
  return String(body ?? '').replace(/<!-- pr-changelog:start -->[\s\S]*?<!-- pr-changelog:end -->/g, '').trim()
}

function requireEnvironment(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`缺少必需环境变量 ${name}`)
  return value
}

function parseIntegerEnvironment(name, fallback, minimum, maximum) {
  const source = String(process.env[name] ?? '').trim()
  if (!source) return fallback
  const value = Number(source)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`)
  }
  return value
}

function parsePullRequestNumber(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error('PR_NUMBER 必须是正整数')
  return number
}

function countItems(sections) {
  return sections.reduce((total, section) => total + section.items.length, 0)
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}
