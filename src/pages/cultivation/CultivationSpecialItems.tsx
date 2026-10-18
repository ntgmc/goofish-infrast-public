import { memo, useMemo, useState } from 'react'
import { ExternalLinkIcon as ExternalLink } from '../../components/icons'
import { copy } from '../../copy/index'
import type { CultivationData, CultivationOptions } from '../../lib/cultivation-contract'
import { number } from './CultivationResults'

const label = copy.tools.cultivation
const itemIcon = (id: string) => `/item-icons/${encodeURIComponent(id)}.png`

type Props = { data: CultivationData; preference: CultivationOptions['preference'] }

export function useSpecialItems({ data, preference }: Props) {
  const [chosen, setChosen] = useState('')
  const [visible, setVisible] = useState(8)
  const items = data.specialItems?.filter((item) => item.kind !== 'materials') ?? []
  const selected = items.find((item) => item.id === chosen)
  const recommendations = useMemo(() => {
    if (!selected) return []
    return [...selected.recommendations].sort((a, b) => {
      if (selected.kind === 'selector' && a.owned !== b.owned) return Number(a.owned) - Number(b.owned)
      if (preference === 'community') return (b.communityRate ?? -1) - (a.communityRate ?? -1) || b.demand - a.demand || a.key.localeCompare(b.key)
      return b.demand - a.demand || (b.communityRate ?? -1) - (a.communityRate ?? -1) || a.key.localeCompare(b.key)
    })
  }, [preference, selected])
  return { chosen, setChosen, visible, setVisible, items, selected, recommendations }
}

export default memo(function CultivationSpecialItems({ data, preference }: Props) {
  const { chosen, setChosen, visible, setVisible, items, selected, recommendations } = useSpecialItems({ data, preference })
  return <section className="tool-panel space-y-4 p-5 sm:p-6">
    <div><h2 className="text-lg font-semibold">{label.specialItems}</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">{label.specialHint}</p></div>
    {!items.length ? <p className="text-sm text-ink-secondary">{label.noSpecialItems}</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <button key={item.id} type="button" aria-pressed={item.id === chosen} className={`tool-secondary-action flex min-w-0 items-center justify-start gap-3 text-left ${item.id === chosen ? 'tool-option-selected' : ''}`} onClick={() => { setChosen(item.id); setVisible(8) }}>
      <img src={itemIcon(item.iconId)} alt="" loading="lazy" width={48} height={48} className="size-12 shrink-0 object-contain" />
      <span className="min-w-0"><span title={item.name} className="block truncate text-sm font-semibold">{item.name}</span><span title={item.scope} className="mt-1 line-clamp-2 text-xs text-ink-secondary">{item.count === null ? item.scope : label.itemStock(item.count)}{!item.available && ` · ${label.itemExpired}`}</span></span>
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
          <div className="min-w-0 text-sm"><p className="font-medium">{row.name}{row.skill && ` · ${label.skillName(row.skill)} ◆◆◆`}{row.owned !== undefined && <span className="ml-2 text-xs text-ink-muted">{row.owned ? label.ownedOperator : label.newOperator}</span>}</p>
            <p className="mt-1 text-xs text-ink-secondary">{label.weightedDemand} {number(row.demand)} · {label.communityRate(row.communityRate)}</p>
          </div>
        </li>)}</ol>
        {recommendations.length > visible && <button type="button" className="tool-secondary-action" onClick={() => setVisible((count) => count + 16)}>{label.showMore}</button>}
      </>}
    </div>}
    {data.specialItemsUpdatedAt && <p className="text-xs text-ink-muted">{label.specialDate} · {new Date(data.specialItemsUpdatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
  </section>
})
