export const BEHAVIOR_RISK_MODEL_VERSION = 'behavior-risk-v1.3.0'
const MULTI_IDENTITY_THRESHOLD = 3

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
  | 'skland_uid_mismatch'
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
  signal_aliases?: Partial<Record<'browser' | 'session' | 'network' | 'ua' | 'uid', string[]>> | null
  output_hash: string | null
  page_category: BehaviorRiskPageCategory | null
  structure_summary?: Record<string, unknown> | null
  occurred_at: string
  expires_at: string
}

type BehaviorRiskRule = {
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

type IdentifiedEvent = BehaviorRiskEvent & { user_id: string }

type EnvironmentCohort = {
  key: string
  type: 'browser' | 'network-ua'
  signalPrefix: string
  events: IdentifiedEvent[]
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

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const ENVIRONMENT_BURST_MS = DAY_MS
const ENVIRONMENT_ASSOCIATION_MS = 7 * DAY_MS
const RAPID_PATH_MS = 30 * MINUTE_MS
const OPERATOR_ANOMALY_MS = DAY_MS
const POST_EXPORT_DORMANCY_MS = 14 * DAY_MS
const CASE_SCORE_THRESHOLD = 50

export function evaluateBehaviorRiskEvents(
  input: BehaviorRiskEvent[],
  now = new Date(),
): BehaviorRiskEvaluation[] {
  const events = input
    .filter((event): event is IdentifiedEvent => Boolean(event.user_id) && Number.isFinite(Date.parse(event.occurred_at)))
    .sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at))
  if (events.length === 0) return []

  const components = buildAssociatedAccountGroups(events, now)
  return components.map((userIds) => evaluateGroup(events.filter((event) => userIds.includes(event.user_id)), userIds, now))
}

function buildAssociatedAccountGroups(events: IdentifiedEvent[], now: Date): string[][] {
  const recent = within(events, now, ENVIRONMENT_ASSOCIATION_MS)
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

  for (const cohort of environmentCohorts(recent)) {
    const members = [...new Set(cohort.events.map((event) => event.user_id))]
    if (members.length < MULTI_IDENTITY_THRESHOLD) continue
    const [first, ...rest] = members
    for (const member of rest) union(first, member)
  }

  const grouped = new Map<string, string[]>()
  for (const userId of userIds) {
    const root = find(userId)
    grouped.set(root, [...(grouped.get(root) ?? []), userId])
  }
  return [...grouped.values()].map((members) => members.sort())
}

