import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LayoutGroup, motion } from 'motion/react'
import { CollapsedIcon, ExperienceIcon, LmdIcon, MaterialIcon, NextIcon } from '../../../components/icons'
import { motionTokens } from '../../../components/MotionPrimitives'
import { TweenValue } from '../../../components/NumberMotion'
import SharedCardDialog from '../../../components/ui/shared-card-dialog'
import { DialogDescription, DialogTitle } from '../../../components/ui/dialog'
import { copy } from '../../../copy'
import type { CultivationData } from '../../../lib/cultivation-contract'
import { buildMaterialGraph, isMaterialFee, type MaterialGraphNode } from '../../../lib/cultivation-materials'
import { useAppReducedMotion } from '../../../lib/motion-preference'
import itemIcons from '../../../data/cultivation-item-icons.json'
import './project-materials.css'

const text = copy.cultivationProjects
const number = (amount: number) => amount.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
const requiredAmount = (amount: number) => text.requiredAmount(number(amount))
type SelectMaterial = (id: string, count: number, button: HTMLButtonElement) => void
type Selection = { id: string; count: number; source: string }

function ResourceArt({ id, data, shared }: { id: string; data: CultivationData; shared?: string }) {
  const reduced = useAppReducedMotion()
  const itemId = id === 'exp' ? '2004' : id
  const icon = data.itemIcons?.[itemId] || (itemIcons as Record<string, string>)[itemId]
  const Icon = id === 'exp' ? ExperienceIcon : id === '4001' ? LmdIcon : MaterialIcon
  return <motion.span layoutId={reduced ? undefined : shared} transition={motionTokens.morph} className="v2-project-resource-art" data-resource={id === 'exp' || id === '4001' ? id : 'material'} aria-hidden="true">
    <Icon size={22} />
    {icon && <img src={`/item-icons/${encodeURIComponent(icon)}.png`} alt="" width={40} height={40} loading="lazy" onError={(event) => { event.currentTarget.hidden = true }} />}
  </motion.span>
}

export function MaterialButton({ id, count, data, onSelect, children, className = '' }: { id: string; count: number; data: CultivationData; onSelect: SelectMaterial; children?: ReactNode; className?: string }) {
  const key = useId()
  const reduced = useAppReducedMotion()
  return <motion.button type="button" className={`v2-project-material-button ${className}`} data-material-id={id} data-material-key={key} title={data.itemNames[id] ?? id} aria-label={text.viewMaterial(data.itemNames[id] ?? id)} aria-haspopup="dialog"
    layoutId={reduced ? undefined : `material-${key}`} transition={motionTokens.morph} style={{ borderRadius: 6 }} onClick={(event) => onSelect(id, count, event.currentTarget)}>
    <ResourceArt id={id} data={data} shared={`material-art-${key}`} /><span><motion.span layoutId={reduced ? undefined : `material-name-${key}`} transition={motionTokens.morph}>{data.itemNames[id] ?? id}</motion.span><strong>{children ?? <TweenValue value={count} format={requiredAmount} />}</strong></span><CollapsedIcon size={14} aria-hidden="true" />
  </motion.button>
}

export function MaterialFeeNotes({ items, data }: { items: Record<string, number>; data: CultivationData }) {
  return <div className="v2-project-material-fees">{Object.entries(items).filter(([id]) => isMaterialFee(id)).map(([id, count]) => <span key={id}>
    <ResourceArt id={id} data={data} /><span>{data.itemNames[id] ?? id} × {number(count)}</span>{id === '4006' && data.farms[id]?.[0] && <small>{text.farmSource(data.farms[id][0].stage)}</small>}
  </span>)}</div>
}

export function MaterialBrowser({ data, children }: { data: CultivationData; children: (select: SelectMaterial) => ReactNode }) {
  const group = useId()
  const [selected, setSelected] = useState<Selection | null>(null)
  const select: SelectMaterial = (id, count, button) => {
    if (selected) setSelected({ ...selected, id, count })
    else {
      button.focus({ preventScroll: true })
      setSelected({ id, count, source: button.dataset.materialKey! })
    }
  }
  return <LayoutGroup id={group}>
    <div className="v2-project-material-browser">{children(select)}</div>
    {selected && <SharedCardDialog layoutId={`material-${selected.source}`} onClose={() => setSelected(null)} closeLabel={copy.v2.close} className="v2-project-material-dialog">
      <MaterialRoute selection={selected} data={data} onSelect={select} />
    </SharedCardDialog>}
  </LayoutGroup>
}

function MaterialRoute({ selection: { id, count, source }, data, onSelect }: { selection: Selection; data: CultivationData; onSelect: SelectMaterial }) {
  const reduced = useAppReducedMotion()
  const graph = useMemo(() => buildMaterialGraph(id, count, data), [id, count, data])
  return <>
    <header className="v2-project-route-heading">
      <ResourceArt id={id} data={data} shared={`material-art-${source}`} />
      <div><DialogTitle asChild><h2 aria-label={text.materialRoute(data.itemNames[id] ?? id)}><motion.span layoutId={reduced ? undefined : `material-name-${source}`} transition={motionTokens.morph}>{data.itemNames[id] ?? id}</motion.span><small>{text.routeLabel}</small></h2></DialogTitle>
        <p>{text.requiredAmount(number(count))}</p></div>
      <DialogDescription>{text.recipeHint}</DialogDescription>
    </header>
    <div className="v2-project-route-direction"><span>{text.lowTier}</span><NextIcon size={16} aria-hidden="true" /><span>{text.highTier}</span><small>{text.routeScrollHint}</small></div>
    <MaterialGraph key={`${id}:${count}`} graph={graph} data={data} onSelect={onSelect} />
    {!graph.nodes.some((node) => node.kind === 'product') && <p className="v2-project-route-empty">{text.noProducts}</p>}
  </>
}

