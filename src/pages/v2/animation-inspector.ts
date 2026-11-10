const marker = '[data-animation-inspector]'
const properties = ['transform', 'translate', 'scale', 'rotate', 'opacity', 'width', 'height', 'left', 'top', 'outline-color']
let snapshotId = 0

type Snapshot = { node: Element; css: string; width: number; height: number; nested: boolean }
export type CapturedAnimation = {
  id: string
  name: string
  kind: 'native' | 'layout' | 'text'
  snapshot: Snapshot
  frames: Keyframe[]
  timing: KeyframeAnimationOptions
  duration: number
  texts?: { at: number; value: string }[]
}

type Sample = { at: number; frame: Keyframe; text: string }
type Track = { snapshot: Snapshot; started: number; samples: Sample[]; timer: number; text: boolean }

export function observePageAnimations(onCapture: (animation: CapturedAnimation) => void, onModal: (open: boolean) => void) {
  const seen = new WeakSet<Animation>()
  const tracks = new Map<Element, Track>()
  const original = Element.prototype.animate
  let active = true
  const eligible = (element: Element) => {
    const root = element.getRootNode()
    return element.isConnected && element !== document.body && element !== document.documentElement && !element.closest(`${marker}, [hidden], [data-route-pending]`)
      && !(root instanceof ShadowRoot && root.host.closest(marker))
  }
  function capture(animation: Animation) {
    const effect = animation.effect
    if (!active || seen.has(animation) || !(effect instanceof KeyframeEffect) || !effect.target || !eligible(effect.target)) return
    seen.add(animation)
    const duration = effect.getComputedTiming().duration
    if (typeof duration !== 'number' || duration <= 0 || !Number.isFinite(duration)) return
    const target = effect.target
    const name = animation instanceof CSSAnimation ? animation.animationName : animation instanceof CSSTransition ? animation.transitionProperty : label(target)
    const frames = effect.getKeyframes().map(({ computedOffset, ...frame }) => ({ ...frame, offset: frame.offset ?? computedOffset }))
    if (frames.length < 2) return
    const pseudo = effect.pseudoElement
    onCapture({ id: `native:${name}:${signature(target)}:${pseudo ?? ''}`, name, kind: 'native', snapshot: snapshot(target), frames, duration,
      timing: { ...effect.getTiming(), duration, iterations: 1, fill: 'both', ...(pseudo ? { pseudoElement: pseudo } : {}) } })
  }
  function instrument(this: Element, ...args: Parameters<Element['animate']>) {
    const animation = original.apply(this, args)
    capture(animation)
    return animation
  }
  if (typeof original === 'function') Element.prototype.animate = instrument
  const scan = (event?: Event) => {
    const target = event?.target
    const animations = target instanceof Element ? target.getAnimations?.({ subtree: true }) ?? [] : document.getAnimations?.() ?? []
    animations.forEach(capture)
  }
  const modal = () => onModal([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some((element) => !element.closest(marker)))
  function sample(element: Element, mutation: MutationRecord, text: boolean) {
    if (!eligible(element) || text && (element.children.length > 0 || !/\d/.test(element.textContent ?? ''))) return
    if (!text) {
      const previous = document.createElement('div').style
      previous.cssText = mutation.oldValue ?? ''
      const style = (element as HTMLElement | SVGElement).style
      if (!style) return
      const changed = properties.filter((property) => previous.getPropertyValue(property) !== style.getPropertyValue(property))
      if (!changed.length || nativeOwnsChange(element, changed)) return
    }
    const now = performance.now()
    const current = getComputedStyle(element)
    const frame = text ? {} : Object.fromEntries(properties.map((property) => [property, current.getPropertyValue(property)]))
    const value = element.textContent ?? ''
    let track = tracks.get(element)
    if (!track) {
      const before = { ...frame }
      if (!text) {
        const previous = document.createElement('div').style
        previous.cssText = mutation.oldValue ?? ''
        for (const property of properties) if (previous.getPropertyValue(property)) before[property] = previous.getPropertyValue(property)
      }
      const oldText = mutation.type === 'characterData' ? mutation.oldValue : [...mutation.removedNodes].map((node) => node.textContent).join('')
      track = { snapshot: snapshot(element, text), started: now, samples: [{ at: 0, frame: before, text: oldText ?? value }], timer: 0, text }
      tracks.set(element, track)
    }
    track.samples.push({ at: now - track.started, frame, text: value })
    window.clearTimeout(track.timer)
    track.timer = window.setTimeout(() => {
      tracks.delete(element)
      const duration = track.samples[track.samples.length - 1].at
      if (!active || track.samples.length < 3 || duration < 24) return
      const kind = track.text ? 'text' : 'layout'
      onCapture({ id: `${kind}:${signature(element)}`, name: label(element), kind, snapshot: track.snapshot, duration,
        frames: track.samples.map((sample) => ({ ...sample.frame, offset: sample.at / duration, easing: 'linear' })),
        timing: { duration, fill: 'both' }, ...(track.text ? { texts: track.samples.map((sample) => ({ at: sample.at, value: sample.text })) } : {}) })
    }, 180)
  }
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        if (mutation.attributeName === 'style') sample(mutation.target, mutation, false)
        else if (!mutation.target.closest(marker)) {
          modal()
          if (mutation.attributeName === 'hidden' || mutation.attributeName === 'data-route-pending') scan()
        }
      }
      else if (mutation.type === 'characterData' && mutation.target.parentElement) sample(mutation.target.parentElement, mutation, true)
      else if (mutation.type === 'childList' && mutation.target instanceof Element) {
        if ([...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element && !node.closest(marker))) modal()
        if ([...mutation.addedNodes, ...mutation.removedNodes].every((node) => node.nodeType === Node.TEXT_NODE)) sample(mutation.target, mutation, true)
      }
    }
  })
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'role', 'aria-modal', 'hidden', 'data-route-pending'], attributeOldValue: true, characterData: true, characterDataOldValue: true, childList: true })
  document.addEventListener('animationstart', scan, true)
  document.addEventListener('transitionrun', scan, true)
  scan(); modal()
  return () => {
    active = false
    observer.disconnect()
    document.removeEventListener('animationstart', scan, true)
    document.removeEventListener('transitionrun', scan, true)
    if (Element.prototype.animate === instrument) Element.prototype.animate = original
    for (const track of tracks.values()) window.clearTimeout(track.timer)
    tracks.clear()
  }
}

