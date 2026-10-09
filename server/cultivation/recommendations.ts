import { defaultCultivationQuery, type CultivationQuery, type CultivationTarget, type CultivationCandidate } from '../../src/lib/cultivation-contract'
import { asRecord, asRows, type PrtsSnapshot } from './catalog'
import { readHomeworkRequirements } from './requirements'

type Requirement = ReturnType<typeof readHomeworkRequirements>['fixed'][number]
type Member = { requirement: Requirement; share: number; group: string | null; options: Requirement[] }
type Document = { homework: PrtsSnapshot['homeworks'][number]; members: Member[]; skeleton: string; variant: string; published: number }
type Family = { key: string; documents: Document[]; published: number }
type Sample = Member & { family: string; document: Document; weight: number; recent: boolean; quality: number }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function wilson(likes: number, dislikes: number) {
  const n = likes + dislikes
  if (!n) return [0, 1]
  const p = likes / n, z2 = 1.96 ** 2
  const center = p + z2 / (2 * n), margin = 1.96 * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)
  return [(center - margin) / (1 + z2 / n), (center + margin) / (1 + z2 / n)]
}

const actionAliases: Record<string, string> = { 部署: 'Deploy', 技能: 'Skill', 撤退: 'Retreat', 二倍速: 'SpeedUp', 子弹时间: 'BulletTime', 技能用法: 'SkillUsage', 打印: 'Output', 摆完挂机: 'SkillDaemon', 移动相机: 'MoveCamera', 点击: 'Click', 滑动: 'Swipe', 设置单位坐标: 'SetUnitLocation' }
const directions: Record<string, string> = { 左: 'Left', 右: 'Right', 上: 'Up', 下: 'Down', 无: 'None' }
function parse(snapshot: PrtsSnapshot, homework: PrtsSnapshot['homeworks'][number]): Document | null {
  const published = Date.parse(homework.uploadedAt ?? '')
  if (!Number.isFinite(published) || homework.content.type === 'SSS' || !homework.stageId) return null
  const parsed = readHomeworkRequirements(homework.content, snapshot)
  const members: Member[] = parsed.fixed.map((requirement) => ({ requirement, share: 1, group: null, options: [] }))
  const aliases = new Map(parsed.fixed.map((row) => [row.name, row.operator?.id ?? row.name]))
  for (const [index, rows] of parsed.groups.entries()) {
    const group = canonical(rows.map((row) => [row.operator?.id ?? row.name, row.target]).sort((a, b) => canonical(a).localeCompare(canonical(b))))
    aliases.set(String(asRows(homework.content.groups)[index]?.name ?? ''), group)
    for (const requirement of rows) members.push({ requirement, share: 1 / rows.length, group, options: rows })
  }
  const unique = new Map<string, Member>()
  for (const member of members) {
    const id = member.requirement.operator?.id
    if (id && !member.requirement.warnings.length && (!unique.has(id) || unique.get(id)!.share < member.share)) unique.set(id, member)
  }
  if (!unique.size) return null
  const actors = new Map<string, number>()
  const actions = asRows(homework.content.actions).map((action) => {
    const type = actionAliases[String(action.type)] ?? action.type ?? 'Deploy'
    const direction = directions[String(action.direction)] ?? action.direction ?? 'None'
    return { ...action, type, direction, name: aliases.get(String(action.name)) ?? action.name }
  }).filter((action) => action.type !== 'Output')
  // ponytail: summaries without actions merge equal lineups; import action details to distinguish their strategies.
  const skeleton = actions.length ? canonical(actions.map((action) => {
    const actor = String(action.name ?? '')
    if (!actors.has(actor)) actors.set(actor, actors.size)
    const row = asRecord(action)
    return [action.type, actors.get(actor), row.location, action.direction, row.rect, row.begin, row.end, row.distance]
  })) : `lineup:${[...unique.keys()].sort().join(',')}`
  const executable = actions.map((action) => Object.fromEntries(Object.entries(action).filter(([key]) => !['doc', 'doc_color', '_id'].includes(key))))
  const controls = [...asRows(homework.content.opers), ...asRows(homework.content.groups).flatMap((group) => asRows(group.opers))]
    .map((row) => [aliases.get(String(row.name)) ?? row.name, row.skill_usage ?? 0, row.skill_times ?? 1]).sort((a, b) => canonical(a).localeCompare(canonical(b)))
  const variant = canonical([[...unique].sort(([a], [b]) => a.localeCompare(b)).map(([id, row]) => [id, row.requirement.target, row.requirement.specified, row.share, row.group]), controls, executable])
  return { homework, members: [...unique.values()], skeleton, variant, published }
}

