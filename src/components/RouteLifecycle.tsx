import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router'

type ScrollPosition = { x: number; y: number }
const MAX_SAVED_SCROLL_POSITIONS = 100

export default function RouteLifecycle() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const positionsRef = useRef(new Map<string, ScrollPosition>())

  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => {
      window.history.scrollRestoration = previous
    }
  }, [])

  useEffect(() => {
    const currentKey = location.key
    let focusObserver: MutationObserver | null = null

    const frame = window.requestAnimationFrame(() => {
      if (navigationType === 'POP') {
        const position = positionsRef.current.get(location.key)
        if (position) window.scrollTo(position.x, position.y)
      } else {
        window.scrollTo(0, 0)
      }

      if (!focusRouteTarget()) {
        focusObserver = new MutationObserver(() => {
          if (!focusRouteTarget()) return
          focusObserver?.disconnect()
          focusObserver = null
        })
        focusObserver.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true })
      }
    })

    return () => {
      window.cancelAnimationFrame(frame)
      focusObserver?.disconnect()
      rememberScrollPosition(positionsRef.current, currentKey, { x: window.scrollX, y: window.scrollY })
    }
  }, [location.key, navigationType])

  return null
}

function rememberScrollPosition(
  positions: Map<string, ScrollPosition>,
  key: string,
  position: ScrollPosition,
): void {
  positions.delete(key)
  positions.set(key, position)
  while (positions.size > MAX_SAVED_SCROLL_POSITIONS) {
    const oldestKey = positions.keys().next().value
    if (oldestKey === undefined) return
    positions.delete(oldestKey)
  }
}

function focusRouteTarget(): boolean {
  const focusTargets = document.querySelectorAll<HTMLElement>('[data-route-focus]:not([inert] [data-route-focus])')
  const focusTarget = focusTargets.item(focusTargets.length - 1)
  if (!focusTarget) return false
  focusTarget.focus({ preventScroll: true })
  return true
}
