import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router'
import { CloseIcon, PreviewIcon } from '../../components/icons'
import { copy } from '../../copy'
import { createAnimationPreview, observePageAnimations, type CapturedAnimation } from './animation-inspector'
import { useAdminPreviewSession } from './useAdminPreviewSession'
import './animation-inspector.css'

const text = copy.v2.animationInspector

export default function AnimationInspector() {
  const authorized = useAdminPreviewSession()
  return authorized ? <Inspector /> : null
}

function Inspector() {
  const location = useLocation()
  const page = location.pathname + location.search
  const speedLabel = useId()
  const [records, setRecords] = useState<CapturedAnimation[]>([])
  const [expanded, setExpanded] = useState(false)
  const [modal, setModal] = useState(false)
  const [selected, setSelected] = useState<{ record: CapturedAnimation; run: number } | null>(null)
  const [rate, setRate] = useState(1)
  const trigger = useRef<HTMLButtonElement>(null)
  const wasExpanded = useRef(false)
  useLayoutEffect(() => {
    if (wasExpanded.current && !expanded) trigger.current?.focus({ preventScroll: true })
    wasExpanded.current = expanded
  }, [expanded])
  useEffect(() => {
    setRecords([])
    setSelected(null)
    return observePageAnimations((record) => {
      // shortcut: retain the latest 24 effects per page; expand only if longer inspection histories are needed.
      setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)].slice(0, 24))
    }, setModal)
  }, [page])
  function collapse() {
    setExpanded(false)
    setSelected(null)
  }
  return createPortal(<aside className={`v2-dialog v2-animation-inspector ${expanded ? 'is-expanded' : ''} ${selected ? 'has-preview' : ''}`}
    data-animation-inspector="" hidden={modal} aria-label={text.title} onKeyDown={(event) => {
      if (event.key === 'Escape' && expanded) { event.stopPropagation(); collapse() }
    }}>
    <button ref={trigger} className="v2-button v2-button-secondary v2-inspector-trigger" type="button" aria-expanded={expanded} aria-controls={expanded ? 'v2-animation-inspector-panel' : undefined} onClick={() => expanded ? collapse() : setExpanded(true)}>
      <PreviewIcon size={18} aria-hidden="true" /><span>{text.title}</span><span className="v2-inspector-count">{records.length}</span>
    </button>
    {expanded && <div id="v2-animation-inspector-panel" className="v2-inspector-panel">
      <header><div><h2>{text.title}</h2><p>{records.length ? text.detected(records.length) : text.empty}</p></div><button className="v2-icon-button" type="button" aria-label={text.collapse} onClick={collapse}><CloseIcon size={18} aria-hidden="true" /></button></header>
      <label className="v2-inspector-speed"><span id={speedLabel}>{text.speed}</span><select aria-labelledby={speedLabel} className="v2-input" value={rate} onChange={(event) => setRate(Number(event.target.value))}>
        {[0.1, 0.25, 0.5, 1, 2, 4].map((value) => <option key={value} value={value}>{value}×</option>)}
      </select></label>
      <ul className="v2-inspector-list">{records.map((record) => <li key={record.id}>
        <div><strong>{record.name}</strong><small>{text.kinds[record.kind]} · {(record.duration / 1000).toFixed(2)}s</small></div>
        <button className="v2-button v2-button-secondary" type="button" aria-label={text.playNamed(record.name)} aria-pressed={selected?.record.id === record.id} onClick={() => setSelected((current) => ({ record, run: (current?.run ?? 0) + 1 }))}>{text.play}</button>
      </li>)}</ul>
      {selected && <Preview key={selected.run} record={selected.record} rate={rate} />}
      <p className="v2-inspector-hint">{text.hint}</p>
    </div>}
  </aside>, document.body)
}

function Preview({ record, rate }: { record: CapturedAnimation; rate: number }) {
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<ReturnType<typeof createAnimationPreview> | null>(null)
  const ticker = useRef<number | null>(null)
  const [paused, setPaused] = useState(false)
  const [finished, setFinished] = useState(false)
  const [run, setRun] = useState(0)
  const [error, setError] = useState(false)
  useLayoutEffect(() => {
    if (!host.current) return
    try {
      const current = createAnimationPreview(record, host.current)
      player.current = current
      setPaused(false); setFinished(false); setError(false)
      current.animation.onfinish = () => { setFinished(true); if (record.texts) current.target.textContent = record.texts[record.texts.length - 1].value }
      const resize = new ResizeObserver(current.fit)
      resize.observe(host.current)
      return () => { resize.disconnect(); current.animation.onfinish = null; current.animation.cancel(); player.current = null }
    } catch { setError(true) }
  }, [record, run])
  useLayoutEffect(() => { player.current?.animation.updatePlaybackRate(rate) }, [rate, record, run])
  useEffect(() => {
    const current = player.current
    if (!current || !record.texts || paused || finished) return
    const update = () => {
      const at = Number(current.animation.currentTime ?? 0)
      let sample = record.texts![0]
      for (const next of record.texts!) { if (next.at > at) break; sample = next }
      current.target.textContent = sample.value
      ticker.current = requestAnimationFrame(update)
    }
    update()
    return () => { if (ticker.current !== null) cancelAnimationFrame(ticker.current) }
  }, [record, run, paused, finished])
  function pause() {
    if (!player.current) return
    if (paused) player.current.animation.play()
    else player.current.animation.pause()
    setPaused(!paused)
  }
  return <section className="v2-inspector-preview" aria-label={text.preview}>
    <header><h3>{text.preview}</h3><div>
      <button type="button" className="v2-text-button" disabled={error || finished} onClick={pause}>{paused ? text.resume : text.pause}</button>
      <button type="button" className="v2-text-button" disabled={error} onClick={() => setRun((value) => value + 1)}>{text.replay}</button>
    </div></header>
    <div ref={host} className="v2-inspector-stage" aria-hidden="true" inert />
    {error ? <p role="alert">{text.unavailable}</p> : <p className="v2-inspector-play-state" role="status">{finished ? text.finished : paused ? text.paused : text.playing(rate)}</p>}
  </section>
}