function stageInfo(snapshot: PrtsSnapshot, id: string) {
  return snapshot.stages?.[id] ?? { name: id, activity: id, category: '未知类型', permanent: /^(main_|sub_|wk_|camp_)/.test(id), open: null }
}
function stageKey(document: Document) { return `${document.homework.stageId}:${document.homework.mode}` }
function ageBucket(age: number) { return age <= 7 ? 0 : age <= 30 ? 1 : age <= 180 ? 2 : 3 }
function covers(target: CultivationTarget, other: CultivationTarget) {
  return target.skill === other.skill && target.moduleId === other.moduleId && target.potential >= other.potential
    && (target.elite > other.elite || target.elite === other.elite && target.level >= other.level) && target.skillLevel >= other.skillLevel
}

function prepareRecommendations(snapshot: PrtsSnapshot) {
  const documents = snapshot.homeworks.map((row) => parse(snapshot, row)).filter((row): row is Document => row !== null)
  const buckets = new Map<string, Family[]>()
  for (const document of documents.sort((a, b) => a.published - b.published || a.homework.id - b.homework.id)) {
    const key = `${stageKey(document)}:${document.skeleton}`
    const bucket = buckets.get(key) ?? []
    const identities = new Set(document.members.map((row) => row.requirement.operator!.id))
    const family = bucket.find((candidate) => {
      const anchor = candidate.documents[0].members.map((row) => row.requirement.operator!.id)
      return 2 * anchor.filter((id) => identities.has(id)).length / (anchor.length + identities.size) >= 0.85
    })
    if (family) family.documents.push(document)
    else bucket.push({ key: String(document.homework.id), documents: [document], published: document.published })
    buckets.set(key, bucket)
  }
  return { documents, families: [...buckets.values()].flat() }
}

