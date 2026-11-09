import { useLayoutEffect, useRef } from 'react'
import { useAppReducedMotion } from './motion-preference'
import './list-reveal.css'

export function useListReveal(enabled = true, stagger = 25) {
  const container = useRef<HTMLDivElement>(null)
  const seen = useRef(new Set<string>())
  const reduced = useAppReducedMotion()
  useLayoutEffect(() => {
    const element = container.current
    if (!element || reduced || typeof IntersectionObserver === 'undefined') return
    const scroll = element.closest<HTMLElement>('.v2-drawer-body')
    const animations = new Map<Element, Animation>()
    const observed = new Set<Element>()
    let previousTop = scroll?.scrollTop ?? window.scrollY
    let fastUntil = 0
    const onScroll = () => {
      const top = scroll?.scrollTop ?? window.scrollY
      if (Math.abs(top - previousTop) > (scroll?.clientHeight ?? window.innerHeight) * 0.8) fastUntil = performance.now() + 180
      previousTop = top
    }
    const observer = new IntersectionObserver((entries) => {
      let order = 0
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const row = entry.target as HTMLElement
        observer.unobserve(row)
        const wasSeen = seen.current.has(row.dataset.revealId!)
        seen.current.add(row.dataset.revealId!)
        if (!wasSeen && enabled && performance.now() >= fastUntil && !row.contains(document.activeElement)) {
          const content = row.querySelector<HTMLElement>('[data-reveal-content]') ?? row
          const animation = content.animate([
            { opacity: 0.35, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' },
          ], { duration: 240, delay: Math.min(order++, 7) * stagger, fill: 'backwards', easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
          animations.set(row, animation)
          animation.onfinish = () => animations.delete(row)
        }
        row.removeAttribute('data-reveal-pending')
      }
    }, { root: scroll, threshold: 0.05 })
    const scan = () => {
      for (const row of element.querySelectorAll<HTMLElement>('[data-reveal-id]')) {
        if (seen.current.has(row.dataset.revealId!) || observed.has(row)) continue
        if (!enabled || typeof row.animate !== 'function' || row.contains(document.activeElement)) { seen.current.add(row.dataset.revealId!); continue }
        row.setAttribute('data-reveal-pending', '')
        observed.add(row)
        observer.observe(row)
      }
      for (const row of observed) if (!element.contains(row)) { row.removeAttribute('data-reveal-pending'); observer.unobserve(row); observed.delete(row); animations.get(row)?.cancel(); animations.delete(row) }
    }
    const focus = (event: FocusEvent) => {
      const row = (event.target as Element).closest('[data-reveal-id]')
      if (row) { row.removeAttribute('data-reveal-pending'); seen.current.add((row as HTMLElement).dataset.revealId!); observer.unobserve(row); animations.get(row)?.cancel(); animations.delete(row) }
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
      for (const row of observed) row.removeAttribute('data-reveal-pending')
      for (const animation of animations.values()) animation.cancel()
    }
  }, [enabled, reduced, stagger])
  return container
}