function evaluateGroup(events: IdentifiedEvent[], userIds: string[], now: Date): BehaviorRiskEvaluation {
  const rules: BehaviorRiskRule[] = []
  const recent24h = within(events, now, OPERATOR_ANOMALY_MS)
  const recent7d = within(events, now, ENVIRONMENT_ASSOCIATION_MS)
  const accountEvents = new Map(userIds.map((userId) => [userId, events.filter((event) => event.user_id === userId)]))

  const browserCluster = findBrowserIdentityCluster(recent7d)
  const environmentMultiUid = browserCluster ? null : findEnvironmentMultiUid(recent7d)
  const environmentBurst = browserCluster || environmentMultiUid
    ? null
    : findEnvironmentAccountBurst(within(events, now, ENVIRONMENT_BURST_MS))
  if (browserCluster) {
    rules.push(rule(
      'browser_identity_cluster',
      'environment',
      20,
      '同一经服务端签名的设备 cookie 在 7 天内关联至少三个账号和三个档案标识；该信号仅作为弱证据。',
      browserCluster,
    ))
  } else if (environmentMultiUid) {
    rules.push(rule(
      'environment_multi_uid',
      'environment',
      35,
      '同一关联环境在 7 天内绑定至少三个账号和三个档案标识。',
      environmentMultiUid,
    ))
  } else if (environmentBurst) {
    rules.push(rule(
      'environment_account_burst',
      'environment',
      25,
      '同一浏览器环境或网络与浏览器组合在 24 小时内关联至少三个新账号。',
      environmentBurst,
    ))
  }

  const rapidPaths = [...accountEvents.entries()]
    .map(([userId, userEvents]) => findRapidPath(userId, userEvents))
    .filter((value): value is RapidPath => Boolean(value))
  const cadence = findCohortCadence(rapidPaths, recent7d)
  if (cadence) {
    rules.push(rule(
      'cohort_cadence',
      'service_path',
      35,
      '同一关联环境中的至少三个账号具有高度一致的页面路径和操作节奏。',
      cadence,
    ))
  } else if (rapidPaths.length > 0) {
    rules.push(rule(
      'rapid_service_path',
      'service_path',
      20,
      '新账号在 30 分钟内完成绑定、生成和完整导出，期间缺少正常调整行为。',
      {
        account_count: rapidPaths.length,
        shortest_minutes: Math.min(...rapidPaths.map((path) => Math.round(path.durationMs / MINUTE_MS))),
      },
    ))
  }

  const multiUidAccounts = [...accountEvents.entries()]
    .map(([userId, userEvents]) => ({
      userId,
      uids: new Set(within(userEvents, now, ENVIRONMENT_ASSOCIATION_MS).map((event) => event.uid_hmac).filter(Boolean)),
    }))
    .filter((entry) => entry.uids.size >= MULTI_IDENTITY_THRESHOLD)
  if (multiUidAccounts.length > 0) {
    rules.push(rule('account_multi_uid', 'identity', 20, '单个账号在 7 天内绑定至少三个档案标识。', {
      account_count: multiUidAccounts.length,
      max_uid_count: Math.max(...multiUidAccounts.map((entry) => entry.uids.size)),
    }))
  }

  const operatorAnomalies = recent24h.filter((event) => event.event_type === 'operator_data_anomaly')
  const operatorFingerprints = operatorFingerprintHashes(operatorAnomalies)
  const repeatedOperatorAnomaly = operatorAnomalies.length >= 3 && operatorFingerprints.size >= 2
  if (repeatedOperatorAnomaly) {
    rules.push(rule(
      'operator_data_anomaly_repeated',
      'operator_data',
      55,
      '关联账号组在 24 小时内提交至少三次、涉及多个不同指纹的异常干员快照。',
      operatorAnomalyEvidence(operatorAnomalies, operatorFingerprints),
    ))
  } else if (operatorAnomalies.length > 0) {
    rules.push(rule(
      'operator_data_anomaly',
      'operator_data',
      20,
      '账号提交的干员快照与已确认基线存在回退或异常差异。',
      operatorAnomalyEvidence(operatorAnomalies, operatorFingerprints),
    ))
  }

  const dormant = rapidPaths.filter((path) => isDormantAfterExport(accountEvents.get(path.userId) ?? [], path, now))
  if (dormant.length > 0) {
    rules.push(rule('post_export_dormancy', 'dormancy', 10, '快速导出后 14 天内未再出现登录、页面或工作区活动。', {
      account_count: dormant.length,
    }))
  }

  const sklandUidMismatchEvents = events.filter((event) => event.event_type === 'skland_uid_mismatch')
  const mismatchEventsByProfile = new Map<string, IdentifiedEvent[]>()
  for (const event of sklandUidMismatchEvents) {
    if (!event.profile_id) continue
    mismatchEventsByProfile.set(event.profile_id, [...(mismatchEventsByProfile.get(event.profile_id) ?? []), event])
  }
  const repeatedMismatchProfile = [...mismatchEventsByProfile.values()].find((profileEvents) => profileEvents.length >= MULTI_IDENTITY_THRESHOLD) ?? null
  const repeatedSklandUidMismatch = Boolean(repeatedMismatchProfile)
  if (repeatedSklandUidMismatch) {
    rules.push(rule(
      'skland_uid_mismatch_repeated',
      'identity',
      55,
      '同一账号档案累计三次使用与当前绑定 UID 不一致的森空岛账号，档案已触发冻结保护。',
      {
        event_count: repeatedMismatchProfile.length,
        profile_count: 1,
      },
    ))
  }

  const strongSignal = repeatedOperatorAnomaly || repeatedSklandUidMismatch
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
    createCase: score >= CASE_SCORE_THRESHOLD && (strongSignal || categories.length >= 2),
    strongSignal,
    firstSeenAt,
    lastSeenAt,
    expiresAt,
  }
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
      return `${step}:${Math.floor((Date.parse(event.occurred_at) - registeredAt) / (5 * MINUTE_MS))}`
    }).join('>')
    return { userId, registeredAt, boundAt, generatedAt, exportedAt, durationMs: exportedAt - registeredAt, signature }
  }
  return null
}

function findBrowserIdentityCluster(events: IdentifiedEvent[]): Record<string, unknown> | null {
  for (const cohort of environmentCohorts(events).filter((candidate) => candidate.type === 'browser')) {
    const accounts = new Set(cohort.events.map((event) => event.user_id))
    const uids = new Set(cohort.events.map((event) => event.uid_hmac).filter(Boolean))
    if (accounts.size >= MULTI_IDENTITY_THRESHOLD && uids.size >= MULTI_IDENTITY_THRESHOLD) {
      return environmentEvidence(cohort, accounts, uids)
    }
  }
  return null
}

function findEnvironmentMultiUid(events: IdentifiedEvent[]): Record<string, unknown> | null {
  for (const cohort of environmentCohorts(events)) {
    const accounts = new Set(cohort.events.map((event) => event.user_id))
    const uids = new Set(cohort.events.map((event) => event.uid_hmac).filter(Boolean))
    if (accounts.size >= MULTI_IDENTITY_THRESHOLD && uids.size >= MULTI_IDENTITY_THRESHOLD) {
      return environmentEvidence(cohort, accounts, uids)
    }
  }
  return null
}

