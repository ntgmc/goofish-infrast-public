import { ExperienceIcon, LmdIcon, MaterialIcon } from '../../../components/icons'
import { copy } from '../../../copy'
import type { CultivationData } from '../../../lib/cultivation-contract'
import itemIcons from '../../../data/cultivation-item-icons.json'

const text = copy.cultivationProjects
const number = (amount: number) => amount.toLocaleString('zh-CN', { maximumFractionDigits: 1 })

export function ResourceArt({ id, data }: { id: string; data: CultivationData }) {
  const itemId = id === 'exp' ? '2004' : id
  const icon = data.itemIcons?.[itemId] || (itemIcons as Record<string, string>)[itemId]
  const Icon = id === 'exp' ? ExperienceIcon : id === '4001' ? LmdIcon : MaterialIcon
  return <span className="v2-project-resource-art" data-resource={id === 'exp' || id === '4001' ? id : 'material'} aria-hidden="true">
    <Icon size={22} />
    {icon && <img src={`https://torappu.prts.wiki/assets/item_icon/${encodeURIComponent(icon)}.png`} alt="" width={40} height={40} loading="lazy" onError={(event) => { event.currentTarget.hidden = true }} />}
  </span>
}

export function MaterialNeeds({ items, data, shortage = false }: { items: Record<string, number>; data: CultivationData; shortage?: boolean }) {
  const entries = Object.entries(items)
  return <div className="v2-project-materials" data-shortage={shortage}>
    <div className="v2-project-material-heading"><h4>{shortage ? text.materialShortage : text.requiredMaterials}</h4><span>{text.materialKinds(entries.length)}</span></div>
    {entries.length ? <ul>{entries.map(([id, count]) => <li key={id}>
      <ResourceArt id={id} data={data} /><span>{data.itemNames[id] ?? id}<strong>{text.requiredAmount(number(count))}</strong></span>
    </li>)}</ul> : <p className="v2-muted">{text.noShortage}</p>}
  </div>
}
