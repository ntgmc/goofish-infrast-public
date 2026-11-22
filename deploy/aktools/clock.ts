import { valueClockCopy as text } from '../../src/copy/zh-CN/value-clock'
import { projectValueClock, valueClockSnapshotSchema, type ValueClockSnapshot } from '../../src/lib/value-clock'

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const format = (value: number | undefined, decimals = 2) => value === undefined ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
const compact = (value: number | undefined) => value === undefined ? '—' : Math.abs(value) >= 1e8 ? `${format(value / 1e8)} 亿` : Math.abs(value) >= 1e4 ? `${format(value / 1e4)} 万` : format(value)
const theme = matchMedia('(prefers-color-scheme: dark)')
let previousInteger: string | undefined
const renderInteger = (value: string) => {
  const oldValue = previousInteger
  const changed: HTMLElement[] = []
  const integer = element('integer')
  const fragment = document.createDocumentFragment()
  Array.from(value).forEach((character, index) => {
    if (/\d/.test(character)) {
      const slot = document.createElement('span')
      slot.className = 'value-clock-digit'
      slot.style.setProperty('--value-clock-digit-index', String(index))
      const glyph = document.createElement('span')
      glyph.className = 'value-clock-digit-glyph'
      glyph.textContent = character
      slot.append(glyph)
      fragment.append(slot)
      if (oldValue && oldValue[index] !== character && !matchMedia('(prefers-reduced-motion: reduce)').matches) changed.push(glyph)
    } else {
      const separator = document.createElement('span')
      separator.textContent = character
      fragment.append(separator)
    }
  })
  integer.style.setProperty('--value-clock-characters', String(value.length))
  integer.replaceChildren(fragment)
  for (const glyph of changed) glyph.animate?.([
    { opacity: .7, transform: 'translateY(.03em)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], { duration: 220, easing: 'cubic-bezier(.2, 0, .2, 1)' })
  previousInteger = value
}
const applyTheme = () => {
  document.documentElement.classList.toggle('dark', theme.matches)
  document.documentElement.style.colorScheme = theme.matches ? 'dark' : 'light'
}
applyTheme()
theme.addEventListener('change', applyTheme)

let data: { snapshot: ValueClockSnapshot; receivedAt: number } | undefined
let paused = false, fetching = false, failed = false, display = false
const elapsed = (current: NonNullable<typeof data>) => performance.now() - current.receivedAt + Math.max(0, Date.parse(current.snapshot.server_now) - Date.parse(current.snapshot.as_of))

function render() {
  if (document.hidden) return
  const snapshot = data?.snapshot
  const age = data ? elapsed(data) : 0
  const stale = Boolean(snapshot?.valid_until && Date.parse(snapshot.valid_until) <= Date.parse(snapshot.as_of) + age)
  const status = !snapshot ? failed ? text.paused : text.loading
    : stale || snapshot.status === 'paused' ? text.paused
      : snapshot.status === 'not_started' ? text.notStarted : snapshot.status === 'rebuilding' ? text.rebuilding : snapshot.status === 'empty' ? text.empty : text.ready
  element('status').textContent = status
  element('status-mark').toggleAttribute('data-live', status === text.ready)
  element('status').toggleAttribute('data-live', status === text.ready)
  element('readings').setAttribute('aria-busy', String(!snapshot && fetching))
  element('error-note').hidden = !(failed || stale)
  element('error-text').textContent = snapshot ? failed ? text.refreshFailed : text.paused : '暂时无法读取统计，请稍后重试。'
  element<HTMLButtonElement>('retry').disabled = fetching
  if (!snapshot || paused) return
  const reading = projectValueClock(snapshot, age)
  const total = format(reading.totals?.sanity)
  const [integer, fraction] = total.split('.')
  renderInteger(integer)
  element('fraction').textContent = fraction === undefined ? '' : `.${fraction}`
  element('total').style.setProperty('--value-clock-characters', String(total.length))
  element('total').setAttribute('aria-label', `${text.total} ${total} ${text.unit}`)
  element('complete').textContent = total
  element('rate').textContent = format(snapshot.rates_per_second ? snapshot.rates_per_second.sanity * 60 : undefined)
  for (const [id, value] of [['lmd', reading.totals?.lmd_net], ['experience', reading.totals?.experience_points], ['orundum', reading.totals?.orundum]] as const) {
    element(id).textContent = format(value, 0)
    element(id).style.setProperty('--value-clock-characters', String(format(value, 0).length))
  }
  element('today').textContent = compact(reading.today?.sanity)
  element('today').parentElement!.setAttribute('aria-label', `${format(reading.today?.sanity)} ${text.unit}`)
  element('accounts').textContent = format(snapshot.active_accounts, 0)
}

async function refresh() {
  if (fetching || document.hidden) return
  fetching = true
  render()
  try {
    const response = await fetch('/api/value-clock', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Clock HTTP ${response.status}`)
    const snapshot = valueClockSnapshotSchema.parse(await response.json())
    const old = data
    if (old && (snapshot.series_id !== old.snapshot.series_id || snapshot.revision !== old.snapshot.revision && (snapshot.totals?.sanity ?? 0) < (projectValueClock(old.snapshot, elapsed(old)).totals?.sanity ?? 0) - 0.005)) element('calibrated-note').hidden = false
    data = { snapshot, receivedAt: performance.now() }
    failed = false
    for (const [id, value] of [['updated', snapshot.as_of], ['tracking', snapshot.tracking_started_at]] as const) {
      element(`${id}-row`).hidden = !value
      if (value) {
        element<HTMLTimeElement>(id).dateTime = value
        element(id).textContent = new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
      }
    }
  } catch {
    failed = true
  } finally {
    fetching = false
    render()
  }
}

const fullscreenButton = element<HTMLButtonElement>('fullscreen')
function setDisplay(value: boolean) {
  display = value
  element('clock').classList.toggle('value-clock-display', value)
  fullscreenButton.textContent = value ? text.exitFullscreen : text.fullscreen
  if (!value) fullscreenButton.focus()
}
fullscreenButton.addEventListener('click', async () => {
  if (display) {
    if (document.fullscreenElement) await document.exitFullscreen()
    setDisplay(false)
  } else {
    setDisplay(true)
    try { await element('clock').requestFullscreen?.() } catch { element('clock').scrollIntoView({ block: 'start' }) }
  }
})
document.addEventListener('fullscreenchange', () => { if (display && !document.fullscreenElement) setDisplay(false) })
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && display && !document.fullscreenElement) setDisplay(false) })
element('pause').addEventListener('click', () => {
  paused = !paused
  element('pause').textContent = paused ? text.resume : text.pause
  element('paused-note').hidden = !paused
  render()
})
element('retry').addEventListener('click', () => void refresh())
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); void refresh() } })
window.addEventListener('online', () => void refresh())
setInterval(render, 1000)
setInterval(() => void refresh(), 30_000)
void refresh()
