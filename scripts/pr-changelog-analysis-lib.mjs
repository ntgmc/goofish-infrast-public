const CHINESE_PATTERN = /[\u3400-\u9fff]/
const PUBLIC_KINDS = new Set(['feature', 'fix', 'performance', 'security'])
const INTERNAL_KINDS = new Set(['admin', 'operations', 'maintenance'])
const LOW_SIGNAL_PATH_PATTERN = /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|[^/]+\.generated\/|\.generated\/)/i

export function compactPatch(patch) {
  const source = String(patch ?? '').replaceAll('\r\n', '\n').trimEnd()
  if (!source) return '[patch unavailable or binary file]'

  const output = []
  let omittedContextLines = 0
  const flushOmitted = () => {
    if (omittedContextLines > 0) output.push(`[${omittedContextLines} unchanged context lines omitted]`)
    omittedContextLines = 0
  }

  for (const line of source.split('\n')) {
    if (line.startsWith('@@') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\ No newline')) {
      flushOmitted()
      output.push(line.trimEnd())
    } else {
      omittedContextLines += 1
    }
  }
  flushOmitted()
  return output.join('\n') || '[patch contains context only]'
}

export function buildCommitAnalysisChunks(units, maxChars = 24000) {
  if (!Array.isArray(units)) throw new Error('commit analysis units must be an array')
  const normalizedMaxChars = Number(maxChars)
  if (!Number.isInteger(normalizedMaxChars) || normalizedMaxChars < 4000 || normalizedMaxChars > 100000) {
    throw new Error('changelog chunk size must be an integer between 4000 and 100000 characters')
  }

  return units.flatMap((unit, unitIndex) => buildUnitChunks(unit, unitIndex, normalizedMaxChars))
}

export function buildChangeExtractionMessages({ pullRequestTitle, pullRequestBody, manualSummary, chunk }) {
  if (!chunk || !Array.isArray(chunk.fileIds) || !chunk.context) throw new Error('invalid changelog analysis chunk')
  return [
    {
      role: 'system',
      content: [
        '你是软件变更事实抽取器。以输入 commit 和压缩 diff 为事实依据，逐个文件识别最终行为变化；PR 正文或维护者说明仅用于理解意图；输出简体中文 JSON，不要 Markdown。',
        '输出格式：{"summary":"本分块总结","files":[{"id":"F1","change_ids":["C1"]},{"id":"F2","reason":"无发布语义的原因"}],"changes":[{"id":"C1","audience":"public|internal","kind":"feature|fix|performance|security|admin|operations|maintenance","summary":"中文变更事实"}]}。',
        'files 必须且只能覆盖输入中的全部文件 ID，每个文件必须使用 change_ids 或 reason 二选一。每个 changes 项必须被至少一个文件引用。',
        'public 只面向普通用户，kind 只能为 feature、fix、performance、security。管理员、运维、CI、构建、测试、依赖、重构属于 internal，kind 使用 admin、operations、maintenance。',
        '不得把 public-source.lock 指针本身当作用户功能；真实 public commit 会另行提供。不得虚构；同一事实跨文件时只建一个 change。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `PR 标题：${String(pullRequestTitle ?? '').trim()}`,
        pullRequestBody === undefined ? null : `PR 正文：${String(pullRequestBody ?? '').trim().slice(0, 3000) || '(空)'}`,
        manualSummary === undefined ? null : `维护者说明：${String(manualSummary ?? '').trim() || '(未提供)'}`,
        '',
        chunk.context,
      ].filter((line) => line !== null).join('\n'),
    },
  ]
}

