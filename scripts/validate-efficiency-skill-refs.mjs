import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  isPublicEfficiencyDataFallback,
  readEfficiencyDataSource,
} from './efficiency-data-source.mjs'

const FACILITY_PREFIXES = new Map([
  ['控制中枢', 'CC'],
  ['贸易站', 'TRD'],
  ['制造站', 'MFG'],
  ['发电站', 'PWR'],
  ['宿舍', 'DORM'],
  ['会客室', 'MEET'],
  ['办公室', 'HR'],
  ['加工站', 'PROC'],
  ['训练室', 'TRAIN'],
])
const COMBINATION_FACILITIES = new Map([
  ['trading_station', '贸易站'],
  ['manufacturing_station', '制造站'],
  ['power_station', '发电站'],
  ['meeting_room', '会客室'],
  ['hire', '办公室'],
  ['processing', '加工站'],
])
const DEPENDENCY_FACILITIES = new Map([
  ['control_center', '控制中枢'],
  ['dormitory', '宿舍'],
  ['power_station', '发电站'],
  ['hire', '办公室'],
  ['process', '加工站'],
])
const SCOPE_FACILITIES = new Map([
  ['control_center', '控制中枢'],
  ['dormitory', '宿舍'],
  ['hire', '办公室'],
  ['manufacturing_station', '制造站'],
  ['meeting_room', '会客室'],
  ['power_station', '发电站'],
  ['processing', '加工站'],
  ['trading_station', '贸易站'],
])
const NON_SKILL_EXEMPT_DESCRIPTIONS = new Set([
  '异格人数贡献（不触发叠加规则）',
  '彩虹小队人数贡献（不触发叠加规则）',
])
const RULE_ID_RE = /^PRTS-([A-Z]+)-(\d{4,})$/
const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/
const REQUIRED_COVERAGE_FACILITIES = new Set([
  '办公室',
  '会客室',
  '控制中枢',
  '贸易站',
  '宿舍',
  '制造站',
])
const PRODUCTS_BY_WORKPLACE = new Map([
  ['trading_station', new Set(['LMD', 'Orundum'])],
  ['manufacturing_station', new Set(['Pure Gold', 'Originium Shard', 'Battle Record'])],
])
const MANUFACTURING_PRODUCT_SCOPES = [
  [/作战记录类配方/u, 'Battle Record'],
  [/贵金属类配方/u, 'Pure Gold'],
  [/源石类配方/u, 'Originium Shard'],
]
const DECLARED_OPERATOR_FIELDS = [
  'combo',
  'control_center',
  'dormitory',
  'power_station',
  'hire',
  'process',
]
const HOLDER_EXEMPTION_REASONS = new Set([
  'global_dynamic_resource_source',
])

function canonicalRuleContent(rule) {
  return {
    facility: rule.facility,
    skill: rule.skill,
    description: rule.description,
    icon: rule.icon,
    holders: (rule.holders ?? []).map((holder) => ({
      name: holder.name,
      elite: holder.elite,
    })),
  }
}

