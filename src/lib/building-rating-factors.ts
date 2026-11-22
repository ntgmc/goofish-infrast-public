import { buildingMeetingBonus, buildingRatingSkill, type RatingMember, type RatingVariant } from './building-skill-ratings'

export type RatingFactorId = 'efficiency' | 'coverage' | 'mood' | 'facility' | 'team' | 'slots' | 'flexibility'
type RatingFactorLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type RatingFactor = { id: RatingFactorId; score: RatingFactorLevel | null; raw?: number; high?: number; basis: string; conditional?: boolean; scenes?: string[]; parts?: ReturnType<typeof buildingMeetingBonus> & { skill: number | null } }
type RatingFactorProfile = { room: string; factors: RatingFactor[] }
type RatingFactorContext = Pick<RatingVariant, 'members' | 'requirements' | 'production'> | { member: Pick<RatingMember, 'id' | 'elite'> }

const references: Record<string, number> = { manufacture: 40, trading: 40, power: 25, meeting: 65, hire: 50, processing: 100, training: 100, recycling: 30, dormitory: 1.2 }
const outputPatterns: Record<string, RegExp> = {
  manufacture: /生产力(?:提升)?([+-]?\d+(?:\.\d+)?)%/g,
  trading: /订单(?:获取)?效率(?:提升)?([+-]?\d+(?:\.\d+)?)%/g,
  power: /无人机充能速度(?:提升)?([+-]?\d+(?:\.\d+)?)%/g,
  meeting: /线索搜集速度(?:额外)?(?:提升)?([+-]?\d+(?:\.\d+)?)%/g,
  hire: /(?:联络速度|联络速度额外)(?:提升)?([+-]?\d+(?:\.\d+)?)%/g,
  processing: /副产品的产出概率(?:额外)?提升([+-]?\d+(?:\.\d+)?)%/g,
  training: /(?:专精技能训练速度|训练速度额外)([+-]?\d+(?:\.\d+)?)%/g,
  recycling: /材料转化效率([+-]?\d+(?:\.\d+)?)%/g,
}
const facilities: Record<string, RegExp> = { control: /控制中枢/, dormitory: /宿舍/, manufacture: /制造站/, trading: /贸易站/, power: /发电站/, meeting: /会客室/, hire: /人力办公室/, training: /训练室/ }
const level = (value: number): RatingFactorLevel => Math.max(1, Math.min(5, Math.ceil(value / 20))) as RatingFactorLevel

// Match the reviewed routine scenarios, rather than treating a per-unit coefficient as the total.
const routineOutputs: Record<string, { raw: number; scene: string; target?: string }> = {
  'control_tra_limit&spd3[000]': { raw: 10, scene: 'threeKjerag', target: 'trading' },
  'trade_ord_spd&dorm&lv[000]': { raw: 1 * 4 * 5, scene: 'fourDorms' },
  'trade_ord_spd&dorm&lv[010]': { raw: 2 * 4 * 5, scene: 'fourDorms' },
  'manu_formula_spd&dorm&lv[000]': { raw: 1 * 4 * 5, scene: 'fourDorms' },
  'power_rec_spd&dorm&lv[000]': { raw: 0.5 * 4 * 5, scene: 'fourDorms' },
  'hire_spd_dorm&lv[000]': { raw: 5 + 1 * 4 * 5, scene: 'fourDorms' },
  'hire_spd_dorm&lv[010]': { raw: 5 + 2 * 4 * 5, scene: 'fourDorms' },
  'trade_ord_spd&share[001]': { raw: 10 * 2, scene: 'twoCoworkers' },
  'trade_ord_spd&share[002]': { raw: 20 * 2, scene: 'twoCoworkers' },
  'trade_ord_spd&share[000]': { raw: 15 * 2, scene: 'twoCoworkers' },
  'trade_ord_spd&share[100]': { raw: 15 * 2, scene: 'twoCoworkers' },
  'trade_ord_spd&share[110]': { raw: 20 * 2, scene: 'twoCoworkers' },
  'trade_ord_spd&meet[010]': { raw: 15 + 5 * 3, scene: 'meetingLevel3' },
  'trade_ord_spd&meet[000]': { raw: 25 + 5 * 3, scene: 'meetingLevel3' },
  'trade_ord_spd&formula[000]': { raw: 30 + 2 * 2, scene: 'twoProductionRecipes' },
  'trade_ord_spd&gold[000]': { raw: 5, scene: 'twoGoldLines' },
  'trade_ord_spd&gold[010]': { raw: 5 + 15, scene: 'twoGoldLines' },
  'trade_ord_spd&gold[100]': { raw: 5 * 2, scene: 'twoGoldLines' },
  'manu_prod_spd&trade[000]': { raw: 20 * 2, scene: 'twoTradingPosts' },
  'manu_prod_spd&trade[1000]': { raw: 3 * 2, scene: 'twoTradingPosts' },
  'manu_prod_spd_train&lv[000]': { raw: 10 * 3, scene: 'trainingLevel3' },
  'manu_constrLv[000]': { raw: 0, scene: 'sixtyFourRobots' },
  'manu_prod_spd_bd[100]': { raw: 64 / 16 * 5, scene: 'sixtyFourRobots' },
  'manu_prod_spd_bd[110]': { raw: 64 / 8 * 5, scene: 'sixtyFourRobots' },
  'power_rec_drone[000]': { raw: 200 / 10, scene: 'droneCapacity200' },
  'hire_spd_cost&extra[000]': { raw: 10 * 3, scene: 'threeRecruitSlots' },
  'meet_spd&clue[000]': { raw: 5 * 3, scene: 'threeRecruitSlots' },
  'meet_spd_hast[000]': { raw: (20 + 22 + 24 + 26 + 28 + 30 + 30 + 30) / 8, scene: 'eightHourAverage' },
  'manu_prod_spd_addition[030]': { raw: (20 + 21 + 22 + 23 + 24 + 25 + 25 + 25) / 8, scene: 'eightHourAverage' },
  'manu_prod_spd_addition[031]': { raw: (20 + 21 + 22 + 23 + 24 + 25 + 25 + 25) / 8, scene: 'eightHourAverage' },
  'manu_prod_spd_addition[040]': { raw: (15 + 17 + 19 + 21 + 23 + 25 + 25 + 25) / 8, scene: 'eightHourAverage' },
  'manu_prod_spd_addition[041]': { raw: (15 + 17 + 19 + 21 + 23 + 25 + 25 + 25) / 8, scene: 'eightHourAverage' },
}