export function normalizeChangeExtraction(value, chunk) {
  if (!isRecord(value)) throw new Error('OpenAI 分块分析未返回 JSON 对象')
  const expectedFileIds = new Set(chunk.fileIds)
  const summary = normalizeChineseText(value.summary, '分块总结', 1200)
  if (!Array.isArray(value.files)) throw new Error('OpenAI 分块分析 files 必须是数组')
  if (!Array.isArray(value.changes)) throw new Error('OpenAI 分块分析 changes 必须是数组')

  const changesById = new Map()
  for (const change of value.changes) {
    if (!isRecord(change)) throw new Error('OpenAI 分块分析包含无效 change')
    const id = String(change.id ?? '').trim()
    if (!id || changesById.has(id)) throw new Error('OpenAI 分块分析 change ID 缺失或重复')
    const audience = change.audience === 'public' ? 'public' : change.audience === 'internal' ? 'internal' : null
    if (!audience) throw new Error(`OpenAI 分块分析 change ${id} audience 无效`)
    const kind = String(change.kind ?? '').trim()
    const allowedKinds = audience === 'public' ? PUBLIC_KINDS : INTERNAL_KINDS
    if (!allowedKinds.has(kind)) throw new Error(`OpenAI 分块分析 change ${id} kind 与 audience 不匹配`)
    changesById.set(id, {
      id: `${chunk.id}:${id}`,
      audience,
      kind,
      summary: normalizeChineseText(change.summary, `change ${id} 总结`, 500),
      source: chunk.source,
      repository: chunk.repository,
      sha: chunk.sha,
    })
  }

  const seenFiles = new Set()
  const referencedChanges = new Set()
  for (const decision of value.files) {
    if (!isRecord(decision)) throw new Error('OpenAI 分块分析包含无效 file decision')
    const id = String(decision.id ?? '').trim()
    if (!expectedFileIds.has(id) || seenFiles.has(id)) throw new Error(`OpenAI 分块分析 file ID ${id || '(empty)'} 未知或重复`)
    seenFiles.add(id)
    const changeIds = Array.isArray(decision.change_ids)
      ? decision.change_ids.map((changeId) => String(changeId ?? '').trim()).filter(Boolean)
      : []
    const reason = String(decision.reason ?? '').trim()
    if ((changeIds.length > 0) === Boolean(reason)) throw new Error(`OpenAI 分块分析 file ${id} 必须使用 change_ids 或 reason 二选一`)
    for (const changeId of changeIds) {
      if (!changesById.has(changeId)) throw new Error(`OpenAI 分块分析 file ${id} 引用了未知 change ${changeId}`)
      referencedChanges.add(changeId)
    }
  }
  if (seenFiles.size !== expectedFileIds.size) {
    const missing = [...expectedFileIds].filter((id) => !seenFiles.has(id))
    throw new Error(`OpenAI 分块分析遗漏文件：${missing.join(', ')}`)
  }
  const unreferenced = [...changesById.keys()].filter((id) => !referencedChanges.has(id))
  if (unreferenced.length > 0) throw new Error(`OpenAI 分块分析包含未关联文件的 changes：${unreferenced.join(', ')}`)

  return { summary, changes: [...changesById.values()] }
}

export function buildReductionFacts(extractions) {
  if (!Array.isArray(extractions)) throw new Error('changelog extractions must be an array')
  const deduplicated = new Map()
  for (const extraction of extractions) {
    for (const change of extraction.changes ?? []) {
      const key = `${change.audience}\u001f${change.kind}\u001f${change.summary}`
      const existing = deduplicated.get(key)
      if (existing) {
        existing.sourceChangeIds.push(change.id)
      } else {
        deduplicated.set(key, { ...change, sourceChangeIds: [change.id] })
      }
    }
  }
  return [...deduplicated.values()].map((change, index) => ({
    ...change,
    id: `S${index + 1}`,
  }))
}

export function buildReductionMessages({ title, body, manualSummary, facts }) {
  if (!Array.isArray(facts) || facts.length < 1) throw new Error('at least one changelog fact is required')
  const factLines = facts.map((fact) => `${fact.id}|${fact.audience}|${fact.kind}|${fact.summary}`)
  return [
    {
      role: 'system',
      content: [
        '你是软件发布说明编辑。合并和去重结构化变更事实，输出简体中文 JSON，不要 Markdown，不得遗漏任何事实 ID。',
        '输出格式：{"summary":"总体总结","public_sections":[{"kind":"feature|fix|performance|security","items":[{"text":"中文条目","source_ids":["S1"]}]}],"internal_sections":[{"kind":"admin|operations|maintenance","items":[{"text":"中文条目","source_ids":["S2"]}]}],"discarded_sources":[{"id":"S3","reason":"仅可用于完全重复或无发布语义事实"}]}。',
        '每个输入事实 ID 必须且只能出现在一个最终 item 的 source_ids 或一个 discarded_sources 项中。可以合并多个事实，但不得凭空新增事实。',
        '普通用户不包括管理员、运维和开发者；无法确认时归入 internal。人工说明只用于表达意图，不能覆盖事实。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `PR 标题：${String(title ?? '').trim()}`,
        `PR 正文：${String(body ?? '').trim().slice(0, 3000) || '(空)'}`,
        `维护者说明：${String(manualSummary ?? '').trim() || '(未提供)'}`,
        '',
        '变更事实：',
        ...factLines,
      ].join('\n'),
    },
  ]
}

