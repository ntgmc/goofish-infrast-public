export const BEHAVIOR_RISK_MODEL_VERSION = 'behavior-risk-v1.1.0'

export type BehaviorRiskEventType =
  | 'register'
  | 'activation'
  | 'login'
  | 'bind'
  | 'job_submit'
  | 'generate'
  | 'export'
  | 'workspace_save'
  | 'page_view'
  | 'operator_data_anomaly'
  | 'account_deleted'

export type BehaviorRiskPageCategory =
  | 'landing'
  | 'auth'
  | 'profiles'
  | 'workspace'
  | 'optimizer'
  | 'result'
  | 'account'
  | 'public_info'
  | 'other'

export type BehaviorRiskEvent = {
  id: string
  event_type: BehaviorRiskEventType
  user_id: string | null
  profile_id: string | null
  job_id: string | null
  browser_hmac: string | null
  session_hmac: string | null
  network_hmac: string | null
  ua_hmac: string | null
  uid_hmac: string | null
  output_hash: string | null
  page_category: BehaviorRiskPageCategory | null
  structure_summary?: Record<string, unknown> | null
  occurred_at: string
  expires_at: string
}

export type BehaviorRiskRule = {
  code: string
  category: string
  score: number
  explanation: string
  evidence: Record<string, unknown>
}

export type BehaviorRiskEvaluation = {
  userIds: string[]
  score: number
  categories: string[]
  rules: BehaviorRiskRule[]
  createCase: boolean
  strongSignal: boolean
  firstSeenAt: string
  lastSeenAt: string
  expiresAt: string
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const RAPID_PATH_MS = 30 * 60 * 1000

export function evaluateBehaviorRiskEvents(
  input: BehaviorRiskEvent[],
  now = new Date(),
): BehaviorRiskEvaluation[] {
  const events = input
    .filter((event): event is BehaviorRiskEvent & { user_id: string } => Boolean(event.user_id) && Number.isFinite(Date.parse(event.occurred_at)))
    .sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at))
  if (events.length === 0) return []

  const components = buildAssociatedAccountGroups(events, now)
  return components.map((userIds) => evaluateGroup(events.filter((event) => userIds.includes(event.user_id)), userIds, now))
}

function buildAssociatedAccountGroups(
  events: Array<BehaviorRiskEvent & { user_id: string }>,
  now: Date,
): string[][] {
  const recent = events.filter((event) => now.getTime() - Date.parse(event.occurred_at) <= 7 * DAY_MS)
  const userIds = [...new Set(events.map((event) => event.user_id))]
  const parent = new Map(userIds.map((userId) => [userId, userId]))
  const find = (userId: string): string => {
    const current = parent.get(userId) ?? userId
    if (current === userId) return userId
    const root = find(current)
    parent.set(userId, root)
    return root
  }
  const union = (left: string, right: string): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
  }

  const byEnvironment = new Map<string, Set<string>>()
  for (const event of recent) {
    const keys = [
      event.browser_hmac ? `browser:${event.browser_hmac}` : null,
      event.network_hmac && event.ua_hmac ? `network-ua:${event.network_hmac}:${event.ua_hmac}` : null,
    ].filter((value): value is string => Boolean(value))
    for (const key of keys) {
      const members = byEnvironment.get(key) ?? new Set<string>()
      members.add(event.user_id)
      byEnvironment.set(key, members)
    }
  }
  for (const members of byEnvironment.values()) {
    const [first, ...rest] = [...members]
    if (first) for (const member of rest) union(first, member)
  }

  const grouped = new Map<string, string[]>()
  for (const userId of userIds) {
    const root = find(userId)
    grouped.set(root, [...(grouped.get(root) ?? []), userId])
  }
  return [...grouped.values()].map((members) => members.sort())
}