function nativeOwnsChange(element: Element, changed: string[]) {
  return element.getAnimations?.().some((animation) => {
    const effect = animation.effect
    return animation.playState === 'running' && effect instanceof KeyframeEffect && !effect.pseudoElement
      && effect.getKeyframes().some((frame) => changed.some((property) => property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) in frame))
  }) ?? false
}

function label(element: Element) {
  const named = element.closest('[aria-label], [title]')
  const name = named?.getAttribute('aria-label') || named?.getAttribute('title')
  const heading = element.closest('section, article, li, dl')?.querySelector('h2, h3, dt')?.textContent
  return (name && !/^[\d,.%/\s+−-]+$/.test(name) ? name : heading || signature(element)).slice(0, 80)
}

function signature(element: Element) {
  return `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 2).join('.') || element.parentElement?.classList.item(0) || 'element'}`
}

function snapshot(target: Element, numeric = false): Snapshot {
  const source = target instanceof SVGElement ? target.ownerSVGElement ?? target : numeric ? target.closest('.number-motion') ?? target : target
  const node = source.cloneNode(true) as HTMLElement | SVGElement
  const originals = [source, ...source.querySelectorAll('*')]
  const clones = [node, ...node.querySelectorAll('*')]
  const prefix = `v2-animation-snapshot-${++snapshotId}-`
  const ids = new Map(originals.filter((element) => element.id).map((element, index) => [element.id, `${prefix}${index}`]))
  const css: string[] = []
  originals.forEach((element, index) => {
    const clone = clones[index] as HTMLElement | SVGElement
    const style = getComputedStyle(element)
    if (clone.style) {
      clone.style.cssText = `${declarations(style)};animation:none;transition:none`
    }
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') for (const pseudo of ['::before', '::after']) {
      const computed = getComputedStyle(element, pseudo)
      if (!computed.content || computed.content === 'none' || computed.content === 'normal') continue
      clone.setAttribute('data-animation-snapshot-node', String(index))
      css.push(`[data-animation-snapshot-node="${index}"]${pseudo}{${declarations(computed)};animation:none!important;transition:none!important}`)
    }
    if (element.id) clone.id = ids.get(element.id)!
    for (const attribute of [...clone.attributes]) {
      const value = rewriteReferences(attribute.value, ids)
      if (value !== attribute.value) clone.setAttributeNS(attribute.namespaceURI, attribute.name, value)
    }
    clone.removeAttribute('autofocus')
    if (element === target) clone.setAttribute('data-animation-inspector-target', '')
  })
  node.querySelectorAll('script, style, link, iframe, audio, video').forEach((element) => element.remove())
  const bounds = source.getBoundingClientRect()
  const width = source instanceof HTMLElement ? source.offsetWidth || bounds.width : bounds.width
  const height = source instanceof HTMLElement ? source.offsetHeight || bounds.height : bounds.height
  node.style.position = 'absolute'
  node.style.margin = '0'
  node.style.left = '0'
  node.style.top = '0'
  node.style.boxSizing = 'border-box'
  node.style.width = `${width}px`
  node.style.height = `${height}px`
  return { node, css: rewriteReferences(css.join('\n'), ids), width, height, nested: source !== target }
}