export function calculateSkillContentHash(rule) {
  const canonical = JSON.stringify(canonicalRuleContent(rule))
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function declaredOperators(raw, path) {
  if (raw === undefined || raw === null) return []
  const values = Array.isArray(raw) ? raw : [raw]
  return values.map((value, index) => {
    const valuePath = `${path}[${index}]`
    assertCondition(typeof value === 'string', `${valuePath} must be a string.`)
    const match = /^(.*?)(?:\/([0-2]))?$/u.exec(value.trim())
    assertCondition(match && match[1].trim(), `${valuePath} has an invalid operator value.`)
    return {
      name: match[1].trim(),
      elite: match[2] === undefined ? 0 : Number(match[2]),
    }
  })
}

function ruleDeclaredOperators(rule, path, inherited = []) {
  const operators = [...inherited]
  for (const field of DECLARED_OPERATOR_FIELDS) {
    operators.push(...declaredOperators(rule[field], `${path}.${field}`))
  }
  const effects = rule.dynamic_effects ?? rule.dynamicEffects ?? []
  for (const [index, effect] of (Array.isArray(effects) ? effects : [effects]).entries()) {
    const eliteRequirements = effect?.operator_elite_requirements ?? effect?.operatorEliteRequirements
    if (eliteRequirements === undefined || eliteRequirements === null) continue
    const effectPath = `${path}.dynamic_effects[${index}].operator_elite_requirements`
    assertCondition(
      eliteRequirements && typeof eliteRequirements === 'object' && !Array.isArray(eliteRequirements),
      `${effectPath} must be an object.`,
    )
    for (const [name, elite] of Object.entries(eliteRequirements)) {
      assertCondition(typeof name === 'string' && name.trim(), `${effectPath} has an invalid operator name.`)
      assertCondition(
        Number.isInteger(elite) && elite >= 0 && elite <= 2,
        `${effectPath}.${name} must be 0, 1, or 2.`,
      )
      operators.push({ name: name.trim(), elite })
    }
  }
  return operators
}

function normalizedSkillName(skill) {
  return skill.skill.replace(/[·・]?[αβ]$/u, '')
}

function normalizedSkillIcon(skill) {
  const filename = String(skill.icon).split('/').at(-1).split(/[?#]/, 1)[0]
  return filename.replace(/\.[^.]+$/, '').replace(/\d+$/, '')
}

function skillsShareHolderAtDifferentElite(left, right) {
  const rightElites = new Map(right.holders.map((holder) => [holder.name, holder.elite ?? 0]))
  return left.holders.some((holder) => (
    rightElites.has(holder.name) && rightElites.get(holder.name) !== (holder.elite ?? 0)
  ))
}

function sameUpgradeLineage(left, right) {
  if (left.facility !== right.facility || !skillsShareHolderAtDifferentElite(left, right)) return false
  return normalizedSkillName(left) === normalizedSkillName(right) ||
    normalizedSkillIcon(left) === normalizedSkillIcon(right)
}

function validateSkills(payload) {
  assertCondition(payload && typeof payload === 'object', 'Skill data must be a JSON object.')
  assertCondition(
    Number.isInteger(payload.last_rule_number) && payload.last_rule_number >= 0,
    'Skill data last_rule_number must be a non-negative integer.',
  )
  assertCondition(Array.isArray(payload.skills), 'Skill data skills must be an array.')

  const byId = new Map()
  let maximum = 0
  for (const [index, rule] of payload.skills.entries()) {
    const path = `skills[${index}]`
    const expectedPrefix = FACILITY_PREFIXES.get(rule.facility)
    assertCondition(expectedPrefix, `${path} has unknown facility ${JSON.stringify(rule.facility)}.`)

    const idMatch = RULE_ID_RE.exec(rule.rule_id ?? '')
    assertCondition(idMatch, `${path} has invalid rule_id ${JSON.stringify(rule.rule_id)}.`)
    assertCondition(
      idMatch[1] === expectedPrefix,
      `${path} rule_id prefix ${idMatch[1]} does not match facility ${rule.facility}.`,
    )
    assertCondition(!byId.has(rule.rule_id), `${path} duplicates rule_id ${rule.rule_id}.`)
    maximum = Math.max(maximum, Number(idMatch[2]))

    assertCondition(
      CONTENT_HASH_RE.test(rule.content_hash ?? ''),
      `${path} has invalid content_hash.`,
    )
    const expectedHash = calculateSkillContentHash(rule)
    assertCondition(
      rule.content_hash === expectedHash,
      `${path} (${rule.rule_id}) has stale content_hash; expected ${expectedHash}.`,
    )
    assertCondition(Array.isArray(rule.holders) && rule.holders.length > 0, `${path} must have holders.`)
    const holderKeys = new Set()
    for (const [holderIndex, holder] of rule.holders.entries()) {
      const holderPath = `${path}.holders[${holderIndex}]`
      assertCondition(
        holder && typeof holder.name === 'string' && holder.name.trim(),
        `${holderPath}.name must be a non-empty string.`,
      )
      assertCondition(
        Number.isInteger(holder.elite) && holder.elite >= 0 && holder.elite <= 2,
        `${holderPath}.elite must be 0, 1, or 2.`,
      )
      const holderKey = `${holder.name}\u0000${holder.elite}`
      assertCondition(!holderKeys.has(holderKey), `${path} duplicates holder ${holder.name}/${holder.elite}.`)
      holderKeys.add(holderKey)
    }
    byId.set(rule.rule_id, rule)
  }
  assertCondition(
    payload.last_rule_number >= maximum,
    `Skill data last_rule_number ${payload.last_rule_number} is below assigned maximum ${maximum}.`,
  )
  return byId
}

function enumerateEfficiencyRules(data) {
  const leaves = []
  const combinationRules = data.combination_rules ?? {}
  for (const [workplace, systems] of Object.entries(combinationRules)) {
    const primaryFacility = COMBINATION_FACILITIES.get(workplace)
    assertCondition(primaryFacility, `Unknown combination_rules workplace ${workplace}.`)
    for (const [systemName, systemData] of Object.entries(systems ?? {})) {
      const rules = Array.isArray(systemData) ? systemData : systemData?.rules
      const inheritedProduct = Array.isArray(systemData) ? undefined : systemData?.product
      const systemPath = `combination_rules.${workplace}.${systemName}`
      const inheritedOperators = Array.isArray(systemData)
        ? []
        : declaredOperators(systemData?.base_combo, `${systemPath}.base_combo`)
      assertCondition(
        Array.isArray(rules),
        `combination_rules.${workplace}.${systemName} must be an array or contain rules.`,
      )
      for (const [index, rule] of rules.entries()) {
        const path = `${systemPath}[${index}]`
        const facilities = new Set([primaryFacility])
        for (const [field, facility] of DEPENDENCY_FACILITIES) {
          if (Array.isArray(rule[field]) && rule[field].length > 0) facilities.add(facility)
        }
        collectScopedFacilities(rule, facilities)
        leaves.push({
          rule,
          path,
          facilities,
          primaryFacility,
          declaredOperators: ruleDeclaredOperators(rule, path, inheritedOperators),
          workplace,
          products: normalizeProductList(rule.product ?? inheritedProduct),
        })
      }
    }
  }

  for (const [index, rule] of (data.control_center_rules ?? []).entries()) {
    const path = `control_center_rules[${index}]`
    leaves.push({
      rule,
      path,
      facilities: new Set(['控制中枢']),
      primaryFacility: '控制中枢',
      declaredOperators: declaredOperators(rule.operators ?? rule.operator, `${path}.operator`),
    })
  }
  for (const [index, rule] of (data.dormitory_mood_recovery_rules ?? []).entries()) {
    const path = `dormitory_mood_recovery_rules[${index}]`
    assertCondition(
      Number.isInteger(rule.elite) && rule.elite >= 0 && rule.elite <= 2,
      `${path}.elite must be 0, 1, or 2.`,
    )
    leaves.push({
      rule,
      path,
      facilities: new Set(['宿舍']),
      primaryFacility: '宿舍',
      declaredOperators: [{ name: rule.holder, elite: rule.elite }],
    })
  }
  return leaves
}

function normalizeProductList(product) {
  if (typeof product === 'string') return [product]
  return Array.isArray(product) ? product : []
}

function validateProductScope(workplace, products, referencedSkills, path) {
  const allowedProducts = PRODUCTS_BY_WORKPLACE.get(workplace)
  if (!allowedProducts) return
  for (const product of products) {
    assertCondition(
      allowedProducts.has(product),
      `${path} has unsupported product ${JSON.stringify(product)} for ${workplace}.`,
    )
  }
  if (workplace !== 'manufacturing_station') return

  const referencedScopes = new Set()
  for (const skill of referencedSkills) {
    if (skill.facility !== '制造站') continue
    for (const [pattern, product] of MANUFACTURING_PRODUCT_SCOPES) {
      if (pattern.test(skill.description)) referencedScopes.add(product)
    }
  }
  if (referencedScopes.size === 0) return
  assertCondition(
    products.length > 0,
    `${path} references product-scoped manufacturing skills (${[...referencedScopes].join(', ')}) but has no product.`,
  )
  for (const product of products) {
    assertCondition(
      referencedScopes.has(product),
      `${path} product ${JSON.stringify(product)} conflicts with referenced manufacturing skill scopes ` +
        `(${[...referencedScopes].join(', ')}).`,
    )
  }
}

function collectScopedFacilities(value, facilities) {
  if (Array.isArray(value)) {
    for (const item of value) collectScopedFacilities(item, facilities)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (
      (key === 'scope' || key === 'dependency_scope' || key === 'dependencyScope') &&
      typeof child === 'string'
    ) {
      const facility = SCOPE_FACILITIES.get(child)
      if (facility) facilities.add(facility)
    }
    collectScopedFacilities(child, facilities)
  }
}

export function validateEfficiencySkillReferences(skillPayload, efficiencyData) {
  const skillsById = validateSkills(skillPayload)
  const leaves = enumerateEfficiencyRules(efficiencyData)
  const referencedSkillIds = new Set()
  const operatorGroupNames = new Set(Object.keys(efficiencyData.operator_groups ?? {}))

  for (const [ruleIndex, rule] of (efficiencyData.dormitory_mood_recovery_rules ?? []).entries()) {
    for (const [bonusIndex, bonus] of (rule.target_bonuses ?? []).entries()) {
      if (bonus.target_group === undefined || bonus.target_group === null) continue
      const path = `dormitory_mood_recovery_rules[${ruleIndex}].target_bonuses[${bonusIndex}].target_group`
      assertCondition(typeof bonus.target_group === 'string' && bonus.target_group, `${path} must be a string.`)
      assertCondition(
        operatorGroupNames.has(bonus.target_group),
        `${path} references unknown operator group ${JSON.stringify(bonus.target_group)}.`,
      )
    }
  }

  for (const {
    rule,
    path,
    facilities,
    primaryFacility,
    declaredOperators: operators,
    workplace,
    products,
  } of leaves) {
    assertCondition(
      Object.hasOwn(rule, 'skill_rule_refs') && Array.isArray(rule.skill_rule_refs),
      `${path} must define skill_rule_refs as an array.`,
    )
    const refs = rule.skill_rule_refs
    const exemption = rule.skill_rule_exemption
    const rawHolderExemptions = rule.skill_ref_holder_exemptions ?? []
    assertCondition(
      Array.isArray(rawHolderExemptions),
      `${path}.skill_ref_holder_exemptions must be an array.`,
    )
    const holderExemptions = new Map()
    for (const [index, holderExemption] of rawHolderExemptions.entries()) {
      const exemptionPath = `${path}.skill_ref_holder_exemptions[${index}]`
      assertCondition(
        holderExemption && typeof holderExemption === 'object',
        `${exemptionPath} must be an object.`,
      )
      assertCondition(typeof holderExemption.id === 'string', `${exemptionPath}.id must be a string.`)
      assertCondition(
        HOLDER_EXEMPTION_REASONS.has(holderExemption.reason),
        `${exemptionPath} has unsupported reason ${JSON.stringify(holderExemption.reason)}.`,
      )
      assertCondition(
        !holderExemptions.has(holderExemption.id),
        `${path} duplicates holder exemption ${holderExemption.id}.`,
      )
      holderExemptions.set(holderExemption.id, holderExemption.reason)
    }

    if (refs.length === 0) {
      assertCondition(holderExemptions.size === 0, `${path} cannot exempt holders without skill references.`)
      assertCondition(
        exemption === 'non_skill_condition',
        `${path} has no skill references and must declare non_skill_condition.`,
      )
      assertCondition(
        NON_SKILL_EXEMPT_DESCRIPTIONS.has(rule.description),
        `${path} is not an approved non-skill rule exemption.`,
      )
      continue
    }

    assertCondition(
      exemption === undefined,
      `${path} cannot combine skill references with skill_rule_exemption.`,
    )
    const seen = new Set()
    const referencedSkills = []
    for (const [index, ref] of refs.entries()) {
      const refPath = `${path}.skill_rule_refs[${index}]`
      assertCondition(ref && typeof ref === 'object', `${refPath} must be an object.`)
      assertCondition(typeof ref.id === 'string', `${refPath}.id must be a string.`)
      assertCondition(!seen.has(ref.id), `${path} duplicates skill reference ${ref.id}.`)
      seen.add(ref.id)

      const skill = skillsById.get(ref.id)
      assertCondition(skill, `${refPath} references unknown skill ${ref.id}.`)
      referencedSkillIds.add(ref.id)
      assertCondition(ref.hash === skill.content_hash, `${refPath} has a stale hash for ${ref.id}.`)
      assertCondition(
        facilities.has(skill.facility),
        `${refPath} references ${skill.facility}, expected one of ${[...facilities].join(', ')}.`,
      )
      const holderMatched = skill.holders.some((holder) => operators.some((operator) => (
        operator.name === holder.name && operator.elite >= holder.elite
      )))
      const holderExemption = holderExemptions.get(ref.id)
      if (holderMatched) {
        assertCondition(
          holderExemption === undefined,
          `${refPath} has an unnecessary skill holder exemption.`,
        )
      } else {
        assertCondition(
          holderExemption !== undefined,
          `${refPath} is not backed by a declared holder at the required elite level; ` +
            `expected one of ${skill.holders.map((holder) => `${holder.name}/${holder.elite}`).join(', ')}.`,
        )
        assertCondition(
          skill.facility !== primaryFacility,
          `${refPath} cannot exempt a holder mismatch in its primary facility ${primaryFacility}.`,
        )
      }
      referencedSkills.push(skill)
    }
    for (const exemptedId of holderExemptions.keys()) {
      assertCondition(
        seen.has(exemptedId),
        `${path} has holder exemption for unreferenced skill ${exemptedId}.`,
      )
    }
    for (let left = 0; left < referencedSkills.length; left += 1) {
      for (let right = left + 1; right < referencedSkills.length; right += 1) {
        assertCondition(
          !sameUpgradeLineage(referencedSkills[left], referencedSkills[right]),
          `${path} references multiple versions of one skill upgrade lineage: ` +
            `${referencedSkills[left].rule_id}, ${referencedSkills[right].rule_id}.`,
        )
      }
    }
    validateProductScope(workplace, products, referencedSkills, path)
  }
  for (const skill of skillsById.values()) {
    if (!REQUIRED_COVERAGE_FACILITIES.has(skill.facility)) continue
    assertCondition(
      referencedSkillIds.has(skill.rule_id),
      `${skill.rule_id} (${skill.facility}/${skill.skill}) has no efficiency rule or explicit placeholder.`,
    )
  }
  return { skillCount: skillsById.size, efficiencyRuleCount: leaves.length }
}

function makeSkill(overrides = {}) {
  const rule = {
    rule_id: 'PRTS-TRD-0001',
    facility: '贸易站',
    skill: '订单管理',
    description: '订单效率+10%',
    icon: 'https://example.test/order.png',
    holders: [{ name: '测试干员', elite: 0 }],
    ...overrides,
  }
  rule.content_hash = calculateSkillContentHash(rule)
  return rule
}

function makeFixture() {
  const skill = makeSkill()
  return {
    skills: { last_rule_number: 1, skills: [skill] },
    efficiency: {
      combination_rules: {
        trading_station: {
          '通用单人': [{
            combo: ['测试干员'],
            efficiency: 10,
            skill_rule_refs: [{ id: skill.rule_id, hash: skill.content_hash }],
          }],
        },
      },
      control_center_rules: [],
      dormitory_mood_recovery_rules: [],
    },
  }
}

function expectFailure(mutator, pattern) {
  const fixture = structuredClone(makeFixture())
  mutator(fixture)
  assert.throws(
    () => validateEfficiencySkillReferences(fixture.skills, fixture.efficiency),
    pattern,
  )
}

export function runSelfTests() {
  const valid = makeFixture()
  assert.deepEqual(
    validateEfficiencySkillReferences(valid.skills, valid.efficiency),
    { skillCount: 1, efficiencyRuleCount: 1 },
  )

  const eliteMismatch = makeFixture()
  eliteMismatch.skills.skills[0].holders[0].elite = 2
  eliteMismatch.skills.skills[0].content_hash = calculateSkillContentHash(eliteMismatch.skills.skills[0])
  eliteMismatch.efficiency.combination_rules.trading_station['通用单人'][0]
    .skill_rule_refs[0].hash = eliteMismatch.skills.skills[0].content_hash
  assert.throws(
    () => validateEfficiencySkillReferences(eliteMismatch.skills, eliteMismatch.efficiency),
    /not backed by a declared holder at the required elite level/,
  )
  eliteMismatch.efficiency.combination_rules.trading_station['通用单人'][0].combo = ['测试干员/2']
  validateEfficiencySkillReferences(eliteMismatch.skills, eliteMismatch.efficiency)

  const unrelatedHolder = makeFixture()
  unrelatedHolder.skills.skills[0].holders[0].name = '其他干员'
  unrelatedHolder.skills.skills[0].content_hash = calculateSkillContentHash(unrelatedHolder.skills.skills[0])
  unrelatedHolder.efficiency.combination_rules.trading_station['通用单人'][0]
    .skill_rule_refs[0].hash = unrelatedHolder.skills.skills[0].content_hash
  assert.throws(
    () => validateEfficiencySkillReferences(unrelatedHolder.skills, unrelatedHolder.efficiency),
    /not backed by a declared holder at the required elite level/,
  )
  unrelatedHolder.efficiency.combination_rules.trading_station['通用单人'][0]
    .skill_ref_holder_exemptions = [{
      id: unrelatedHolder.skills.skills[0].rule_id,
      reason: 'global_dynamic_resource_source',
    }]
  assert.throws(
    () => validateEfficiencySkillReferences(unrelatedHolder.skills, unrelatedHolder.efficiency),
    /cannot exempt a holder mismatch in its primary facility/,
  )

  const globalResourceSource = makeFixture()
  const globalSkill = globalResourceSource.skills.skills[0]
  globalSkill.rule_id = 'PRTS-DORM-0001'
  globalSkill.facility = '宿舍'
  globalSkill.holders = [{ name: '全局资源来源', elite: 0 }]
  globalSkill.content_hash = calculateSkillContentHash(globalSkill)
  const globalRule = globalResourceSource.efficiency.combination_rules.trading_station['通用单人'][0]
  globalRule.dormitory = ['辅助宿舍干员']
  globalRule.skill_rule_refs = [{ id: globalSkill.rule_id, hash: globalSkill.content_hash }]
  globalRule.skill_ref_holder_exemptions = [{
    id: globalSkill.rule_id,
    reason: 'global_dynamic_resource_source',
  }]
  validateEfficiencySkillReferences(globalResourceSource.skills, globalResourceSource.efficiency)

  expectFailure(
    ({ efficiency }) => delete efficiency.combination_rules.trading_station['通用单人'][0].skill_rule_refs,
    /must define skill_rule_refs/,
  )
  expectFailure(
    ({ skills }) => {
      const uncovered = makeSkill({
        rule_id: 'PRTS-MEET-0002',
        facility: '会客室',
        skill: '未覆盖技能',
        icon: 'https://example.test/uncovered.png',
      })
      skills.last_rule_number = 2
      skills.skills.push(uncovered)
    },
    /has no efficiency rule or explicit placeholder/,
  )
  expectFailure(
    ({ efficiency }) => { efficiency.combination_rules.trading_station['通用单人'][0].skill_rule_refs[0].id = 'PRTS-TRD-9999' },
    /unknown skill/,
  )
  expectFailure(
    ({ efficiency }) => { efficiency.combination_rules.trading_station['通用单人'][0].skill_rule_refs[0].hash = 'sha256:' + '0'.repeat(64) },
    /stale hash/,
  )
  expectFailure(
    ({ efficiency }) => {
      const rule = efficiency.combination_rules.trading_station['通用单人'][0]
      rule.skill_rule_refs.push(structuredClone(rule.skill_rule_refs[0]))
    },
    /duplicates skill reference/,
  )
  expectFailure(
    ({ skills, efficiency }) => {
      efficiency.combination_rules.trading_station['通用单人'][0].combo = ['测试干员/2']
      const upgraded = makeSkill({
        rule_id: 'PRTS-TRD-0002',
        skill: '订单管理·β',
        icon: 'https://example.test/order2.png',
        holders: [{ name: '测试干员', elite: 2 }],
      })
      skills.last_rule_number = 2
      skills.skills.push(upgraded)
      efficiency.combination_rules.trading_station['通用单人'][0].skill_rule_refs.push({
        id: upgraded.rule_id,
        hash: upgraded.content_hash,
      })
    },
    /multiple versions of one skill upgrade lineage/,
  )
  expectFailure(
    ({ skills, efficiency }) => {
      const controlSkill = makeSkill({
        rule_id: 'PRTS-CC-0001',
        facility: '控制中枢',
      })
      skills.skills[0] = controlSkill
      efficiency.combination_rules.trading_station['通用单人'][0].skill_rule_refs[0] = {
        id: controlSkill.rule_id,
        hash: controlSkill.content_hash,
      }
    },
    /expected one of/,
  )

  const dynamicControlDependency = makeFixture()
  const dynamicControlSkill = makeSkill({
    rule_id: 'PRTS-CC-0001',
    facility: '控制中枢',
    holders: [{ name: '辅助中枢干员', elite: 2 }],
  })
  dynamicControlDependency.skills.skills[0] = dynamicControlSkill
  const dynamicControlRule = dynamicControlDependency.efficiency
    .combination_rules.trading_station['通用单人'][0]
  dynamicControlRule.skill_rule_refs[0] = {
    id: dynamicControlSkill.rule_id,
    hash: dynamicControlSkill.content_hash,
  }
  dynamicControlRule.dynamic_effects = {
    type: 'operator_presence_count',
    operators: ['辅助中枢干员'],
    operator_elite_requirements: { 辅助中枢干员: 2 },
    dependency_scope: 'control_center',
  }
  validateEfficiencySkillReferences(
    dynamicControlDependency.skills,
    dynamicControlDependency.efficiency,
  )
  dynamicControlRule.dynamic_effects.operator_elite_requirements.辅助中枢干员 = 1
  assert.throws(
    () => validateEfficiencySkillReferences(
      dynamicControlDependency.skills,
      dynamicControlDependency.efficiency,
    ),
    /not backed by a declared holder at the required elite level/,
  )
  expectFailure(
    ({ efficiency }) => { efficiency.combination_rules.trading_station['通用单人'][0].skill_rule_refs = [] },
    /must declare non_skill_condition/,
  )
  expectFailure(
    ({ efficiency }) => {
      const rule = efficiency.combination_rules.trading_station['通用单人'][0]
      rule.skill_rule_refs = []
      rule.skill_rule_exemption = 'non_skill_condition'
    },
    /not an approved/,
  )
  expectFailure(
    ({ efficiency }) => { efficiency.combination_rules.trading_station['通用单人'][0].skill_rule_exemption = 'non_skill_condition' },
    /cannot combine/,
  )
  expectFailure(
    ({ efficiency }) => { efficiency.combination_rules.trading_station['通用单人'][0].product = 'Unknown' },
    /unsupported product/,
  )

  const scoped = makeFixture()
  const scopedSkill = makeSkill({
    rule_id: 'PRTS-MFG-0001',
    facility: '制造站',
    description: '进驻制造站时，贵金属类配方的生产力+25%',
  })
  scoped.skills.skills[0] = scopedSkill
  scoped.efficiency.combination_rules = {
    manufacturing_station: {
      '通用单人': [{
        combo: ['测试干员'],
        efficiency: 25,
        skill_rule_refs: [{ id: scopedSkill.rule_id, hash: scopedSkill.content_hash }],
      }],
    },
  }
  assert.throws(
    () => validateEfficiencySkillReferences(scoped.skills, scoped.efficiency),
    /product-scoped manufacturing skills.*but has no product/,
  )
  scoped.efficiency.combination_rules.manufacturing_station['通用单人'][0].product = 'Battle Record'
  assert.throws(
    () => validateEfficiencySkillReferences(scoped.skills, scoped.efficiency),
    /conflicts with referenced manufacturing skill scopes/,
  )
  scoped.efficiency.combination_rules.manufacturing_station['通用单人'][0].product = 'Pure Gold'
  validateEfficiencySkillReferences(scoped.skills, scoped.efficiency)

  expectFailure(
    ({ efficiency }) => {
      efficiency.dormitory_mood_recovery_rules = [{
        holder: '测试干员',
        elite: 0,
        target_bonuses: [{ target_group: 'missing_group', bonus: 0.45 }],
      }]
    },
    /references unknown operator group "missing_group"/,
  )

  const exempt = makeFixture()
  const coveredRule = structuredClone(
    exempt.efficiency.combination_rules.trading_station['通用单人'][0],
  )
  exempt.efficiency.combination_rules.trading_station['通用单人'][0] = {
    description: '异格人数贡献（不触发叠加规则）',
    skill_rule_refs: [],
    skill_rule_exemption: 'non_skill_condition',
  }
  exempt.efficiency.combination_rules.trading_station['通用单人'].push(coveredRule)
  validateEfficiencySkillReferences(exempt.skills, exempt.efficiency)
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTests()
    console.log('Efficiency skill reference validator self-tests passed.')
    return
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const [skillPayload, efficiencySource] = await Promise.all([
    readFile(resolve(root, 'tools/prts_logistics_skills.json'), 'utf8').then(JSON.parse),
    readEfficiencyDataSource(resolve(root, 'server/handlers/efficiency-data.json')),
  ])
  if (isPublicEfficiencyDataFallback(efficiencySource)) {
    console.log('Skipped efficiency skill reference validation because the private efficiency source is unavailable.')
    return
  }
  const efficiencyData = JSON.parse(efficiencySource)
  const result = validateEfficiencySkillReferences(skillPayload, efficiencyData)
  console.log(
    `Validated ${result.efficiencyRuleCount} efficiency rules against ${result.skillCount} PRTS skills.`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
