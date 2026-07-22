import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
      assertCondition(
        Array.isArray(rules),
        `combination_rules.${workplace}.${systemName} must be an array or contain rules.`,
      )
      for (const [index, rule] of rules.entries()) {
        const facilities = new Set([primaryFacility])
        for (const [field, facility] of DEPENDENCY_FACILITIES) {
          if (Array.isArray(rule[field]) && rule[field].length > 0) facilities.add(facility)
        }
        collectScopedFacilities(rule, facilities)
        leaves.push({
          rule,
          path: `combination_rules.${workplace}.${systemName}[${index}]`,
          facilities,
          workplace,
          products: normalizeProductList(rule.product ?? inheritedProduct),
        })
      }
    }
  }

  for (const [index, rule] of (data.control_center_rules ?? []).entries()) {
    leaves.push({
      rule,
      path: `control_center_rules[${index}]`,
      facilities: new Set(['控制中枢']),
    })
  }
  for (const [index, rule] of (data.dormitory_mood_recovery_rules ?? []).entries()) {
    leaves.push({
      rule,
      path: `dormitory_mood_recovery_rules[${index}]`,
      facilities: new Set(['宿舍']),
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
    if (key === 'scope' && typeof child === 'string') {
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

  for (const { rule, path, facilities, workplace, products } of leaves) {
    assertCondition(
      Object.hasOwn(rule, 'skill_rule_refs') && Array.isArray(rule.skill_rule_refs),
      `${path} must define skill_rule_refs as an array.`,
    )
    const refs = rule.skill_rule_refs
    const exemption = rule.skill_rule_exemption

    if (refs.length === 0) {
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
      referencedSkills.push(skill)
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
  const [skillPayload, efficiencyData] = await Promise.all([
    readFile(resolve(root, 'tools/prts_logistics_skills.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'server/handlers/efficiency-data.json'), 'utf8').then(JSON.parse),
  ])
  const result = validateEfficiencySkillReferences(skillPayload, efficiencyData)
  console.log(
    `Validated ${result.efficiencyRuleCount} efficiency rules against ${result.skillCount} PRTS skills.`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