// These descriptive indices never read the published assessment score.
export function buildingRatingFactors(room: string, ids: string[], context?: RatingFactorContext): RatingFactorProfile {
  const variant = context && 'members' in context ? context : undefined
  const member = context && 'member' in context ? context.member : undefined
  const effects = ids.map((id) => ({ id, ...buildingRatingSkill(id) }))
  const local = effects.filter((skill) => skill.room === room)
  const descriptions = local.map((skill) => skill.description)
  const combined = descriptions.join('；')
  const conditional = /如果|若|只有|当与|每有|每个|每名|每1|额外|处于|本次训练|训练位干员分支/.test(combined)
  const dependencyRooms = new Set<string>()
  for (const skill of effects) for (const [key, name] of Object.entries(facilities)) {
    if (key !== room && new RegExp(`${/(?:如果|若|当|每)[^；。]*/.source}${name.source}|${name.source}${/[^；。]*(?:每有|每名|每个|每级|每\d)/.source}`).test(skill.description)) dependencyRooms.add(key)
  }
  if (variant) {
    for (const member of variant.members) if (member.room !== room) dependencyRooms.add(member.room)
    for (const [key, target] of [['powerCount', 'power'], ['powerCountExact', 'power'], ['dormLevel', 'dormitory'], ['dormOccupants', 'dormitory'], ['goldLines', 'manufacture']] as const) {
      if (variant.requirements[key] !== undefined && target !== room) dependencyRooms.add(target)
    }
  }
  const sharedStaff = local.some((skill) => /^trade_ord_spd&share\[/.test(skill.id))
  if (/工程机器人|每间设施每级/.test(combined)) dependencyRooms.add('layout')
  const partnerCount = variant ? variant.members.length - 1 : sharedStaff ? 2 : /当与|与其他|当.*入驻|若.*进驻|每.*(?:干员|作业平台)|每有.*(?:干员|作业平台)/.test(combined) ? 1 : 0
  const solo = /只有自身处于工作状态/.test(combined)
  const trainingConditions = [/专精技能至\d级/, /训练位干员分支/, /训练时长达/].filter((pattern) => pattern.test(combined)).length + partnerCount
  return { room, factors: [
    room === 'meeting' && (member || variant) ? meetingOutputFactor(effects, member ? [member] : variant!.members.filter((item) => item.room === room)) : outputFactor(room, effects, variant),
    coverageFactor(room, descriptions),
    moodFactor(room, descriptions),
    { id: 'facility', score: level(100 / (1 + dependencyRooms.size)), raw: dependencyRooms.size, basis: 'facilities' },
    room === 'meeting' ? { id: 'slots', score: solo ? 1 : 5, raw: solo ? 1 : 2, basis: 'slots' }
      : room === 'training' ? { id: 'flexibility', score: level(100 / (1 + trainingConditions)), raw: trainingConditions, basis: 'conditions' }
        : { id: 'team', score: level(100 / (1 + partnerCount)), raw: partnerCount, basis: variant ? 'partners' : sharedStaff ? 'anyPartners' : partnerCount ? 'specificPartners' : 'independent', conditional },
  ] }
}

function outputFactor(room: string, effects: { id: string; description: string; room: string }[], variant?: Pick<RatingVariant, 'members' | 'production'>): RatingFactor {
  if (room === 'manufacture' && variant?.production !== undefined) {
    const occupants = variant.members.filter((member) => member.room === room).length
    const raw = variant.production / occupants
    return { id: 'efficiency', score: level(raw / references[room] * 100), raw, basis: 'perWorker', conditional: true }
  }
  effects = effects.filter((effect) => effect.room === room || routineOutputs[effect.id]?.target === room || outputPatterns[room] && [...effect.description.matchAll(outputPatterns[room])].length > 0)
  if (room === 'trading') {
    if (effects.some((effect) => effect.id === 'trade_ord_closure[000]')) return { id: 'efficiency', score: 9, basis: 'orderValueClosure' }
    if (effects.some((effect) => effect.id === 'trade_ord_law[000]')) {
      if (effects.some((effect) => effect.id === 'trade_ord_against[010]')) return { id: 'efficiency', score: 8, basis: 'orderValueDispute2' }
      if (effects.some((effect) => effect.id === 'trade_ord_against[000]')) return { id: 'efficiency', score: 6, basis: 'orderValueDispute1' }
    }
  }
  const text = effects.map((effect) => effect.description).join('；')
  if (room === 'dormitory') {
    if (/每|如果|若|额外|低于|大于|小于/.test(text.replace(/每小时/g, ''))) return { id: 'efficiency', score: null, basis: 'variableRecovery' }
    const values = effects.flatMap((effect) => [...effect.description.matchAll(/(?:恢复|恢复效果)(?:额外)?([+-]\d+(?:\.\d+)?)/g)].map((match) => Number(match[1])))
    if (!values.length) return { id: 'efficiency', score: null, basis: 'variableRecovery' }
    const raw = Math.max(...values)
    return { id: 'efficiency', score: level(raw / references[room] * 100), raw, basis: 'recovery' }
  }
  if (!outputPatterns[room]) return { id: 'efficiency', score: null, basis: 'mixedSupport' }
  const routine = effects.filter((effect) => routineOutputs[effect.id] && (effect.room === room || routineOutputs[effect.id].target === room))
  const remaining = effects.filter((effect) => !routine.includes(effect))
  const variable = /每有|每个|每名|每\d|每满|每消耗|每获得|每累计|首小时|此后|最终|归零|转化为|累积|下一次|订单.*必定|交付.*龙门币|视为/.test(remaining.map((effect) => effect.description).join('；'))
  if (variable) return { id: 'efficiency', score: null, basis: 'variableOutput' }
  const values = [...routine.map((effect) => routineOutputs[effect.id].raw), ...remaining.flatMap((effect) => [...effect.description.matchAll(outputPatterns[room])].map((match) => Number(match[1])))]
  if (!values.length && /更容易|倾向|必定|概率|立即完成|所需时间/.test(text)) return { id: 'efficiency', score: null, basis: 'specialOutput' }
  const raw = values.reduce((sum, value) => sum + value, 0)
  const conditional = /如果|若|只有|当与|与其他|额外|本次训练|训练位干员分支|处于线索交流/.test(text)
  return { id: 'efficiency', score: level(raw / references[room] * 100), raw, basis: routine.length ? 'routineOutput' : 'bonus', conditional: conditional || routine.length > 0, scenes: [...new Set(routine.map((effect) => routineOutputs[effect.id].scene))] }
}

function meetingOutputFactor(effects: { id: string; description: string; room: string }[], members: Pick<RatingMember, 'id' | 'elite'>[]): RatingFactor {
  if (!members.length) return { id: 'efficiency', score: null, basis: 'meetingNoStaff' }
  const skill = outputFactor('meeting', effects.filter((effect) => /线索搜集速度/.test(effect.description)))
  const bonuses = members.map(buildingMeetingBonus)
  const average = (key: 'rarity' | 'elite' | 'work') => bonuses.reduce((sum, value) => sum + value[key], 0) / members.length
  const parts = { rarity: average('rarity'), elite: average('elite'), work: average('work'), skill: skill.raw === undefined ? null : skill.raw / members.length }
  const raw = parts.skill === null ? undefined : parts.rarity + parts.elite + parts.work + parts.skill
  return { ...skill, raw, parts, score: raw === undefined ? null : level(raw / references.meeting * 100), basis: members.length > 1 ? 'meetingPerWorker' : 'meetingWorker' }
}

function coverageFactor(room: string, descriptions: string[]): RatingFactor {
  const text = descriptions.join('；')
  if (room === 'meeting') {
    const missing = descriptions.filter((description) => /尚未拥有/.test(description)).length
    if (/必定获得/.test(text)) return { id: 'coverage', score: 5, raw: 100, basis: 'guaranteedClue', conditional: true }
    if (missing) return { id: 'coverage', score: null, basis: missing > 1 ? 'clueStackUnverified' : 'clueMissingUnquantified', conditional: /当与|处于线索交流/.test(text) }
    if (/已经拥有/.test(text)) return { id: 'coverage', score: 1, basis: 'clueOwned' }
    if (/更容易|概率|倾向/.test(text)) return { id: 'coverage', score: null, basis: 'clueFactionUnquantified' }
    return { id: 'coverage', score: 1, basis: 'clueNone' }
  }
  if (room === 'processing') {
    const output = descriptions.filter((description) => /副产品|因果|业报/.test(description)).join('；')
    const [score, basis]: [number, string] = !output ? [0, 'noByproduct'] : /原始心情消耗为|原始\d心情/.test(output) ? [40, 'moodTier']
      : /炽合金块材料|异铁组材料/.test(output) ? [20, 'oneRecipe']
        : /手性屈光体或重相位对映体/.test(output) ? [30, 'twoRecipes']
          : /加工[^时；]*类材料时/.test(output) && !/任意类材料/.test(output) ? [40, 'materialFamily']
            : /精英材料/.test(output) ? [80, 'eliteMaterials'] : /技巧概要|基建材料|芯片/.test(output) ? [60, 'materialCategory'] : [100, 'allRecipes']
    return { id: 'coverage', score: level(score), basis }
  }
  if (room === 'training') {
    const professions = new Set(text.match(/先锋|近卫|狙击|重装|医疗|辅助|术师|特种/g) ?? [])
    const count = professions.size || 8
    return { id: 'coverage', score: level(count / 8 * 100), raw: count, basis: 'professions', conditional: /分支|专精技能至|训练时长达/.test(text) }
  }
  if (room === 'dormitory') {
    const raw = /所有干员/.test(text) ? /除自身以外[^；。]*所有干员/.test(text) ? 4 : 5 : /某个干员|恢复目标/.test(text) ? 1 : /自身/.test(text) ? 1 : 0
    return { id: 'coverage', score: level(raw * 20), raw, basis: 'recoveryTargets' }
  }
  const restricted = /作战记录|贵金属|赤金|源石|原石|特别订单/.test(text)
  return { id: 'coverage', score: restricted ? 3 : 5, basis: restricted ? 'specificProduct' : 'generalUse' }
}

function moodFactor(room: string, descriptions: string[]): RatingFactor {
  const text = descriptions.join('；')
  if (/(?:每有|每个|每名|每\d|每满)[^；。]*心情.*(?:消耗|恢复)|返还|恢复自身一次心情|消除.*心情消耗/.test(text)) return { id: 'mood', score: null, basis: 'variableMood' }
  if (room === 'processing') {
    const changes = [2, 4, 8].map((original) => {
      let cost = original
      for (const description of descriptions) {
        const fixed = description.match(/心情消耗恒定为(\d+)/)
        const addition = description.match(/相应配方全部([+-]\d+)心情消耗/)
        const reduction = description.match(/心情消耗为(\d+)(以上)?的配方全部([+-]\d+)心情消耗/)
        if (fixed) cost = Number(fixed[1])
        if (addition) cost += Number(addition[1])
        if (reduction && (reduction[2] ? original >= Number(reduction[1]) : original === Number(reduction[1]))) cost += Number(reduction[3])
        if (/全部除以4心情消耗/.test(description) && original >= 4) cost /= 4
        if (/加工晶体类材料时，全部心情消耗-1/.test(description)) cost -= 1
      }
      return cost - original
    })
    return { id: 'mood', score: level(75 - changes.reduce((sum, value) => sum + value, 0) / changes.length * 25), raw: Math.min(...changes), high: Math.max(...changes), basis: 'craftMood' }
  }
  const changes = descriptions.flatMap((description) => description.split(/[；，。]/).filter((clause) => !/除自身以外|其余干员/.test(clause)).flatMap((clause) => {
    const consumption = [...clause.matchAll(/心情每小时消耗([+-]\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]))
    const recovery = [...clause.matchAll(/(?:自身|所有干员的)心情每小时恢复([+-]\d+(?:\.\d+)?)/g)].map((match) => -Number(match[1]))
    return [...consumption, ...recovery]
  }))
  const raw = Math.round(changes.reduce((sum, value) => sum + value, 0) * 1000) / 1000
  return { id: 'mood', score: level(75 - raw * 25), raw, basis: 'hourMood', conditional: /如果|当与|协助.*至/.test(text) }
}
