import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BackIcon, CollapsedIcon, ExperienceIcon, LmdIcon, MaterialIcon, NextIcon, ProcessingRoomIcon } from '../../../components/icons'
import { PageTransition } from '../../../components/MotionPrimitives'
import { copy } from '../../../copy'
import type { CultivationData } from '../../../lib/cultivation-contract'
import { buildMaterialRoutes, type MaterialIngredient } from '../../../lib/cultivation-materials'
import itemIcons from '../../../data/cultivation-item-icons.json'

const text = copy.cultivationProjects
const number = (amount: number) => amount.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
type SelectMaterial = (id: string, count: number) => void

function ResourceArt({ id, data }: { id: string; data: CultivationData }) {
  const itemId = id === 'exp' ? '2004' : id
  const icon = data.itemIcons?.[itemId] || (itemIcons as Record<string, string>)[itemId]
  const Icon = id === 'exp' ? ExperienceIcon : id === '4001' ? LmdIcon : MaterialIcon
  return <span className="v2-project-resource-art" data-resource={id === 'exp' || id === '4001' ? id : 'material'} aria-hidden="true">
    <Icon size={22} />
    {icon && <img src={`/item-icons/${encodeURIComponent(icon)}.png`} alt="" width={40} height={40} loading="lazy" onError={(event) => { event.currentTarget.hidden = true }} />}
  </span>
}

export function MaterialButton({ id, count, data, onSelect, children, className = '' }: { id: string; count: number; data: CultivationData; onSelect: SelectMaterial; children?: ReactNode; className?: string }) {
  return <button type="button" className={`v2-project-material-button ${className}`} data-material-id={id} title={data.itemNames[id] ?? id} aria-label={text.viewMaterial(data.itemNames[id] ?? id)} onClick={() => onSelect(id, count)}>
    <ResourceArt id={id} data={data} /><span><span>{data.itemNames[id] ?? id}</span><strong>{children ?? text.requiredAmount(number(count))}</strong></span><CollapsedIcon size={14} aria-hidden="true" />
  </button>
}

export function MaterialBrowser({ data, children }: { data: CultivationData; children: (select: SelectMaterial) => ReactNode }) {
  const [selected, setSelected] = useState('')
  const origin = useRef<string | null>(null)
  const restoreFocus = useRef(false)
  const select: SelectMaterial = (id, count) => {
    if (!selected) origin.current = id
    setSelected(JSON.stringify([id, count]))
  }
  const restoreList = useCallback((element: HTMLDivElement | null) => {
    if (!element || !restoreFocus.current) return
    Array.from(element.querySelectorAll<HTMLButtonElement>('[data-material-id]')).find((button) => button.dataset.materialId === origin.current)?.focus({ preventScroll: true })
    restoreFocus.current = false
  }, [])
  return <PageTransition motionKey={selected} className="v2-project-material-browser">{(displayed) => {
    const selection: [string, number] | null = displayed ? JSON.parse(displayed) : null
    return selection ? <MaterialRoute key={displayed} id={selection[0]} count={selection[1]} data={data} onSelect={select} onBack={() => { restoreFocus.current = true; setSelected('') }} /> : <div ref={restoreList}>{children(select)}</div>
  }}</PageTransition>
}

function MaterialRoute({ id, count, data, onSelect, onBack }: { id: string; count: number; data: CultivationData; onSelect: SelectMaterial; onBack: () => void }) {
  const back = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { back.current?.focus({ preventScroll: true }) }, [])
  const routes = buildMaterialRoutes(id, count, data)
  return <section className="v2-project-material-route" aria-label={text.materialRoute(data.itemNames[id] ?? id)} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onBack() }
  }}>
    <header className="v2-project-recipe-header"><button ref={back} type="button" className="v2-text-button" onClick={onBack}><BackIcon size={16} aria-hidden="true" />{text.backToMaterials}</button><ProcessingRoomIcon size={20} aria-hidden="true" /></header>
    <div className="v2-project-recipe-title"><ResourceArt id={id} data={data} /><div><h4>{text.materialRoute(data.itemNames[id] ?? id)}</h4><p>{text.requiredAmount(number(count))}</p></div></div>
    <p className="v2-muted">{text.recipeHint}</p>
    <div className="v2-project-recipe-scroll">
      <h5>{text.ingredients}</h5><ul className="v2-project-recipe-tree"><IngredientBranch node={routes.ingredient} data={data} onSelect={onSelect} /></ul>
      <h5>{text.products}</h5>
      {routes.products.length ? <ol className="v2-project-recipe-products">{routes.products.map(({ id: product, recipe }) => <li key={product}>
        <span className="v2-project-recipe-batch">{text.eachRecipe}</span><div className="v2-project-recipe-inputs">{Object.entries(recipe.items).map(([input, amount]) => <MaterialButton key={input} id={input} count={amount} data={data} onSelect={onSelect} />)}</div>
        <NextIcon size={18} aria-hidden="true" /><MaterialButton id={product} count={recipe.count} data={data} onSelect={onSelect} className="v2-project-recipe-output">{text.recipeOutput(number(recipe.count))}</MaterialButton>
      </li>)}</ol> : <p className="v2-muted">{text.noProducts}</p>}
    </div>
  </section>
}

function IngredientBranch({ node, data, onSelect }: { node: MaterialIngredient; data: CultivationData; onSelect: SelectMaterial }) {
  const farm = data.farms[node.id]?.[0]
  return <li>
    <MaterialButton id={node.id} count={node.count} data={data} onSelect={onSelect} />
    {node.cycle ? <p className="v2-project-recipe-source">{text.cycleRecipe}</p> : node.ingredients.length > 0 ? <ul>{node.ingredients.map((ingredient) => <IngredientBranch key={ingredient.id} node={ingredient} data={data} onSelect={onSelect} />)}</ul> : <>
      <p className="v2-project-recipe-source">{node.id === '4001' || node.id === 'exp' ? text.baseSource : farm ? text.farmSource(farm.stage) : text.noFarm}</p>
      {node.conversion && <div className="v2-project-recipe-conversion"><span>{text.exchange}</span><MaterialButton id={node.conversion.id} count={node.conversion.count} data={data} onSelect={onSelect} /><NextIcon size={14} aria-hidden="true" /><MaterialButton id={node.id} count={node.conversion.output} data={data} onSelect={onSelect}>{text.recipeOutput(number(node.conversion.output))}</MaterialButton></div>}
    </>}
  </li>
}

export function MaterialNeeds({ items, data, shortage = false }: { items: Record<string, number>; data: CultivationData; shortage?: boolean }) {
  const entries = Object.entries(items)
  return <div className="v2-project-materials" data-shortage={shortage}>
    <div className="v2-project-material-heading"><h4>{shortage ? text.materialShortage : text.requiredMaterials}</h4><span>{text.materialKinds(entries.length)}</span></div>
    <MaterialBrowser data={data}>{(select) => entries.length ? <><p className="v2-project-material-hint">{text.materialRouteHint}</p><ul className="v2-project-material-list">{entries.map(([id, count]) => <li key={id}><MaterialButton id={id} count={count} data={data} onSelect={select} /></li>)}</ul></> : <p className="v2-muted">{text.noShortage}</p>}</MaterialBrowser>
  </div>
}