function findEnvironmentAccountBurst(events: IdentifiedEvent[]): Record<string, unknown> | null {
  const registrations = events.filter((event) => event.event_type === 'register' || event.event_type === 'activation')
  for (const cohort of environmentCohorts(registrations)) {
    const accounts = new Set(cohort.events.map((event) => event.user_id))
    if (accounts.size >= MULTI_IDENTITY_THRESHOLD) {
      return {
        environment_type: cohort.type,
        account_count: accounts.size,
        signal_prefix: cohort.signalPrefix,
      }
    }
  }
  return null
}

function findCohortCadence(paths: RapidPath[], events: IdentifiedEvent[]): Record<string, unknown> | null {
  const signatures = new Map<string, RapidPath[]>()
  for (const path of paths) signatures.set(path.signature, [...(signatures.get(path.signature) ?? []), path])
  const cohorts = environmentCohorts(events)
  for (const [signature, matching] of signatures) {
    const matchingUserIds = new Set(matching.map((path) => path.userId))
    if (matchingUserIds.size < MULTI_IDENTITY_THRESHOLD) continue
    for (const cohort of cohorts) {
      const associatedAccounts = new Set(cohort.events.map((event) => event.user_id).filter((userId) => matchingUserIds.has(userId)))
      if (associatedAccounts.size >= MULTI_IDENTITY_THRESHOLD) {
        return {
          environment_type: cohort.type,
          signal_prefix: cohort.signalPrefix,
          account_count: associatedAccounts.size,
          timing_signature: signature,
        }
      }
    }
  }
  return null
}

function environmentCohorts(events: IdentifiedEvent[]): EnvironmentCohort[] {
  const cohorts = new Map<string, EnvironmentCohort>()
  for (const event of events) {
    for (const signal of environmentSignals(event)) {
      const cohort = cohorts.get(signal.key) ?? { ...signal, events: [] }
      cohort.events.push(event)
      cohorts.set(signal.key, cohort)
    }
  }
  return [...cohorts.values()]
}

function environmentSignals(event: BehaviorRiskEvent): Array<Omit<EnvironmentCohort, 'events'>> {
  const signals: Array<Omit<EnvironmentCohort, 'events'>> = []
  for (const browserHmac of signalValues(event, 'browser', event.browser_hmac)) {
    signals.push({
      key: `browser:${browserHmac}`,
      type: 'browser',
      signalPrefix: browserHmac.slice(0, 12),
    })
  }
  for (const networkHmac of signalValues(event, 'network', event.network_hmac)) {
    for (const uaHmac of signalValues(event, 'ua', event.ua_hmac)) {
      signals.push({
        key: `network-ua:${networkHmac}:${uaHmac}`,
        type: 'network-ua',
        signalPrefix: `${networkHmac.slice(0, 6)}:${uaHmac.slice(0, 6)}`,
      })
    }
  }
  return [...new Map(signals.map((signal) => [signal.key, signal])).values()]
}

function signalValues(
  event: BehaviorRiskEvent,
  namespace: 'browser' | 'session' | 'network' | 'ua' | 'uid',
  primary: string | null,
): string[] {
  return [...new Set([primary, ...(event.signal_aliases?.[namespace] ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

function environmentEvidence(
  cohort: EnvironmentCohort,
  accounts: Set<string>,
  uids: Set<string | null>,
): Record<string, unknown> {
  return {
    environment_type: cohort.type,
    signal_prefix: cohort.signalPrefix,
    account_count: accounts.size,
    uid_count: uids.size,
    uid_prefixes: prefixes(uids),
  }
}

function operatorFingerprintHashes(events: BehaviorRiskEvent[]): Set<string> {
  return new Set(events.flatMap((event) => {
    const value = event.structure_summary?.operator_fingerprint_hash
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? [value] : []
  }))
}

function operatorAnomalyEvidence(events: IdentifiedEvent[], fingerprints: Set<string>): Record<string, unknown> {
  return {
    event_count: events.length,
    account_count: new Set(events.map((event) => event.user_id)).size,
    anomaly_types: [...new Set(events.map((event) => event.structure_summary?.anomaly_type).filter((value): value is string => typeof value === 'string'))],
    fingerprint_prefixes: [...fingerprints].slice(0, 10).map((value) => value.slice(0, 12)),
  }
}

function isDormantAfterExport(events: BehaviorRiskEvent[], path: RapidPath, now: Date): boolean {
  if (now.getTime() - path.exportedAt < POST_EXPORT_DORMANCY_MS) return false
  return !events.some((event) => (
    Date.parse(event.occurred_at) > path.exportedAt
    && (event.event_type === 'login' || event.event_type === 'page_view' || event.event_type === 'workspace_save')
  ))
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
