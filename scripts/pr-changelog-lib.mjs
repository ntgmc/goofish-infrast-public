const MARKER_START = '<!-- pr-changelog:start -->'
const MARKER_END = '<!-- pr-changelog:end -->'
const DATA_MARKER_PREFIX = '<!-- pr-changelog:data:'
const DATA_MARKER_PATTERN = /<!-- pr-changelog:data:([A-Za-z0-9_-]+) -->/
const SHA_PATTERN = /^[0-9a-f]{40}$/i
const CHINESE_PATTERN = /[\u3400-\u9fff]/

const SECTION_LABELS = {
  feature: '功能更新',
  fix: '问题修复',
  performance: '性能优化',
  security: '安全更新',
}

const SECTION_KINDS = Object.keys(SECTION_LABELS)

export function validateManualSummary(value) {
  const summary = String(value ?? '').trim()
  if (summary.length < 5 || summary.length > 2000) {
    throw new Error('中文变更说明长度必须在 5 到 2000 个字符之间')
  }
  if (!CHINESE_PATTERN.test(summary)) throw new Error('变更说明必须包含中文内容')
  if (summary.includes(MARKER_START) || summary.includes(MARKER_END) || summary.includes(DATA_MARKER_PREFIX)) {
    throw new Error('变更说明不能包含 changelog 保留标记')
  }
  return summary
}

export function normalizeDeepSeekResult(value) {
  if (!isRecord(value)) throw new Error('DeepSeek 未返回 JSON 对象')

  const summary = normalizeChineseText(value.summary, 'DeepSeek 总结', 2000)
  const sections = normalizeSections(value.sections)
  if (sections.length === 0) throw new Error('DeepSeek 必须返回至少一个 changelog 分类条目')
  return { summary, sections }
}

export function createPrChangelogPayload({ pullRequestNumber, headSha, manualSummary, deepseekResult, generatedAt, model }) {
  const pullRequest = Number(pullRequestNumber)
  if (!Number.isInteger(pullRequest) || pullRequest < 1) throw new Error('PR 编号必须是正整数')

  const normalizedHeadSha = String(headSha ?? '').trim().toLowerCase()
  if (!SHA_PATTERN.test(normalizedHeadSha)) throw new Error('PR head SHA 必须是完整的 40 位提交 SHA')

  const normalizedResult = normalizeDeepSeekResult(deepseekResult)
  const timestamp = new Date(String(generatedAt ?? ''))
  if (Number.isNaN(timestamp.getTime())) throw new Error('changelog 生成时间无效')

  const normalizedModel = String(model ?? '').trim()
  if (!normalizedModel) throw new Error('DeepSeek 模型名称不能为空')

  return {
    schema_version: 1,
    pull_request: pullRequest,
    head_sha: normalizedHeadSha,
    manual_summary: validateManualSummary(manualSummary),
    deepseek_summary: normalizedResult.summary,
    sections: normalizedResult.sections,
    generated_at: timestamp.toISOString(),
    model: normalizedModel,
  }
}

export function renderPrChangelogBlock(payload) {
  const validated = validatePayload(payload)
  const encoded = Buffer.from(JSON.stringify(validated), 'utf8').toString('base64url')
  const sectionLines = validated.sections.flatMap((section) => [
    `#### ${SECTION_LABELS[section.kind]}`,
    '',
    ...section.items.map((item) => `- ${item}`),
    '',
  ])

  return [
    MARKER_START,
    '',
    '## Changelog 变更说明',
    '',
    '> 此区域由 `Record PR Changelog` 工作流生成；PR 更新后需重新运行。',
    '',
    '### 人工说明',
    '',
    validated.manual_summary,
    '',
    '### DeepSeek 分析',
    '',
    validated.deepseek_summary,
    '',
    ...sectionLines,
    `${DATA_MARKER_PREFIX}${encoded} -->`,
    '',
    MARKER_END,
  ].join('\n')
}

export function upsertPrChangelogBlock(body, block) {
  const currentBody = String(body ?? '')
  const startIndex = currentBody.indexOf(MARKER_START)
  const endIndex = currentBody.indexOf(MARKER_END)

  if (startIndex === -1 && endIndex === -1) {
    return currentBody.trim() ? `${currentBody.trimEnd()}\n\n${block}` : block
  }
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error('PR 正文中的 changelog 标记不完整，请先修复或删除损坏的标记区域')
  }

  return currentBody.slice(0, startIndex) + block + currentBody.slice(endIndex + MARKER_END.length)
}

export function parsePrChangelogPayload(body) {
  const source = String(body ?? '')
  const marker = DATA_MARKER_PATTERN.exec(source)
  if (!marker) return null

  let decoded
  try {
    decoded = JSON.parse(Buffer.from(marker[1], 'base64url').toString('utf8'))
  } catch {
    throw new Error('PR changelog 机器数据无法解码')
  }
  return validatePayload(decoded)
}

