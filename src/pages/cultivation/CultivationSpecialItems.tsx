import { memo, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { copy } from '../../copy/index'
import type { CultivationData, CultivationOptions } from '../../lib/cultivation-contract'
import { allocateCultivationMaterials, type buildCultivationPlan } from '../../lib/cultivation-planner'
import { number } from './CultivationResults'

const label = copy.tools.cultivation
const itemIcon = (id: string) => `https://torappu.prts.wiki/assets/item_icon/${encodeURIComponent(id)}.png`

type Props = { data: CultivationData; plan: ReturnType<typeof buildCultivationPlan>; preference: CultivationOptions['preference'] }

export function useSpecialItems({ data, plan, preference }: Props) {
  const [chosen, setChosen] = useState('')
  const [visible, setVisible] = useState(8)
  const selected = data.specialItems?.find((item) => item.id === chosen)
  const recommendations = useMemo(() => {
    if (!selected) return []
    const before = allocateCultivationMaterials(plan.totalMaterials, data.inventory, data)
    return selected.recommendations.map((row) => {
      let sanity: number | null = null
      let relief = 0
      if (selected.kind === 'materials') {
        const stock = { ...data.inventory }
        for (const [id, count] of Object.entries(row.items)) stock[id] = (stock[id] ?? 0) + count
        const after = allocateCultivationMaterials(plan.totalMaterials, stock, data)
        sanity = before.sanity !== null && after.sanity !== null ? Math.max(0, before.sanity - after.sanity) : null
        relief = Object.entries(before.missing).reduce((sum, [id, count]) => sum + Math.max(0, count - (after.missing[id] ?? 0)), 0)
      } else if (selected.kind !== 'selector') {
        sanity = Object.keys(row.items).some((id) => data.prices[id] === undefined) ? null : Object.entries(row.items).reduce((sum, [id, count]) => sum + data.prices[id] * count, 0)
      }
      return { ...row, sanity, relief }
    }).sort((a, b) => {
      if (selected.kind === 'materials') return Number(b.relief > 0) - Number(a.relief > 0) || (b.sanity ?? -1) - (a.sanity ?? -1) || b.relief - a.relief || a.key.localeCompare(b.key)
      if (selected.kind === 'selector' && a.owned !== b.owned) return Number(a.owned) - Number(b.owned)
      if (preference === 'community') return (b.communityRate ?? -1) - (a.communityRate ?? -1) || b.demand - a.demand || (b.sanity ?? -1) - (a.sanity ?? -1) || a.key.localeCompare(b.key)
      return b.demand - a.demand || (b.communityRate ?? -1) - (a.communityRate ?? -1) || (b.sanity ?? -1) - (a.sanity ?? -1) || a.key.localeCompare(b.key)
    })
  }, [data, plan, preference, selected])
  return { chosen, setChosen, visible, setVisible, selected, recommendations }
}

export default memo(function CultivationSpecialItems({ data, plan, preference }: Props) {
  const { chosen, setChosen, visible, setVisible, selected, recommendations } = useSpecialItems({ data, plan, preference })
  return <section className="tool-panel space-y-4 p-5 sm:p-6">
    <div><h2 className="text-lg font-semibold">{label.specialItems}</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">{label.specialHint}</p></div>
    {!data.specialItems?.length ? <p className="text-sm text-ink-secondary">{label.noSpecialItems}</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.specialItems.map((item) => <button key={item.id} type="button" aria-pressed={item.id === chosen} className={`tool-secondary-action flex min-w-0 items-center justify-start gap-3 text-left ${item.id === chosen ? 'tool-option-selected' : ''}`} onClick={() => { setChosen(item.id); setVisible(8) }}>
      <img src={itemIcon(item.iconId)} alt="" loading="lazy" width={48} height={48} className="size-12 shrink-0 object-contain" />
      <span className="min-w-0"><span title={item.name} className="block truncate text-sm font-semibold">{item.name}</span><span className="mt-1 block text-xs text-ink-secondary">{label.itemStock(item.count)}{!item.available && ` · ${label.itemExpired}`}</span></span>
    </button>)}</div>}
    {selected && <div className="tool-inset space-y-4 p-4">
      <div><h3 className="font-semibold">{selected.name}</h3><p className="mt-2 text-sm leading-6 text-ink-secondary">{selected.scope}</p>
        <p className="mt-1 text-xs leading-5 text-ink-secondary">{label.specialConditions[selected.kind]}</p>
        {selected.expiresAt && <p className="mt-1 text-xs text-ink-secondary">{label.expiry} {new Date(selected.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
        <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="tool-secondary-action mt-3 inline-flex items-center gap-2 text-xs"><ExternalLink size={14} />{label.itemDetails}</a>
      </div>
      {!selected.available ? <p className="text-sm text-warning">{label.itemExpired}</p> : !recommendations.length ? <p className="text-sm text-ink-secondary">{label.noItemUses}</p> : <>
        <h4 className="text-sm font-semibold">{label.specialRecommendations}</h4>
        <ol className="divide-y divide-surface-3">{recommendations.slice(0, visible).map((row, index) => <li key={row.key} className="flex min-w-0 gap-3 py-3">
          <span className="pt-1 tabular-nums text-brand-500">{index + 1}</span>
          {row.operatorId && <img src={`/webp96/${encodeURIComponent(row.operatorId)}.webp`} alt="" loading="lazy" width={40} height={40} className="size-10 shrink-0 rounded object-cover" />}
          {selected.kind === 'materials' && <img src={itemIcon(data.itemIcons?.[row.key] ?? row.key)} alt="" loading="lazy" width={40} height={40} className="size-10 shrink-0 object-contain" />}
          <div className="min-w-0 text-sm"><p className="font-medium">{row.name}{row.skill && ` · ${label.skillName(row.skill)} ◆◆◆`}{row.owned !== undefined && <span className="ml-2 text-xs text-ink-muted">{row.owned ? label.ownedOperator : label.newOperator}</span>}</p>
            {selected.kind === 'materials' ? <><p className="mt-1 text-xs leading-5 text-ink-secondary">{Object.entries(row.items).map(([id, count]) => `${data.itemNames[id] ?? id} × ${count}`).join(' · ')}</p><p className="mt-1 text-xs text-ink-secondary">{row.relief > 0 ? label.materialRelief(row.sanity === null ? label.unpriced : number(row.sanity)) : label.noBatchDemand}</p></>
              : <><p className="mt-1 text-xs text-ink-secondary">{label.weightedDemand} {number(row.demand)} · {label.communityRate(row.communityRate)}</p>{selected.kind !== 'selector' && <p className="mt-1 text-xs text-ink-secondary">{label.voucherSavings(row.sanity === null ? label.unpriced : number(row.sanity))}</p>}</>}
          </div>
        </li>)}</ol>
        {recommendations.length > visible && <button type="button" className="tool-secondary-action" onClick={() => setVisible((count) => count + 16)}>{label.showMore}</button>}
      </>}
    </div>}
    {data.specialItemsUpdatedAt && <p className="text-xs text-ink-muted">{label.specialDate} · {new Date(data.specialItemsUpdatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
  </section>
})
