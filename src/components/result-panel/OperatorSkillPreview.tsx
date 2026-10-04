import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover'
import { copy } from '../../copy/index'
import { operatorBuildingSkills } from './building-skills'
import { ROOM_LABELS } from './labels'

export default function OperatorSkillPreview({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const id = useId()
  const label = copy.domain.building_skills
  const cancel = () => clearTimeout(timer.current)
  const close = () => { cancel(); setTarget(null) }
  const findTile = (node: EventTarget | null, fromFocus = false) => {
    if (!(node instanceof Element)) return null
    const tile = node.closest<HTMLElement>('[data-operator-name]')
    if (tile || !fromFocus) return tile
    const tiles = node.closest('button')?.querySelectorAll<HTMLElement>('[data-operator-name]')
    return tiles?.length === 1 ? tiles[0] : null
  }
  const preview = (element: EventTarget | null, { fromFocus = false, keepFocus = false } = {}) => {
    if (element instanceof Element && element.closest('[data-skill-preview]')) { cancel(); return }
    const tile = findTile(element, fromFocus) ?? (keepFocus ? findTile(document.activeElement, true) : null)
    cancel()
    if (!tile) { timer.current = setTimeout(() => setTarget(null), 100); return }
    if (tile === target) return
    timer.current = setTimeout(() => {
      if (!tile.isConnected || tile.closest('[aria-hidden="true"]')) return
      anchor.current = tile
      setTarget(tile)
    }, 180)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!target) return
    const described = target.closest('button') ?? target
    const previous = described.getAttribute('aria-describedby')
    described.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '))
    return () => {
      if (previous === null) described.removeAttribute('aria-describedby')
      else described.setAttribute('aria-describedby', previous)
    }
  }, [target, id])
  const skills = target ? operatorBuildingSkills({
    id: target.dataset.operatorId, name: target.dataset.operatorName ?? '',
    elite: target.dataset.operatorElite === undefined ? undefined : Number(target.dataset.operatorElite),
    level: target.dataset.operatorLevel === undefined ? undefined : Number(target.dataset.operatorLevel),
  }) : []

  return (
    <div className="contents" onPointerOver={(event) => {
      if (event.pointerType !== 'touch') preview(event.target)
    }} onPointerOut={(event) => { if (event.pointerType !== 'touch') preview(event.relatedTarget, { keepFocus: true }) }} onPointerDownCapture={close} onFocusCapture={(event) => preview(event.target, { fromFocus: true })}
      onBlurCapture={(event) => preview(event.relatedTarget, { fromFocus: true })}>
      {children}
      <Popover open={skills.length > 0} onOpenChange={(open) => { if (!open) close() }}>
        <PopoverAnchor virtualRef={anchor} />
        <PopoverContent id={id} role="tooltip" data-skill-preview side="top" align="center"
          className="z-[90] max-h-[65dvh] w-80 overflow-y-auto text-xs"
          onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={cancel} onPointerLeave={() => { timer.current = setTimeout(() => setTarget(null), 100) }}>
          <p className="font-semibold text-ink-primary">{target?.dataset.operatorName} · {label.title}</p>
          {skills.map((skill) => (
            <div key={skill.id} className={`border-t border-surface-3 pt-2 ${skill.state === 'upgraded' ? 'opacity-55' : ''}`}>
              <div className="flex items-center gap-2">
                <img src={`/building-skills/${skill.icon}.png`} alt="" width={32} height={32}
                  className="h-8 w-8 shrink-0 rounded-md bg-slate-800 p-1" />
                <div className="min-w-0">
                  <p className="font-semibold text-ink-primary">{skill.name}</p>
                  <p className="text-ink-muted">{ROOM_LABELS[skill.room] ?? label.training} · {label.unlock(skill.elite, skill.level)}
                    {skill.state !== 'unknown' && <span className={skill.state === 'active' ? 'text-success' : 'text-ink-muted'}> · {label[skill.state as 'active' | 'locked' | 'upgraded']}</span>}
                  </p>
                </div>
              </div>
              <p className="mt-1.5 whitespace-pre-line leading-5">{skill.description}</p>
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}
