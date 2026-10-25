import type { CultivationData, CultivationThanksRecruitment } from '../../src/lib/cultivation-contract'
import type { PrtsSnapshot } from './catalog'
import type { readCultivationPlayer } from './player'
import { cultivationCommunityScore } from './scoring'

export const THANKS_RECRUITMENT_QUEUES = [
  { key: 'I', name: '特别招募队列·Ⅰ', operators: ['能天使', '推进之王', '伊芙利特', '艾雅法拉', '安洁莉娜', '闪灵', '夜莺', '星熊', '塞雷娅', '银灰', '斯卡蒂', '陈'] },
  { key: 'II', name: '特别招募队列·Ⅱ', operators: ['黑', '赫拉格', '麦哲伦', '莫斯提马', '煌', '阿', '刻俄柏', '风笛', '傀影', '温蒂', '早露', '铃兰'] },
  { key: 'III', name: '特别招募队列·Ⅲ', operators: ['棘刺', '森蚺', '史尔特尔', '瑕光', '泥岩', '山', '空弦', '嵯峨', '异客', '凯尔希', '卡涅利安', '帕拉斯'] },
  { key: 'IV', name: '特别招募队列·Ⅳ', operators: ['水月', '琴柳', '远牙', '焰尾', '灵知', '老鲤', '澄闪', '菲亚梅塔', '号角', '艾丽妮', '黑键', '多萝西'] },
] as const

export function buildThanksRecruitmentRecommendation(snapshot: PrtsSnapshot, player: ReturnType<typeof readCultivationPlayer>, community: CultivationData['community'] | undefined, demands: Map<string, { total: number; skills: Record<number, number>; elite: number }>): CultivationThanksRecruitment | null {
  const queues = THANKS_RECRUITMENT_QUEUES.map((queue) => ({
    ...queue,
    pool: queue.operators.flatMap((name) => {
      const operatorId = Object.entries(snapshot.operators).find(([, operator]) => operator.name === name)?.[0]
      return operatorId ? [{ operatorId, name }] : []
    }),
  })).filter((queue) => queue.pool.length === queue.operators.length)
  if (queues.length !== THANKS_RECRUITMENT_QUEUES.length) return null
  const maxDemand = Math.max(0, ...queues.flatMap((queue) => queue.pool.map(({ operatorId }) => demands.get(operatorId)?.total ?? 0)))
  const recommendations = queues.map((queue) => {
    const operators = queue.pool.map(({ operatorId, name }) => {
      const demand = demands.get(operatorId)?.total ?? 0
      const communityRate = community?.operators[operatorId]?.elite[2] ?? null
      const communityScore = cultivationCommunityScore(snapshot, operatorId, community?.operators[operatorId])
      const owned = player.characters.has(operatorId)
      const score = owned ? 0 : 100 + 80 * (communityScore ?? 0.5) + (maxDemand ? 20 * demand / maxDemand : 0)
      return { name, operatorId, owned, score, demand, communityRate, communityScore }
    })
    const expectedScore = operators.reduce((sum, operator) => sum + operator.score, 0) / operators.length
    return { key: queue.key, name: queue.name, expectedScore, unownedCount: operators.filter((operator) => !operator.owned).length, operators }
  })
  return {
    name: '感谢庆典特别招募',
    scope: '活动时间：2026-10-24 21:30 至 2026-12-02 03:59；预选期：10-24 21:30 至 11-01 06:59；招募期：11-01 12:00 至 12-02 03:59。招募后随机获得所选队列中的一名高级资深干员。推荐分按队列内等概率抽取的期望值计算。',
    queues: recommendations,
  }
}