function MaterialGraph({ graph, data, onSelect }: { graph: ReturnType<typeof buildMaterialGraph>; data: CultivationData; onSelect: SelectMaterial }) {
  const reduced = useAppReducedMotion()
  const marker = useId()
  const canvas = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const [paths, setPaths] = useState<Array<{ key: string; d: string }>>([])
  const columns = Array.from({ length: Math.max(...graph.nodes.map((node) => node.column)) + 1 }, (_, column) => graph.nodes.filter((node) => node.column === column))
  useLayoutEffect(() => {
    const element = canvas.current!
    const measure = () => {
      // Layout offsets keep connectors aligned while the dialog morphs from its source.
      const positions = new Map(Array.from(element.querySelectorAll<HTMLElement>('[data-route-node]')).map((node) => {
        const button = node.querySelector('button')!
        let left = 0, top = 0
        for (let parent: HTMLElement | null = button; parent && parent !== element; parent = parent.offsetParent as HTMLElement | null) {
          left += parent.offsetLeft
          top += parent.offsetTop
        }
        return [node.dataset.routeNode, { left, top, width: button.offsetWidth, height: button.offsetHeight }] as const
      }))
      const selected = element.querySelector<HTMLElement>('[data-kind="selected"]')!
      if (scroll.current) scroll.current.scrollLeft = Math.max(0, selected.offsetLeft - scroll.current.clientWidth / 2 + selected.offsetWidth / 2)
      setPaths(graph.edges.map((edge) => {
        const from = positions.get(edge.from)!, to = positions.get(edge.to)!
        const x1 = from.left + from.width, y1 = from.top + from.height / 2
        const x2 = to.left, y2 = to.top + to.height / 2
        const middle = (x1 + x2) / 2
        return { key: `${edge.from}:${edge.to}`, d: `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}` }
      }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(scroll.current!)
    return () => observer.disconnect()
  }, [graph])
  return <div ref={scroll} className="v2-project-route-scroll" role="region" aria-label={text.routeDiagram} tabIndex={0}>
    <motion.div ref={canvas} className="v2-project-route-graph" initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.18 }}>
      <svg className="v2-project-route-lines" aria-hidden="true"><defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 1 1 L 7 4 L 1 7" /></marker></defs>
        {paths.map((path) => <motion.path key={path.key} d={path.d} markerEnd={`url(#${marker})`} initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduced ? 0 : 0.28, ease: motionTokens.ease.enter }} />)}
      </svg>
      {columns.map((nodes, column) => <div className="v2-project-route-column" key={column}>{nodes.map((node) => <MaterialNode key={node.key} node={node} hasInputs={graph.edges.some((edge) => edge.to === node.key)} data={data} onSelect={onSelect} />)}</div>)}
    </motion.div>
  </div>
}

function MaterialNode({ node, hasInputs, data, onSelect }: { node: MaterialGraphNode; hasInputs: boolean; data: CultivationData; onSelect: SelectMaterial }) {
  const farm = data.farms[node.id]?.[0]
  return <article className="v2-project-route-node" data-route-node={node.key} data-kind={node.kind}>
    <MaterialButton id={node.id} count={node.count} data={data} onSelect={onSelect}>{node.kind === 'product' ? text.recipeOutput(number(node.count)) : text.requiredAmount(number(node.count))}</MaterialButton>
    {node.kind === 'selected' && <span className="v2-project-route-selected">{text.currentMaterial}</span>}
    {node.kind === 'product' && <div className="v2-project-route-inputs"><span>{text.eachRecipe}</span>{Object.entries(node.extra).map(([id, count]) => <MaterialButton key={id} id={id} count={count} data={data} onSelect={onSelect} />)}</div>}
    <MaterialFeeNotes items={node.fees} data={data} />
    {node.cycle ? <p className="v2-project-route-source">{text.cycleRecipe}</p> : !hasInputs && node.kind !== 'product' && !Object.keys(node.fees).length && <p className="v2-project-route-source">{isMaterialFee(node.id) ? text.baseSource : farm ? text.farmSource(farm.stage) : text.noFarm}</p>}
    {node.conversion && <div className="v2-project-route-conversion"><span>{text.exchange}</span><MaterialButton id={node.conversion.id} count={node.conversion.count} data={data} onSelect={onSelect} /><NextIcon size={14} aria-hidden="true" /><span>{text.recipeOutput(number(node.conversion.output))}</span></div>}
  </article>
}

export function MaterialNeeds({ items, data, shortage = false }: { items: Record<string, number>; data: CultivationData; shortage?: boolean }) {
  const entries = Object.entries(items)
  return <div className="v2-project-materials" data-shortage={shortage}>
    <div className="v2-project-material-heading"><h4>{shortage ? text.materialShortage : text.requiredMaterials}</h4><span>{text.materialKinds(entries.length)}</span></div>
    <MaterialBrowser data={data}>{(select) => entries.length ? <><p className="v2-project-material-hint">{text.materialRouteHint}</p><ul className="v2-project-material-list">{entries.map(([id, count]) => <li key={id}><MaterialButton id={id} count={count} data={data} onSelect={select} /></li>)}</ul></> : <p className="v2-muted">{text.noShortage}</p>}</MaterialBrowser>
  </div>
}