function declarations(style: CSSStyleDeclaration) {
  return Array.from({ length: style.length }, (_, index) => `${style[index]}:${style.getPropertyValue(style[index])}`).join(';')
}

function rewriteReferences(value: string, ids: Map<string, string>) {
  return value.startsWith('#') && ids.has(value.slice(1)) ? `#${ids.get(value.slice(1))}`
    : value.replace(/url\((['"]?)(.*?)\1\)/g, (match, _quote: string, url: string) => {
      const id = ids.get(url.slice(url.lastIndexOf('#') + 1))
      return id ? `url("#${id}")` : match
    })
}

export function createAnimationPreview(record: CapturedAnimation, host: HTMLElement) {
  const clone = record.snapshot.node.cloneNode(true) as HTMLElement | SVGElement
  const target = clone.matches('[data-animation-inspector-target]') ? clone : clone.querySelector('[data-animation-inspector-target]')!
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const frame of record.snapshot.nested ? [{}] : record.frames) {
    const x = parseFloat(String(frame.left)) || 0, y = parseFloat(String(frame.top)) || 0
    const width = parseFloat(String(frame.width)) || record.snapshot.width, height = parseFloat(String(frame.height)) || record.snapshot.height
    let matrix = new DOMMatrix()
    try { if (typeof frame.transform === 'string' && frame.transform !== 'none') matrix = new DOMMatrix(frame.transform) } catch { /* Percent transforms retain their original clipping. */ }
    for (const [cx, cy] of [[0, 0], [width, 0], [0, height], [width, height]]) {
      const point = matrix.transformPoint({ x: cx, y: cy })
      left = Math.min(left, x + point.x); top = Math.min(top, y + point.y)
      right = Math.max(right, x + point.x); bottom = Math.max(bottom, y + point.y)
    }
  }
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top)
  const scene = document.createElement('div'), canvas = document.createElement('div')
  scene.className = 'v2-inspector-scene'
  function fit() {
    const scale = Math.max(.01, Math.min(1, (host.clientWidth - 32) / width, (host.clientHeight - 32) / height))
    scene.style.cssText = `position:relative;width:${width * scale}px;height:${height * scale}px`
    canvas.style.cssText = `position:absolute;transform:scale(${scale});transform-origin:0 0;left:${-left * scale}px;top:${-top * scale}px`
  }
  const isolation = document.createElement('div'), style = document.createElement('style')
  style.textContent = `:host,*{pointer-events:none!important}${record.snapshot.css}`
  const shadow = isolation.attachShadow({ mode: 'open' })
  canvas.append(clone); scene.append(canvas); shadow.append(style, scene); host.replaceChildren(isolation); fit()
  return { target, animation: target.animate(record.frames, record.timing), fit }
}