function evaluateGroup(
  events: Array<BehaviorRiskEvent & { user_id: string }>,
  userIds: string[],
  now: Date,
): BehaviorRiskEvaluation {
  const rules: BehaviorRiskRule[] = []
  const recent24h = within(events, now, DAY_MS)
  const recent7d = within(events, now, 7 * DAY_MS)
  const accountEvents = new Map(userIds.map((userId) => [userId, events.filter((event) => event.user_id === userId)]))

  const burst = findEnvironmentAccountBurst(recent24h)
  if (burst) rules.push(rule('environment_account_burst', 'environment', 35, '同一浏览器环境或网络与浏览器组合在 24 小时内关联多个账号。', burst))

  const rapidPaths = [...accountEvents.entries()]
    .map(([userId, userEvents]) => findRapidPath(userId, userEvents))
    .filter((value): value is RapidPath => Boolean(value))
  if (rapidPaths.length > 0) {
    rules.push(rule('rapid_service_path', 'service_path', 30, '新账号在 30 分钟内完成绑定、生成和完整导出，期间缺少正常调整行为。', {
      account_count: rapidPaths.length,
      shortest_minutes: Math.min(...rapidPaths.map((path) => Math.round(path.durationMs / 60_000))),
    }))
  }

  const environmentUids = new Set(recent7d.map((event) => event.uid_hmac).filter(Boolean))
  const hasSharedEnvironment = userIds.length >= 2 && hasEnvironmentAssociation(recent7d)
  if (hasSharedEnvironment && environmentUids.size >= 2) {
    rules.push(rule('environment_multi_uid', 'identity', 35, '同一关联环境在 7 天内绑定多个档案标识。', {
      account_count: userIds.length,
      uid_count: environmentUids.size,
      uid_prefixes: prefixes(environmentUids),
    }))
  }

  const multiUidAccounts = [...accountEvents.entries()]
    .map(([userId, userEvents]) => ({ userId, uids: new Set(within(userEvents, now, 7 * DAY_MS).map((event) => event.uid_hmac).filter(Boolean)) }))
    .filter((entry) => entry.uids.size >= 2)
  if (multiUidAccounts.length > 0) {
    rules.push(rule('account_multi_uid', 'identity', 30, '单个账号在 7 天内绑定多个档案标识。', {
      account_count: multiUidAccounts.length,
      max_uid_count: Math.max(...multiUidAccounts.map((entry) => entry.uids.size)),
    }))
  }

  const exportVelocity = [...accountEvents.entries()]
    .map(([userId, userEvents]) => ({ userId, evidence: findExportVelocity(userEvents) }))
    .filter((entry): entry is { userId: string; evidence: Record<string, unknown> } => Boolean(entry.evidence))
  if (exportVelocity.length > 0) {
    rules.push(rule('export_velocity', 'export', 20, '账号在短时间内连续导出多份不同完整结果。', {
      account_count: exportVelocity.length,
      samples: exportVelocity.slice(0, 5).map((entry) => entry.evidence),
    }))
  }

  const cadence = findCohortCadence(rapidPaths)
  if (cadence) rules.push(rule('cohort_cadence', 'cadence', 30, '关联账号具有高度一致的页面路径和绑定、生成、导出节奏。', cadence))

  const operatorAnomalies = recent24h.filter((event) => event.event_type === 'operator_data_anomaly')
  if (operatorAnomalies.length > 0) {
    const fingerprints = operatorFingerprintHashes(operatorAnomalies)
    rules.push(rule('operator_data_anomaly', 'operator_data', 20, '账号提交的干员快照与已确认基线存在回退或异常差异。', {
      event_count: operatorAnomalies.length,
      account_count: new Set(operatorAnomalies.map((event) => event.user_id)).size,
      anomaly_types: [...new Set(operatorAnomalies.map((event) => event.structure_summary?.anomaly_type).filter((value): value is string => typeof value === 'string'))],
      fingerprint_prefixes: [...fingerprints].slice(0, 10).map((value) => value.slice(0, 12)),
    }))
  }

  const dormant = rapidPaths.filter((path) => isDormantAfterExport(accountEvents.get(path.userId) ?? [], path, now))
  if (dormant.length > 0) {
    rules.push(rule('post_export_dormancy', 'dormancy', 15, '快速导出后 14 天内未再出现登录、页面或工作区活动。', {
      account_count: dormant.length,
    }))
  }

  const strongBrowser = findStrongBrowserSignal(recent7d)
  const strongAccount = multiUidAccounts.some(({ userId }) => hasShortOutputBurst(accountEvents.get(userId) ?? []))
  const strongCadence = Boolean(cadence && rapidPaths.length >= 2 && hasSharedEnvironment)
  const strongOperator = operatorAnomalies.length >= 3 && operatorFingerprintHashes(operatorAnomalies).size >= 2
  const strongSignal = Boolean(strongBrowser || strongAccount || strongCadence || strongOperator)
  if (strongSignal) {
    rules.push(rule('strong_composite', 'strong_composite', 50, strongBrowser
      ? '同一浏览器实例关联多个账号和多个档案标识。'
      : strongAccount
        ? '单个账号短期处理多个档案并导出多份不同结果。'
        : strongCadence
          ? '同一关联环境中的多个账号完成高度一致的快速路径。'
          : '关联账号组在 24 小时内提交至少三次、涉及多个不同指纹的异常干员快照。', {
      kind: strongBrowser
        ? 'browser_accounts_uids'
        : strongAccount
          ? 'account_uids_outputs'
          : strongCadence
            ? 'environment_rapid_cadence'
            : 'operator_anomaly_fingerprints',
    }))
  }

  const score = Math.min(100, rules.reduce((sum, item) => sum + item.score, 0))
  const categories = [...new Set(rules.map((item) => item.category))]
  const firstSeenAt = events[0]?.occurred_at ?? now.toISOString()
  const lastSeenAt = events.at(-1)?.occurred_at ?? now.toISOString()
  const expiresAt = events.map((event) => event.expires_at).sort().at(-1) ?? now.toISOString()
  return {
    userIds,
    score,
    categories,
    rules,
    createCase: score >= 50 && (categories.length >= 2 || strongSignal),
    strongSignal,
    firstSeenAt,
    lastSeenAt,
    expiresAt,
  }
}

