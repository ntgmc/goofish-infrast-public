import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

type ScrollPosition = { x: number; y: number }

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
      positionsRef.current.set(currentKey, { x: window.scrollX, y: window.scrollY })
    }
  }, [location.key, navigationType])

  return null
}

function focusRouteTarget(): boolean {
  const focusTarget = document.querySelector<HTMLElement>('[data-route-focus]')
  if (!focusTarget) return false
  focusTarget.focus({ preventScroll: true })
  return true
}
