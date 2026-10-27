import type { CultivationCurrent, CultivationData } from '../../src/lib/cultivation-contract'
import type { TrainingAccountData } from '../../src/lib/training-ratio-account'
import { asRecord, asRows, type PrtsSnapshot } from './catalog'
import { readCultivationPlayer } from './player'

export function buildTrainingAccountData(snapshot: PrtsSnapshot, game: unknown, inventory: unknown, community: CultivationData['community']): Omit<TrainingAccountData, 'snapshotVersion' | 'importedAt'> {
  if (asRows(asRecord(asRecord(game).data ?? game).chars).some((row) => !snapshot.operators[String(row.charId ?? row.id ?? '')])) throw new Error('部分已持有干员的培养资料暂不可用')
  const player = readCultivationPlayer(game, inventory, snapshot)
  const groups = new Map<string, [string, CultivationCurrent][]>()
  for (const [id, current] of player.characters) {
    const baseId = snapshot.operators[id].baseId ?? id
    const forms = groups.get(baseId) ?? []
    forms.push([id, current])
    groups.set(baseId, forms)
  }
  const operators = [...groups].map(([id, forms]) => {
    const info = snapshot.operators[id]
    if (!info) throw new Error('部分已持有干员的培养资料暂不可用')
    const current = forms.reduce((best, form) => form[1].elite > best[1].elite || form[1].elite === best[1].elite && form[1].level > best[1].level ? form : best)[1]
    const modules = forms.flatMap(([formId, current]) => (snapshot.costs.modules.charEquip[formId] ?? []).flatMap((moduleId) => {
      const statistics = community?.operators[formId]
      const module = snapshot.costs.modules.equipDict[moduleId]
      if (!module) throw new Error('模组资料不完整')
      if (module.type === 'INITIAL') return []
      const distribution = statistics?.modules[String(module.typeName2)]
      return [{ id: moduleId, name: String(module.uniEquipName ?? moduleId), elite: Number(String(module.unlockEvolvePhase ?? 'PHASE_2').slice(-1)), level: Number(module.unlockLevel),
        current: current.modulesKnown === false ? null : current.modules[moduleId] ?? 0,
        common: statistics && statistics.owned >= 100 && distribution ? distribution.slice(1).reduce((sum, rate) => sum + rate, 0) >= 0.5 : null,
        costs: [1, 2, 3].map((rank) => {
          const items = asRecord(module.itemCost)[String(rank)]
          if (!Array.isArray(items)) return null
          let lmd = 0
          for (const item of items) {
            const row = asRecord(item)
            if (typeof row.id !== 'string' || typeof row.count !== 'number' || !Number.isSafeInteger(row.count) || row.count < 0) return null
            if (row.id === '4001') lmd += row.count
          }
          return lmd
        }),
      }]
    }))
    return { id, name: info.name, rarity: info.rarity, elite: current.elite, level: current.level, modules }
  })
  const levels = snapshot.costs.levels
  return { operators, inventory: { lmd: player.inventory['4001'] ?? 0, exp: player.inventory.exp },
    levels: { maxLevel: levels.maxLevel, characterExpMap: levels.characterExp, characterUpgradeCostMap: levels.characterUpgradeCost, evolveGoldCost: levels.eliteCost },
    warnings: [...snapshot.warnings, ...(community?.status === 'stale' ? ['常用模组参考上次更新的社区培养资料。'] : [])],
  }
}
