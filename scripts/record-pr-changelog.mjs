import { appendFile } from 'node:fs/promises'
import {
  buildDeepSeekMessages,
  buildPullRequestDiffContext,
  createPrChangelogPayload,
  normalizeDeepSeekResult,
  renderPrChangelogBlock,
  validateManualSummary,
} from './pr-changelog-lib.mjs'

const repository = requireEnvironment('GITHUB_REPOSITORY')
const githubToken = requireEnvironment('GITHUB_TOKEN')
const deepseekApiKey = requireEnvironment('DEEPSEEK_API_KEY')
const pullRequestNumber = parsePullRequestNumber(requireEnvironment('PR_NUMBER'))
const manualSummary = validateManualSummary(requireEnvironment('MANUAL_CHANGELOG_SUMMARY'))
const githubApiUrl = String(process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '')
const deepseekApiUrl = String(process.env.DEEPSEEK_API_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')
const deepseekModel = String(process.env.DEEPSEEK_MODEL ?? 'deepseek-chat').trim()
const changelogBotLogin = String(process.env.CHANGELOG_BOT_LOGIN ?? 'github-actions[bot]').trim()
const [owner, repo] = repository.split('/')

if (!owner || !repo) throw new Error('GITHUB_REPOSITORY 必须使用 owner/repo 格式')
if (!deepseekModel) throw new Error('DEEPSEEK_MODEL 不能为空')
if (!changelogBotLogin) throw new Error('CHANGELOG_BOT_LOGIN 不能为空')

let statusSha = null

try {
  const pullRequest = await githubRequest(`/repos/${owner}/${repo}/pulls/${pullRequestNumber}`)
  if (pullRequest.state !== 'open') throw new Error(`PR #${pullRequestNumber} 不是打开状态`)
  if (pullRequest.base?.ref !== 'main') throw new Error(`PR #${pullRequestNumber} 的目标分支不是 main`)
  if (!pullRequest.head?.sha) throw new Error(`PR #${pullRequestNumber} 缺少 head SHA`)
  statusSha = pullRequest.head.sha

  await writeCommitStatus('pending', '正在由 DeepSeek 分析 PR 变更')

  const files = await listPullRequestFiles()
  const diffContext = buildPullRequestDiffContext(files)
  const messages = buildDeepSeekMessages({
    title: pullRequest.title,
    body: removeGeneratedChangelogBlock(pullRequest.body),
    manualSummary,
    diffContext,
  })
  const deepseekResult = await requestDeepSeek(messages)
  const payload = createPrChangelogPayload({
    pullRequestNumber,
    headSha: statusSha,
    manualSummary,
    deepseekResult,
    generatedAt: new Date().toISOString(),
    model: deepseekModel,
  })
  const block = renderPrChangelogBlock(payload)
  await writeChangelogComment(block)
  await writeCommitStatus('success', '中文变更说明与 DeepSeek 总结已记录')
  await writeStepSummary(payload, files.length)
  console.log(`Recorded Chinese changelog summary for PR #${pullRequestNumber}.`)
} catch (error) {
  if (statusSha) {
    try {
      await writeCommitStatus('failure', 'changelog 生成失败，请查看工作流日志')
    } catch (statusError) {
      console.error(`Failed to update commit status: ${statusError.message}`)
    }
  }
  console.error(`[record-pr-changelog] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}

async function listPullRequestFiles() {
  const files = []
  for (let page = 1; page <= 100; page += 1) {
    const batch = await githubRequest(`/repos/${owner}/${repo}/pulls/${pullRequestNumber}/files?per_page=100&page=${page}`)
    if (!Array.isArray(batch)) throw new Error('GitHub PR files API 返回了无效数据')
    files.push(...batch)
    if (batch.length < 100) break
  }
  return files
}

async function writeChangelogComment(body) {
  const comments = []
  for (let page = 1; page <= 100; page += 1) {
    const batch = await githubRequest(`/repos/${owner}/${repo}/issues/${pullRequestNumber}/comments?per_page=100&page=${page}`)
    if (!Array.isArray(batch)) throw new Error('GitHub PR comments API 返回了无效数据')
    comments.push(...batch)
    if (batch.length < 100) break
  }

  const existing = comments.find((comment) =>
    comment.user?.login === changelogBotLogin &&
    String(comment.body ?? '').includes('<!-- pr-changelog:start -->'))
  if (existing) {
    await githubRequest(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      body: { body },
    })
    return
  }

  await githubRequest(`/repos/${owner}/${repo}/issues/${pullRequestNumber}/comments`, {
    method: 'POST',
    body: { body },
  })
}

async function requestDeepSeek(messages) {
  const response = await fetch(`${deepseekApiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deepseekApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: deepseekModel,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  })
  const responseBody = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`DeepSeek API 请求失败：HTTP ${response.status} ${response.statusText}`)
  }

  const content = responseBody?.choices?.[0]?.message?.content
  if (!content) throw new Error('DeepSeek API 未返回总结内容')

  let parsed
  try {
    parsed = JSON.parse(String(content).replace(/^```(?:json)?\s*|\s*```$/gi, '').trim())
  } catch {
    throw new Error('DeepSeek 返回内容不是有效 JSON')
  }
  return normalizeDeepSeekResult(parsed)
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
  const responseBody = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`GitHub API 请求失败：HTTP ${response.status} ${response.statusText}`)
  return responseBody
}

async function writeCommitStatus(state, description) {
  await githubRequest(`/repos/${owner}/${repo}/statuses/${statusSha}`, {
    method: 'POST',
    body: {
      state,
      context: 'changelog/deepseek-summary',
      description,
      target_url: `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    },
  })
}

async function writeStepSummary(payload, fileCount) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  await appendFile(summaryPath, [
    `## PR #${payload.pull_request} Changelog 已记录`,
    '',
    `- 分析文件：${fileCount}`,
    `- DeepSeek 模型：${payload.model}`,
    `- 网站公开条目：${countItems(payload.public_sections)}`,
    `- 仓库内部条目：${countItems(payload.internal_sections)}`,
    `- Head SHA：\`${payload.head_sha}\``,
    '',
  ].join('\n'), 'utf8')
}

function removeGeneratedChangelogBlock(body) {
  return String(body ?? '').replace(/<!-- pr-changelog:start -->[\s\S]*?<!-- pr-changelog:end -->/g, '').trim()
}

function requireEnvironment(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`缺少必需环境变量 ${name}`)
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