export function normalizeReductionResult(value, facts) {
  if (!isRecord(value)) throw new Error('OpenAI 汇总未返回 JSON 对象')
  const summary = normalizeChineseText(value.summary, '总体总结', 2000)
  const factsById = new Map(facts.map((fact) => [fact.id, fact]))
  const consumed = new Set()
  const publicSections = normalizeReductionSections(value.public_sections, PUBLIC_KINDS, factsById, consumed, 'public')
  const internalSections = normalizeReductionSections(value.internal_sections, INTERNAL_KINDS, factsById, consumed, 'internal')
  if (!Array.isArray(value.discarded_sources)) throw new Error('OpenAI 汇总 discarded_sources 必须是数组')
  for (const discarded of value.discarded_sources) {
    if (!isRecord(discarded)) throw new Error('OpenAI 汇总包含无效 discarded source')
    const id = String(discarded.id ?? '').trim()
    if (!factsById.has(id) || consumed.has(id)) throw new Error(`OpenAI 汇总 discarded source ${id || '(empty)'} 未知或重复`)
    if (!String(discarded.reason ?? '').trim()) throw new Error(`OpenAI 汇总 discarded source ${id} 缺少原因`)
    consumed.add(id)
  }
  if (consumed.size !== factsById.size) {
    const missing = [...factsById.keys()].filter((id) => !consumed.has(id))
    throw new Error(`OpenAI 汇总遗漏事实：${missing.join(', ')}`)
  }
  if (countSectionItems(publicSections) + countSectionItems(internalSections) === 0) {
    throw new Error('OpenAI 汇总必须保留至少一个 changelog 条目')
  }
  return { summary, public_sections: publicSections, internal_sections: internalSections }
}

export function createDirectModelResult(extraction) {
  if (!extraction || !Array.isArray(extraction.changes) || extraction.changes.length === 0) {
    throw new Error('分块分析没有可记录的 changelog 事实')
  }
  const publicSections = groupChanges(extraction.changes.filter((change) => change.audience === 'public'), PUBLIC_KINDS)
  const internalSections = groupChanges(extraction.changes.filter((change) => change.audience === 'internal'), INTERNAL_KINDS)
  return {
    summary: extraction.summary,
    public_sections: publicSections,
    internal_sections: internalSections,
  }
}

