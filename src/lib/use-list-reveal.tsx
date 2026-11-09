import { useEffect, useRef } from 'react'
import { useAppReducedMotion } from './motion-preference'

export function useListReveal(enabled = true) {
  const container = useRef<HTMLDivElement>(null)
  const seen = useRef(new Set<string>())
  const reduced = useAppReducedMotion()
  useEffect(() => {
    const element = container.current
    if (!element || reduced || typeof IntersectionObserver === 'undefined') return
    const scroll = element.closest<HTMLElement>('.v2-drawer-body')
    const animations = new Map<Element, Animation>()
    const observed = new Set<Element>()
    let previousTop = scroll?.scrollTop ?? window.scrollY
    let fastUntil = 0
    const onScroll = () => {
      const top = scroll?.scrollTop ?? window.scrollY
      if (Math.abs(top - previousTop) > 80) fastUntil = performance.now() + 180
      previousTop = top
    }
    const observer = new IntersectionObserver((entries) => {
      let order = 0
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const row = entry.target as HTMLElement
        observer.unobserve(row)
        seen.current.add(row.dataset.revealId!)
        if (!enabled || performance.now() < fastUntil || row.contains(document.activeElement)) continue
        const content = row.querySelector<HTMLElement>('[data-reveal-content]') ?? row
        const animation = content.animate([
          { opacity: 0.55, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 180, delay: Math.min(order++, 5) * 25, fill: 'backwards', easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
        animations.set(row, animation)
        animation.onfinish = () => animations.delete(row)
      }
    }, { root: scroll, threshold: 0.05 })
    const scan = () => {
      for (const row of element.querySelectorAll<HTMLElement>('[data-reveal-id]')) {
        if (seen.current.has(row.dataset.revealId!) || observed.has(row)) continue
        if (!enabled || typeof row.animate !== 'function') { seen.current.add(row.dataset.revealId!); continue }
        observed.add(row)
        observer.observe(row)
      }
      for (const row of observed) if (!element.contains(row)) { observer.unobserve(row); observed.delete(row); animations.get(row)?.cancel(); animations.delete(row) }
    }
    const focus = (event: FocusEvent) => {
      const row = (event.target as Element).closest('[data-reveal-id]')
      if (row) { animations.get(row)?.cancel(); animations.delete(row) }
    }
    scan()
    const mutations = new MutationObserver(scan)
    mutations.observe(element, { childList: true, subtree: true })
    const scrollTarget = scroll ?? window
    scrollTarget.addEventListener('scroll', onScroll, { passive: true })
    element.addEventListener('focusin', focus)
    return () => {
      mutations.disconnect(); observer.disconnect()
      scrollTarget.removeEventListener('scroll', onScroll)
      element.removeEventListener('focusin', focus)
      for (const animation of animations.values()) animation.cancel()
    }
  }, [enabled, reduced])
  return container
}