type RapidPath = {
  userId: string
  registeredAt: number
  boundAt: number
  generatedAt: number
  exportedAt: number
  durationMs: number
  signature: string
}

function findRapidPath(userId: string, events: BehaviorRiskEvent[]): RapidPath | null {
  const registrations = events.filter((event) => event.event_type === 'register' || event.event_type === 'activation')
  for (const registration of registrations) {
    const registeredAt = Date.parse(registration.occurred_at)
    const windowEvents = events.filter((event) => {
      const time = Date.parse(event.occurred_at)
      return time >= registeredAt && time <= registeredAt + RAPID_PATH_MS
    })
    const boundAt = firstTime(windowEvents, 'bind', registeredAt)
    const generatedAt = firstTime(windowEvents, 'generate', boundAt)
    const exportedAt = firstTime(windowEvents, 'export', generatedAt)
    if (boundAt === null || generatedAt === null || exportedAt === null) continue
    const adjusted = windowEvents.some((event) => event.event_type === 'workspace_save' && Date.parse(event.occurred_at) < exportedAt)
    const categories = new Set(windowEvents.filter((event) => event.event_type === 'page_view').map((event) => event.page_category).filter(Boolean))
    const explored = [...categories].filter((category) => category !== 'auth' && category !== 'profiles' && category !== 'result').length >= 2
    if (adjusted || explored) continue
    const pathEvents = windowEvents.filter((event) => event.event_type === 'page_view' || ['bind', 'generate', 'export'].includes(event.event_type))
    const signature = pathEvents.map((event) => {
      const step = event.event_type === 'page_view' ? `page:${event.page_category ?? 'other'}` : event.event_type
      return `${step}:${Math.floor((Date.parse(event.occurred_at) - registeredAt) / (5 * 60_000))}`
    }).join('>')
    return { userId, registeredAt, boundAt, generatedAt, exportedAt, durationMs: exportedAt - registeredAt, signature }
  }
  return null
}

function findEnvironmentAccountBurst(events: BehaviorRiskEvent[]): Record<string, unknown> | null {
  const candidates = new Map<string, BehaviorRiskEvent[]>()
  for (const event of events.filter((item) => item.event_type === 'register' || item.event_type === 'activation')) {
    const keys = [
      event.browser_hmac ? `browser:${event.browser_hmac}` : null,
      event.network_hmac && event.ua_hmac ? `network-ua:${event.network_hmac}:${event.ua_hmac}` : null,
    ].filter((value): value is string => Boolean(value))
    for (const key of keys) candidates.set(key, [...(candidates.get(key) ?? []), event])
  }
  for (const [key, matching] of candidates) {
    const accounts = new Set(matching.map((event) => event.user_id).filter(Boolean))
    if (accounts.size >= 2) return { environment_type: key.split(':', 1)[0], account_count: accounts.size, signal_prefix: key.split(':').at(-1)?.slice(0, 12) }
  }
  return null
}

function findExportVelocity(events: BehaviorRiskEvent[]): Record<string, unknown> | null {
  const exports = events.filter((event) => event.event_type === 'export' && event.output_hash)
  if (hasDistinctInWindow(exports, 2, HOUR_MS)) return { window: '1h', distinct_output_count: maxDistinctInWindow(exports, HOUR_MS) }
  if (hasDistinctInWindow(exports, 5, DAY_MS)) return { window: '24h', distinct_output_count: maxDistinctInWindow(exports, DAY_MS) }
  return null
}

