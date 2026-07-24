const MARKER_START = '<!-- pr-changelog:start -->'
const MARKER_END = '<!-- pr-changelog:end -->'
const DATA_MARKER_PREFIX = '<!-- pr-changelog:data:'
const DATA_MARKER_PATTERN = /<!-- pr-changelog:data:([A-Za-z0-9_-]+) -->/
const SHA_PATTERN = /^[0-9a-f]{40}$/i
const CHINESE_PATTERN = /[\u3400-\u9fff]/

const PUBLIC_SECTION_LABELS = {
  feature: '功能更新',
  fix: '问题修复',
  performance: '性能优化',
  security: '安全更新',
}
const INTERNAL_SECTION_LABELS = {
  admin: '管理后台',
  operations: '运维与 CI',
  maintenance: '内部维护与重构',
}
const SECTION_LABELS = { ...PUBLIC_SECTION_LABELS, ...INTERNAL_SECTION_LABELS }
const PUBLIC_SECTION_KINDS = Object.keys(PUBLIC_SECTION_LABELS)
const INTERNAL_SECTION_KINDS = Object.keys(INTERNAL_SECTION_LABELS)

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

export function normalizeManualSummary(value) {
  const summary = String(value ?? '').trim()
  return summary ? validateManualSummary(summary) : null
}

function normalizeDeepSeekResult(value) {
  if (!isRecord(value)) throw new Error('DeepSeek 未返回 JSON 对象')

  const summary = normalizeChineseText(value.summary, 'DeepSeek 总结', 2000)
  const publicSections = normalizeSections(value.public_sections, PUBLIC_SECTION_KINDS, 'public_sections')
  const internalSections = normalizeSections(value.internal_sections, INTERNAL_SECTION_KINDS, 'internal_sections')
  const itemCount = countSectionItems(publicSections) + countSectionItems(internalSections)
  if (itemCount === 0) throw new Error('DeepSeek 必须返回至少一个 changelog 分类条目')
  return { summary, publicSections, internalSections }
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
    schema_version: 2,
    pull_request: pullRequest,
    head_sha: normalizedHeadSha,
    manual_summary: normalizeManualSummary(manualSummary),
    deepseek_summary: normalizedResult.summary,
    public_sections: normalizedResult.publicSections,
    internal_sections: normalizedResult.internalSections,
    generated_at: timestamp.toISOString(),
    model: normalizedModel,
  }
}

export function renderPrChangelogBlock(payload) {
  const validated = validatePayload(payload)
  const encoded = Buffer.from(JSON.stringify(validated), 'utf8').toString('base64url')
  const publicSectionLines = renderSectionLines(validated.public_sections, '本次 PR 没有普通用户可直接感知的变化。')
  const internalSectionLines = renderSectionLines(validated.internal_sections, '本次 PR 没有仅限仓库记录的内部变化。')
  const manualSummaryLines = validated.manual_summary
    ? ['### 人工说明', '', validated.manual_summary, '']
    : []

  return [
    MARKER_START,
    '',
    '## Changelog 变更说明',
    '',
    '> 此区域由 `Record PR Changelog` 工作流生成；PR 更新后需重新运行。',
    '',
    ...manualSummaryLines,
    '### DeepSeek 分析',
    '',
    validated.deepseek_summary,
    '',
    '### 网站公开变更',
    '',
    ...publicSectionLines,
    '### 仓库内部变更',
    '',
    ...internalSectionLines,
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

export function collectPrChangelogChanges(payload) {
  const validated = validatePayload(payload)
  const publicChanges = flattenSections(validated.public_sections, validated.head_sha)
  const internalChanges = flattenSections(validated.internal_sections, validated.head_sha)
  return {
    publicChanges,
    repositoryChanges: [...publicChanges, ...internalChanges],
  }
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
  const normalizedManualSummary = normalizeManualSummary(manualSummary)
  return [
    {
      role: 'system',
      content: [
        '你是软件发布说明编辑。请根据 PR 标题、正文和 diff，生成分为网站公开内容与仓库内部内容的简体中文变更总结；维护者人工说明如有提供，可作为补充上下文。',
        '只输出 JSON 对象，不要输出 Markdown 代码块。JSON 格式：',
        '{"summary":"一段中文总体总结","public_sections":[{"kind":"feature|fix|performance|security","items":["中文条目"]}],"internal_sections":[{"kind":"admin|operations|maintenance","items":["中文条目"]}]}',
        'public_sections 只记录普通用户在网站、公开 API 或核心业务功能中能直接感受到的变化；管理后台、开发工具、测试、文档、重构、依赖、构建、部署和 CI 不得放入 public_sections。',
        'internal_sections 记录不应在网站展示但需要在仓库追溯的变化：管理后台用 admin，部署/运维/CI/构建用 operations，重构/测试/文档/依赖/开发维护用 maintenance。',
        'public_sections 可以为空；public_sections 与 internal_sections 合计至少包含一个条目。',
        '不得虚构 diff 中不存在的行为。人工说明如有提供，用于表达维护者意图，diff 用于核验和补充。条目应简洁、明确、使用中文。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `PR 标题：${String(title ?? '').trim()}`,
        `PR 正文：${String(body ?? '').trim().slice(0, 5000) || '(空)'}`,
        normalizedManualSummary
          ? `维护者人工说明：${normalizedManualSummary}`
          : '维护者人工说明：未提供，请仅根据 PR 标题、正文和 diff 总结。',
        '',
        'PR 修改：',
        String(diffContext ?? ''),
      ].join('\n'),
    },
  ]
}

function validatePayload(value) {
  if (!isRecord(value) || (value.schema_version !== 1 && value.schema_version !== 2)) {
    throw new Error('PR changelog 数据版本无效')
  }
  const publicSections = value.schema_version === 1 ? value.sections : value.public_sections
  const internalSections = value.schema_version === 1 ? [] : value.internal_sections
  return createPrChangelogPayload({
    pullRequestNumber: value.pull_request,
    headSha: value.head_sha,
    manualSummary: value.manual_summary,
    deepseekResult: {
      summary: value.deepseek_summary,
      public_sections: publicSections,
      internal_sections: internalSections,
    },
    generatedAt: value.generated_at,
    model: value.model,
  })
}

function normalizeSections(value, allowedKinds, fieldName) {
  if (!Array.isArray(value)) throw new Error(`DeepSeek ${fieldName} 必须是数组`)

  const grouped = new Map(allowedKinds.map((kind) => [kind, []]))
  for (const section of value) {
    if (!isRecord(section) || !allowedKinds.includes(section.kind) || !Array.isArray(section.items)) {
      throw new Error('DeepSeek 返回了无效的 changelog 分类')
    }
    for (const item of section.items) {
      const normalized = normalizeChineseText(item, 'DeepSeek changelog 条目', 500)
      const items = grouped.get(section.kind)
      if (!items.includes(normalized)) items.push(normalized)
    }
  }

  return allowedKinds.flatMap((kind) => {
    const items = grouped.get(kind)
    return items.length ? [{ kind, items }] : []
  })
}

function renderSectionLines(sections, emptyMessage) {
  if (sections.length === 0) return [`- ${emptyMessage}`, '']
  return sections.flatMap((section) => [
    `#### ${SECTION_LABELS[section.kind]}`,
    '',
    ...section.items.map((item) => `- ${item}`),
    '',
  ])
}

function flattenSections(sections, sha) {
  return sections.flatMap((section) => section.items.map((summary) => ({
    kind: section.kind,
    summary,
    sha,
  })))
}

function countSectionItems(sections) {
  return sections.reduce((total, section) => total + section.items.length, 0)
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