export function parsePublicSourceLock(value) {
  if (!isRecord(value) || value.schema_version !== 1) throw new Error('public source lock schema 无效')
  const repository = parseGitHubRepository(value.public_repository)
  const commit = String(value.public_commit ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('public source lock commit 必须是完整 SHA')
  const optimizerPortVersion = Number(value.optimizer_port_version)
  if (!Number.isInteger(optimizerPortVersion) || optimizerPortVersion < 1) throw new Error('optimizer port version 无效')
  return { repository, commit, optimizerPortVersion }
}

export function comparePublicSourceLocks(baseValue, headValue) {
  const base = parsePublicSourceLock(baseValue)
  const head = parsePublicSourceLock(headValue)
  if (base.repository !== head.repository) throw new Error('PR 不得在更新 public lock 时切换公共仓库')
  if (base.commit === head.commit) return null
  return {
    repository: head.repository,
    base: base.commit,
    head: head.commit,
    optimizerPortChanged: base.optimizerPortVersion !== head.optimizerPortVersion,
  }
}

export function validatePublicComparisonStatus(status) {
  if (status === 'identical') return false
  if (status !== 'ahead') throw new Error(`public source lock 必须快进更新，GitHub compare status=${status ?? 'unknown'}`)
  return true
}

export function parseGitHubRepository(value) {
  const source = String(value ?? '').trim()
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)?([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(source)
  if (!match) throw new Error('public repository 必须是 GitHub owner/repository 或 GitHub URL')
  return `${match[1]}/${match[2]}`
}

function buildUnitChunks(unit, unitIndex, maxChars) {
  if (!isRecord(unit) || !Array.isArray(unit.files)) throw new Error('invalid commit analysis unit')
  const source = String(unit.source ?? '').trim() || 'private'
  const repository = String(unit.repository ?? '').trim()
  const sha = String(unit.sha ?? '').trim().toLowerCase()
  const subject = String(unit.subject ?? '').trim().slice(0, 1000)
  if (!repository || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('commit analysis unit repository or SHA is invalid')
  const header = [
    `source=${source}`,
    `repository=${repository}`,
    `commit=${sha}`,
    `subject=${subject || '(empty)'}`,
  ].join('\n')
  const segmentLimit = Math.max(1000, maxChars - header.length - 300)
  let nextFileNumber = 1
  let originalChars = 0
  let compactedChars = 0
  const segments = []

  for (const file of unit.files) {
    const filename = String(file?.filename ?? '').trim() || '(unknown file)'
    const patch = String(file?.patch ?? '')
    originalChars += patch.length
    const compacted = LOW_SIGNAL_PATH_PATTERN.test(filename)
      ? '[generated or lockfile patch omitted; use companion source manifests and file statistics]'
      : compactPatch(patch)
    compactedChars += compacted.length
    const metadata = `path=${filename}\nstatus=${String(file?.status ?? 'unknown')} additions=${Number(file?.additions ?? 0)} deletions=${Number(file?.deletions ?? 0)}`
    const parts = splitText(`${metadata}\n${compacted}`, segmentLimit)
    const baseId = `F${nextFileNumber}`
    nextFileNumber += 1
    parts.forEach((part, partIndex) => {
      const id = parts.length === 1 ? baseId : `${baseId}.${partIndex + 1}`
      segments.push({ id, text: `[${id}]\n${part}` })
    })
  }
  if (segments.length === 0) return []

  const chunks = []
  let current = []
  let currentLength = header.length
  const flush = () => {
    if (current.length === 0) return
    const chunkNumber = chunks.length + 1
    chunks.push({
      id: `U${unitIndex + 1}C${chunkNumber}`,
      source,
      repository,
      sha,
      subject,
      fileIds: current.map((segment) => segment.id),
      context: `${header}\n\n${current.map((segment) => segment.text).join('\n\n')}`,
      originalChars,
      compactedChars,
    })
    current = []
    currentLength = header.length
  }
  for (const segment of segments) {
    const additionalLength = segment.text.length + 2
    if (current.length > 0 && currentLength + additionalLength > maxChars) flush()
    current.push(segment)
    currentLength += additionalLength
  }
  flush()
  return chunks
}

function splitText(value, maxChars) {
  if (value.length <= maxChars) return [value]
  const parts = []
  let current = ''
  for (const line of value.split('\n')) {
    if (line.length > maxChars) {
      if (current) parts.push(current)
      for (let offset = 0; offset < line.length; offset += maxChars) parts.push(line.slice(offset, offset + maxChars))
      current = ''
      continue
    }
    const candidate = current ? `${current}\n${line}` : line
    if (candidate.length > maxChars) {
      parts.push(current)
      current = line
    } else {
      current = candidate
    }
  }
  if (current) parts.push(current)
  return parts
}

function normalizeReductionSections(value, allowedKinds, factsById, consumed, audience) {
  if (!Array.isArray(value)) throw new Error(`OpenAI 汇总 ${audience} sections 必须是数组`)
  const grouped = new Map([...allowedKinds].map((kind) => [kind, []]))
  for (const section of value) {
    if (!isRecord(section) || !allowedKinds.has(section.kind) || !Array.isArray(section.items)) {
      throw new Error(`OpenAI 汇总包含无效 ${audience} section`)
    }
    for (const item of section.items) {
      if (!isRecord(item) || !Array.isArray(item.source_ids) || item.source_ids.length === 0) {
        throw new Error('OpenAI 汇总 item 必须包含 source_ids')
      }
      const text = normalizeChineseText(item.text, '汇总条目', 500)
      for (const rawId of item.source_ids) {
        const id = String(rawId ?? '').trim()
        if (!factsById.has(id) || consumed.has(id)) throw new Error(`OpenAI 汇总 source ${id || '(empty)'} 未知或重复`)
        consumed.add(id)
      }
      const items = grouped.get(section.kind)
      if (!items.includes(text)) items.push(text)
    }
  }
  return [...allowedKinds].flatMap((kind) => grouped.get(kind).length ? [{ kind, items: grouped.get(kind) }] : [])
}

function groupChanges(changes, allowedKinds) {
  const grouped = new Map([...allowedKinds].map((kind) => [kind, []]))
  for (const change of changes) {
    const items = grouped.get(change.kind)
    if (items && !items.includes(change.summary)) items.push(change.summary)
  }
  return [...allowedKinds].flatMap((kind) => grouped.get(kind).length ? [{ kind, items: grouped.get(kind) }] : [])
}

function normalizeChineseText(value, fieldName, maxLength) {
  const text = String(value ?? '').trim()
  if (!text || text.length > maxLength || !CHINESE_PATTERN.test(text)) throw new Error(`${fieldName} 必须是有效中文且不超过 ${maxLength} 字符`)
  return text
}

function countSectionItems(sections) {
  return sections.reduce((total, section) => total + section.items.length, 0)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