function findCohortCadence(paths: RapidPath[]): Record<string, unknown> | null {
  const signatures = new Map<string, RapidPath[]>()
  for (const path of paths) signatures.set(path.signature, [...(signatures.get(path.signature) ?? []), path])
  for (const [signature, matching] of signatures) {
    if (matching.length >= 2) return { account_count: matching.length, timing_signature: signature }
  }
  return null
}

function findStrongBrowserSignal(events: BehaviorRiskEvent[]): boolean {
  const browsers = new Map<string, BehaviorRiskEvent[]>()
  for (const event of events) {
    if (event.browser_hmac) browsers.set(event.browser_hmac, [...(browsers.get(event.browser_hmac) ?? []), event])
  }
  return [...browsers.values()].some((matching) => (
    new Set(matching.map((event) => event.user_id).filter(Boolean)).size >= 2
    && new Set(matching.map((event) => event.uid_hmac).filter(Boolean)).size >= 2
  ))
}

function hasEnvironmentAssociation(events: BehaviorRiskEvent[]): boolean {
  const signals = new Map<string, Set<string>>()
  for (const event of events) {
    const keys = [event.browser_hmac, event.network_hmac && event.ua_hmac ? `${event.network_hmac}:${event.ua_hmac}` : null].filter(Boolean) as string[]
    for (const key of keys) signals.set(key, new Set([...(signals.get(key) ?? []), ...(event.user_id ? [event.user_id] : [])]))
  }
  return [...signals.values()].some((members) => members.size >= 2)
}

function hasShortOutputBurst(events: BehaviorRiskEvent[]): boolean {
  const recentUidCount = new Set(events.filter((event) => event.event_type === 'bind').map((event) => event.uid_hmac).filter(Boolean)).size
  const exports = events.filter((event) => event.event_type === 'export' && event.output_hash)
  return recentUidCount >= 2 && hasDistinctInWindow(exports, 2, HOUR_MS)
}

function operatorFingerprintHashes(events: BehaviorRiskEvent[]): Set<string> {
  return new Set(events.flatMap((event) => {
    const value = event.structure_summary?.operator_fingerprint_hash
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? [value] : []
  }))
}

function isDormantAfterExport(events: BehaviorRiskEvent[], path: RapidPath, now: Date): boolean {
  if (now.getTime() - path.exportedAt < 14 * DAY_MS) return false
  return !events.some((event) => (
    Date.parse(event.occurred_at) > path.exportedAt
    && (event.event_type === 'login' || event.event_type === 'page_view' || event.event_type === 'workspace_save')
  ))
}

function hasDistinctInWindow(events: BehaviorRiskEvent[], threshold: number, windowMs: number): boolean {
  return maxDistinctInWindow(events, windowMs) >= threshold
}

function maxDistinctInWindow(events: BehaviorRiskEvent[], windowMs: number): number {
  let maximum = 0
  for (let start = 0; start < events.length; start += 1) {
    const startTime = Date.parse(events[start].occurred_at)
    const hashes = new Set<string>()
    for (let end = start; end < events.length && Date.parse(events[end].occurred_at) - startTime <= windowMs; end += 1) {
      if (events[end].output_hash) hashes.add(events[end].output_hash!)
    }
    maximum = Math.max(maximum, hashes.size)
  }
  return maximum
}

function firstTime(events: BehaviorRiskEvent[], eventType: BehaviorRiskEventType, after: number | null): number | null {
  if (after === null) return null
  const match = events.find((event) => event.event_type === eventType && Date.parse(event.occurred_at) >= after)
  return match ? Date.parse(match.occurred_at) : null
}

function within<T extends BehaviorRiskEvent>(events: T[], now: Date, windowMs: number): T[] {
  const cutoff = now.getTime() - windowMs
  return events.filter((event) => Date.parse(event.occurred_at) >= cutoff)
}

function prefixes(values: Set<string | null>): string[] {
  return [...values].filter((value): value is string => Boolean(value)).slice(0, 10).map((value) => value.slice(0, 12))
}

function rule(
  code: string,
  category: string,
  score: number,
  explanation: string,
  evidence: Record<string, unknown>,
): BehaviorRiskRule {
  return { code, category, score, explanation, evidence }
}
