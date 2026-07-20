import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { copy } from '../copy/index'

const STORAGE_PREFIX = 'maatool:guided-tour:'
const fallbackCompletedTours = new Set<string>()

type TourStep = {
  target: string
  title: string
  body: string
  onEnter?: () => void
  skipIfMissing?: boolean
}

export type TourDefinition = {
  id: string
  version: number
  steps: TourStep[]
}

export function tourStorageKey(id: string, version: number) {
  return `${STORAGE_PREFIX}${id}:v${version}`
}

export function hasCompletedTour(id: string, version: number) {
  const key = tourStorageKey(id, version)
  if (fallbackCompletedTours.has(key)) return true
  try {
    return window.localStorage.getItem(key) === 'done'
  } catch {
    return false
  }
}

function rememberCompletedTour(id: string, version: number) {
  const key = tourStorageKey(id, version)
  fallbackCompletedTours.add(key)
  try {
    window.localStorage.setItem(key, 'done')
  } catch {
    // The in-memory fallback prevents repeated prompts for this browser session.
  }
}

export function useFirstRunTour({
  id,
  version,
  autoStart = true,
}: {
  id: string
  version: number
  autoStart?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [completed, setCompleted] = useState(() => hasCompletedTour(id, version))
  const autoStartedRef = useRef(false)

  useEffect(() => {
    if (!autoStart || completed || autoStartedRef.current) return
    autoStartedRef.current = true
    setOpen(true)
  }, [autoStart, completed])

  const start = useCallback(() => setOpen(true), [])
  const closeAndRemember = useCallback(() => {
    rememberCompletedTour(id, version)
    setCompleted(true)
    setOpen(false)
  }, [id, version])

  return {
    open,
    completed,
    start,
    finish: closeAndRemember,
    skip: closeAndRemember,
  }
}

export default function GuidedTour({
  definition,
  open,
  onFinish,
  onSkip,
}: {
  definition: TourDefinition
  open: boolean
  onFinish: () => void
  onSkip: () => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const activeStep = definition.steps[activeIndex]
  const isLast = activeIndex === definition.steps.length - 1

  useEffect(() => {
    if (!open) return
    setActiveIndex(0)
  }, [open, definition.id])

  useEffect(() => {
    if (!open || !activeStep) return
    activeStep.onEnter?.()
    setTargetRect(null)

    let cancelled = false
    let attempts = 0
    let retryTimer = 0
    let settleTimer = 0

    const measure = () => {
      if (cancelled) return
      const target = findVisibleTourTarget(activeStep.target)
      if (!target) {
        attempts += 1
        if (attempts < 24) {
          retryTimer = window.setTimeout(measure, 50)
          return
        }
        if (activeStep.skipIfMissing !== false) {
          if (isLast) onFinish()
          else setActiveIndex((index) => Math.min(index + 1, definition.steps.length - 1))
        }
        return
      }

      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' })
      setTargetRect(target.getBoundingClientRect())
      settleTimer = window.setTimeout(() => {
        if (!cancelled && target.isConnected) setTargetRect(target.getBoundingClientRect())
      }, reducedMotion ? 0 : 280)
    }

    const update = () => {
      const target = findVisibleTourTarget(activeStep.target)
      if (target) setTargetRect(target.getBoundingClientRect())
    }

    measure()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelled = true
      window.clearTimeout(retryTimer)
      window.clearTimeout(settleTimer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [activeStep, definition.steps.length, isLast, onFinish, open])

  const paddedRect = useMemo(() => padTargetRect(targetRect), [targetRect])
  const panelStyle = useMemo(() => getPanelStyle(paddedRect), [paddedRect])

  if (!activeStep || definition.steps.length === 0) return null

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onSkip() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-transparent" />
        {paddedRect ? (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[91] rounded-xl ring-2 ring-brand-400"
            style={{
              top: paddedRect.top,
              left: paddedRect.left,
              width: paddedRect.width,
              height: paddedRect.height,
              boxShadow: '0 0 0 9999px var(--tour-scrim)',
            }}
          />
        ) : (
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[91]" style={{ background: 'var(--tour-scrim)' }} />
        )}
        <Dialog.Content
          ref={contentRef}
          aria-describedby="guided-tour-description"
          className="fixed z-[92] max-h-[min(70dvh,420px)] w-[calc(100vw-2rem)] max-w-sm overflow-y-auto rounded-xl border border-surface-3 bg-surface-1 p-5 shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 sm:p-6"
          style={panelStyle}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            contentRef.current?.focus()
          }}
          tabIndex={-1}
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-sm font-semibold tabular-nums text-brand-400">
              {activeIndex + 1} / {definition.steps.length}
            </p>
            <button type="button" onClick={onSkip} className="tool-secondary-action min-h-9 px-3 py-1.5 text-xs">
              {copy.common.components_GuidedTour_001}
            </button>
          </div>
          <Dialog.Title className="text-lg font-semibold text-ink-primary">{activeStep.title}</Dialog.Title>
          <Dialog.Description id="guided-tour-description" className="mt-2 text-sm leading-6 text-ink-secondary">
            {activeStep.body}
          </Dialog.Description>
          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
              disabled={activeIndex === 0}
              className="tool-secondary-action disabled:pointer-events-none disabled:opacity-45"
            >
              {copy.common.components_GuidedTour_002}
            </button>
            <button
              type="button"
              onClick={() => {
                if (isLast) onFinish()
                else setActiveIndex((index) => Math.min(definition.steps.length - 1, index + 1))
              }}
              className="tool-primary-action"
            >
              {isLast ? copy.common.components_GuidedTour_004 : copy.common.components_GuidedTour_003}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function findVisibleTourTarget(target: string) {
  const candidates = document.querySelectorAll<HTMLElement>(`[data-tour-target="${target}"]`)
  return Array.from(candidates).find((candidate) => {
    const rect = candidate.getBoundingClientRect()
    const style = window.getComputedStyle(candidate)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  }) ?? null
}

function padTargetRect(rect: DOMRect | null) {
  if (!rect || typeof window === 'undefined') return null
  const padding = 8
  const left = Math.max(8, rect.left - padding)
  const top = Math.max(8, rect.top - padding)
  return {
    left,
    top,
    width: Math.min(window.innerWidth - left - 8, rect.width + padding * 2),
    height: Math.min(window.innerHeight - top - 8, rect.height + padding * 2),
  }
}

function getPanelStyle(rect: ReturnType<typeof padTargetRect>): React.CSSProperties {
  if (typeof window === 'undefined') return {}
  const margin = 16
  const panelWidth = Math.min(384, window.innerWidth - margin * 2)
  const estimatedHeight = 280
  if (!rect || window.innerWidth < 640) {
    return { left: margin, bottom: margin, width: panelWidth }
  }

  const below = rect.top + rect.height + margin
  if (below + estimatedHeight <= window.innerHeight - margin) {
    return { left: Math.min(Math.max(margin, rect.left), window.innerWidth - panelWidth - margin), top: below, width: panelWidth }
  }
  return {
    left: Math.min(Math.max(margin, rect.left), window.innerWidth - panelWidth - margin),
    top: Math.max(margin, rect.top - estimatedHeight - margin),
    width: panelWidth,
  }
}