export function findTrustedPrChangelogPayload(comments, botLogin = 'github-actions[bot]') {
  if (!Array.isArray(comments)) throw new Error('PR 评论列表无效')
  const trustedLogin = String(botLogin ?? '').trim()
  if (!trustedLogin) throw new Error('changelog bot 登录名不能为空')

  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index]
    if (comment?.user?.login !== trustedLogin) continue
    if (!String(comment.body ?? '').includes(DATA_MARKER_PREFIX)) continue
    return parsePrChangelogPayload(comment.body)
  }
  return null
}

export function flattenPrChangelogChanges(payload) {
  const validated = validatePayload(payload)
  return validated.sections.flatMap((section) => section.items.map((summary) => ({
    kind: section.kind,
    summary,
    sha: validated.head_sha,
  })))
}

export function buildPullRequestDiffContext(files, maxLength = 60000) {
  if (!Array.isArray(files)) throw new Error('PR 文件列表无效')
  const chunks = []
  let length = 0

  for (const file of files) {
    const filename = String(file?.filename ?? '').trim() || '(unknown file)'
    const header = [
      `### ${filename}`,
      `status=${String(file?.status ?? 'unknown')} additions=${Number(file?.additions ?? 0)} deletions=${Number(file?.deletions ?? 0)}`,
    ].join('\n')
    const patch = String(file?.patch ?? '[binary or patch unavailable]').slice(0, 8000)
    const chunk = `${header}\n\n${patch}\n`
    const separatorLength = chunks.length ? 1 : 0
    const availableLength = maxLength - length - separatorLength
    if (availableLength <= 0) {
      chunks.push('\n[其余 diff 因上下文长度限制已省略]')
      break
    }
    if (chunk.length > availableLength) {
      chunks.push(chunk.slice(0, availableLength), '\n[其余 diff 因上下文长度限制已省略]')
      break
    }
    chunks.push(chunk)
    length += chunk.length + separatorLength
  }

  return chunks.join('\n') || '[PR 未返回可分析的文件差异]'
}

export function buildDeepSeekMessages({ title, body, manualSummary, diffContext }) {
  const normalizedManualSummary = validateManualSummary(manualSummary)
  return [
    {
      role: 'system',
      content: [
        '你是软件发布说明编辑。请根据维护者的人工说明和 PR diff，生成面向最终用户的简体中文变更总结。',
        '只输出 JSON 对象，不要输出 Markdown 代码块。JSON 格式：',
        '{"summary":"一段中文总体总结","sections":[{"kind":"feature|fix|performance|security","items":["中文条目"]}]}',
        'sections 只允许 feature、fix、performance、security，至少包含一个且总计不超过 12 个条目；忽略纯测试、格式化、重构和 CI 细节，除非它们直接影响用户。',
        '不得虚构 diff 中不存在的行为。人工说明用于表达维护者意图，diff 用于核验和补充。条目应简洁、明确、使用中文。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `PR 标题：${String(title ?? '').trim()}`,
        `PR 正文：${String(body ?? '').trim().slice(0, 5000) || '(空)'}`,
        `维护者人工说明：${normalizedManualSummary}`,
        '',
        'PR 修改：',
        String(diffContext ?? ''),
      ].join('\n'),
    },
  ]
}

function validatePayload(value) {
  if (!isRecord(value) || value.schema_version !== 1) throw new Error('PR changelog 数据版本无效')
  return createPrChangelogPayload({
    pullRequestNumber: value.pull_request,
    headSha: value.head_sha,
    manualSummary: value.manual_summary,
    deepseekResult: {
      summary: value.deepseek_summary,
      sections: value.sections,
    },
    generatedAt: value.generated_at,
    model: value.model,
  })
}

function normalizeSections(value) {
  if (!Array.isArray(value)) throw new Error('DeepSeek sections 必须是数组')

  const grouped = new Map(SECTION_KINDS.map((kind) => [kind, []]))
  for (const section of value) {
    if (!isRecord(section) || !SECTION_KINDS.includes(section.kind) || !Array.isArray(section.items)) {
      throw new Error('DeepSeek 返回了无效的 changelog 分类')
    }
    for (const item of section.items) {
      const normalized = normalizeChineseText(item, 'DeepSeek changelog 条目', 500)
      const items = grouped.get(section.kind)
      if (!items.includes(normalized)) items.push(normalized)
    }
  }

  const itemCount = [...grouped.values()].reduce((total, items) => total + items.length, 0)
  if (itemCount > 12) throw new Error('DeepSeek changelog 条目不能超过 12 条')

  return SECTION_KINDS.flatMap((kind) => {
    const items = grouped.get(kind)
    return items.length ? [{ kind, items }] : []
  })
}

function normalizeChineseText(value, label, maxLength) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!text || text.length > maxLength) throw new Error(`${label}为空或过长`)
  if (!CHINESE_PATTERN.test(text)) throw new Error(`${label}必须包含中文内容`)
  if (text.includes('<!--') || text.includes('-->')) throw new Error(`${label}不能包含 HTML 注释标记`)
  return text
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
