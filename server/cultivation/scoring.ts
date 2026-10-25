import type { CultivationStatistics } from '../../src/lib/cultivation-contract'
import type { PrtsSnapshot } from './catalog'

export function cultivationCommunityScore(snapshot: PrtsSnapshot, operatorId: string, statistics: CultivationStatistics | undefined): number | null {
  if (!statistics || statistics.owned < 100) return null
  const mastery = Math.max(0, ...statistics.skills.map((ranks) => ranks[3] ?? 0))
  const modules = (snapshot.costs.modules.charEquip[operatorId] ?? []).flatMap((id) => {
    const equip = snapshot.costs.modules.equipDict[id]
    return equip && equip.type !== 'INITIAL' && equip.typeName2 ? [statistics.modules[String(equip.typeName2)] ?? []] : []
  })
  // Use the best branch so extra skills or modules do not inflate the score.
  const module = Math.max(0, ...modules.map((ranks) => ((ranks[1] ?? 0) + 2 * (ranks[2] ?? 0) + 3 * (ranks[3] ?? 0)) / 3))
  return (0.3 * (statistics.elite[2] ?? 0) + 0.5 * mastery + 0.2 * module) / (modules.length ? 1 : 0.8)
}