export function calculateCultivationRecommendations(snapshot: PrtsSnapshot, query: CultivationQuery = defaultCultivationQuery, now = Date.now(), prepared = prepareRecommendations(snapshot)) {
  const { documents, families } = prepared
  const cutoff = now - (query.days || 180) * 86400000
  const selected = families.filter((family) => {
    const id = family.documents[0].homework.stageId, stage = stageInfo(snapshot, id)
    if (query.stageId && query.stageId !== id || query.activity && query.activity !== stage.activity || query.category && query.category !== stage.category || !query.includeClosed && stage.open === false && !stage.permanent) return false
    if (query.scope === 'permanent') return stage.permanent && family.published >= cutoff
    if (query.scope === 'history') return query.days === 0 || family.published >= cutoff
    return family.published >= cutoff || stage.permanent
  })
  const stageFamilies = new Map<string, number>()
  const categories = new Map<string, Map<string, Set<string>>>()
  const variants = new Map<Family, Document[]>()
  const exposures = new Map<string, number[]>()
  for (const family of selected) {
    const first = family.documents[0], stage = stageInfo(snapshot, first.homework.stageId), key = stageKey(first)
    stageFamilies.set(key, (stageFamilies.get(key) ?? 0) + 1)
    const category = `${stage.permanent}:${stage.category}`
    const activities = categories.get(category) ?? new Map<string, Set<string>>()
    activities.set(stage.activity, new Set([...activities.get(stage.activity) ?? [], key]))
    categories.set(category, activities)
    const byVariant = new Map<string, Document>()
    for (const document of family.documents) {
      const previous = byVariant.get(document.variant)
      const votes = (row: Document) => (row.homework.likes ?? 0) + (row.homework.dislikes ?? 0)
      if (!previous || votes(document) > votes(previous) || votes(document) === votes(previous) && document.homework.id < previous.homework.id) byVariant.set(document.variant, document)
    }
    variants.set(family, [...byVariant.values()])
    for (const document of byVariant.values()) {
      const key = `${stageKey(document)}:${ageBucket((now - family.published) / 86400000)}`
      exposures.set(key, [...exposures.get(key) ?? [], Math.log1p(document.homework.views ?? 0)])
    }
  }
  const baselines = new Map([...exposures].map(([key, values]) => [key, values.sort((a, b) => a - b)[Math.floor(values.length / 2)]]))
  const permanentCount = [...categories.keys()].filter((key) => key.startsWith('true:')).length
  const otherCount = categories.size - permanentCount
  const budget = (permanentCount ? 0.3 : 0) + (otherCount ? 0.7 : 0)
  const byOperator = new Map<string, Sample[]>()
  for (const family of selected) for (const document of variants.get(family)!) {
    const homework = document.homework, stage = stageInfo(snapshot, homework.stageId)
    const [lower, upper] = wilson(homework.likes ?? 0, homework.dislikes ?? 0)
    if (upper < 0.6 || !query.includeUncertain && !(homework.likes || homework.dislikes)) continue
    const age = Math.max(0, (now - family.published) / 86400000)
    const baseline = baselines.get(`${stageKey(document)}:${ageBucket(age)}`) ?? 0
    const exposure = baseline > 0 ? Math.max(0.9, Math.min(1.1, Math.log1p(homework.views ?? 0) / baseline)) : 1
    const activities = categories.get(`${stage.permanent}:${stage.category}`)!
    const balance = (stage.permanent ? 0.3 / permanentCount : 0.7 / otherCount) / budget / activities.size / activities.get(stage.activity)!.size
    const quality = homework.likes || homework.dislikes ? lower : 0.05
    if (quality <= 0) continue
    const weight = 100 * quality * (0.25 + 0.75 * Math.min(age / 3, 1)) * 2 ** (-age / 180) * exposure * balance / variants.get(family)!.length / stageFamilies.get(stageKey(document))!
    for (const member of document.members) {
      if (!query.includeAlternatives && member.group !== null) continue
      const operator = member.requirement.operator!
      if (query.rarity && operator.rarity !== query.rarity || query.profession && operator.profession !== query.profession || query.search && !operator.name.toLowerCase().includes(query.search.trim().toLowerCase())) continue
      byOperator.set(operator.id, [...byOperator.get(operator.id) ?? [], { ...member, document, family: family.key, weight: weight * member.share, recent: family.published >= cutoff, quality: lower }])
    }
  }
  const recommendations: Array<{ operatorId: string; target: CultivationTarget; samples: Sample[]; evidence: NonNullable<CultivationCandidate['evidence']> }> = []
  for (const [operatorId, samples] of byOperator) {
    const recent = samples.filter((row) => row.recent && row.quality > 0)
    const recentStages = new Set(recent.map((row) => stageKey(row.document))).size
    const recentFamilies = new Set(recent.map((row) => row.family)).size
    const independent = new Map<string, Sample>()
    for (const sample of samples) if (!independent.has(sample.family) || sample.quality > independent.get(sample.family)!.quality) independent.set(sample.family, sample)
    const [confidence] = wilson([...independent.values()].reduce((sum, row) => sum + (row.document.homework.likes ?? 0), 0), [...independent.values()].reduce((sum, row) => sum + (row.document.homework.dislikes ?? 0), 0))
    const focused = Boolean(query.stageId || query.activity)
    const current = confidence >= 0.5 && recentStages >= (focused ? 1 : 2) && recentFamilies >= (focused ? 1 : 3)
    if (query.scope === 'recent' && !query.includeUncertain && !current) continue
    const status = confidence < 0.5 ? 'insufficient' : current ? 'current' : recentFamilies > 0 ? 'limited' : 'historical'
    const branches = new Map<string, Sample[]>()
    for (const sample of samples) {
      const target = sample.requirement.target, key = `${target.skill}:${target.moduleId}`
      branches.set(key, [...branches.get(key) ?? [], sample])
    }
    const total = samples.reduce((sum, row) => sum + row.weight, 0)
    for (const group of branches.values()) {
      const targets = [...new Map(group.map((row) => [canonical(row.requirement.target), row.requirement.target])).values()]
      const branchWeight = group.reduce((sum, row) => sum + row.weight, 0)
      const base = targets[0], operator = snapshot.operators[operatorId]
      const elites = [...new Set(targets.map((row) => row.elite))]
      const levels = [...new Set(targets.map((row) => row.level))]
      const skills = [...new Set(targets.map((row) => row.skillLevel))]
      const potentials = [...new Set(targets.map((row) => row.potential))]
      const possible = elites.flatMap((elite) => levels.flatMap((level) => skills.flatMap((skillLevel) => potentials.map((potential) => ({ ...base, elite, level, skillLevel, potential })))))
        .filter((target) => {
          const maxima = snapshot.costs.levels.maxLevel[operator.rarity - 1]
          const module = target.moduleId ? snapshot.costs.modules.equipDict[target.moduleId] : null
          return target.level <= (maxima?.[target.elite] ?? 0) && target.elite >= Math.max(target.skill - 1, target.skillLevel > 7 ? 2 : target.skillLevel > 4 ? 1 : 0)
            && (!module || target.elite >= Number(String(module.unlockEvolvePhase ?? 'PHASE_2').slice(-1)) && target.level >= Number(module.unlockLevel))
        })
        .map((target) => ({ target, covered: group.filter((row) => covers(target, row.requirement.target)) }))
        .filter((row) => row.covered.reduce((sum, sample) => sum + sample.weight, 0) / branchWeight + 1e-9 >= query.coverage)
      const frontier: typeof possible = []
      for (const row of possible.sort((a, b) => a.target.elite - b.target.elite || a.target.level - b.target.level || a.target.skillLevel - b.target.skillLevel || a.target.potential - b.target.potential)) {
        if (!frontier.some((other) => covers(row.target, other.target))) frontier.push(row)
      }
      for (const row of frontier) {
        const completeness = (field: keyof Requirement['specified']) => group.filter((sample) => sample.requirement.specified[field]).reduce((sum, sample) => sum + sample.weight, 0) / branchWeight
        recommendations.push({ operatorId, target: row.target, samples: row.covered.sort((a, b) => b.weight - a.weight), evidence: {
          status, families: independent.size, recentFamilies, recentStages, usageShare: branchWeight / total,
          coverage: row.covered.reduce((sum, sample) => sum + sample.weight, 0) / branchWeight,
          completeness: { training: completeness('training'), skill: completeness('skill'), module: completeness('module') },
        } })
      }
    }
  }
  return { recommendations, invalid: snapshot.homeworks.length - documents.length + documents.reduce((sum, row) => sum + row.members.filter((member) => member.requirement.moduleUnresolved).length, 0),
    homeworks: selected.reduce((sum, family) => sum + family.documents.length, 0),
    families: selected.length, withoutActions: selected.filter((family) => family.documents[0].skeleton.startsWith('lineup:')).length,
    stages: [...new Set(documents.map((row) => row.homework.stageId))].map((id) => ({ id, ...stageInfo(snapshot, id) })),
    professions: [...new Set(Object.values(snapshot.operators).flatMap((row) => row.profession ? [row.profession] : []))].sort() }
}

// Cache public evidence only; player training and inventory are always calculated per request.
const cache = new WeakMap<PrtsSnapshot, { prepared: ReturnType<typeof prepareRecommendations>; expires: number; queries: Map<string, ReturnType<typeof calculateCultivationRecommendations>> }>()
export function getCultivationRecommendations(snapshot: PrtsSnapshot, query: CultivationQuery) {
  const now = Date.now(), key = canonical(query)
  let entry = cache.get(snapshot)
  if (!entry) { entry = { prepared: prepareRecommendations(snapshot), expires: now + 15 * 60000, queries: new Map() }; cache.set(snapshot, entry) }
  if (entry.expires <= now) { entry.queries.clear(); entry.expires = now + 15 * 60000 }
  let result = entry.queries.get(key)
  if (!result) {
    result = calculateCultivationRecommendations(snapshot, query, now, entry.prepared)
    if (entry.queries.size >= 64) entry.queries.delete(entry.queries.keys().next().value!)
    entry.queries.set(key, result)
  }
  return result
}
