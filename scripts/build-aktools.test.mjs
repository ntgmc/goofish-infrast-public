import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { zeroValueClockVector } from '../src/lib/value-clock.ts'
import './build-aktools.mjs'

const html = readFileSync('.cache/aktools-deploy/index.html', 'utf8')
const start = Date.parse('2026-11-23T00:00:00Z')
const iso = (seconds) => new Date(start + seconds * 1000).toISOString()
const snapshot = (seconds = 0, total = 100, revision = 1) => ({
  schema_version: 1, view: 'production', series_id: 'production-v1', metric_version: 'production-sanity-v1', revision,
  as_of: iso(seconds), server_now: iso(seconds), valid_until: iso(seconds + 120),
  day_started_at: '2026-11-22T16:00:00Z', day_ends_at: '2026-11-23T16:00:00Z', tracking_started_at: iso(0),
  totals: { ...zeroValueClockVector(), sanity: total, lmd_net: -10 }, today_totals: zeroValueClockVector(),
  rates_per_second: { ...zeroValueClockVector(), sanity: 1 }, active_accounts: 2, status: 'ready',
})
const flush = () => new Promise((resolve) => setImmediate(resolve))
async function page(initial = snapshot()) {
  let now = 0, reply = initial, requests = 0
  const animations = []
  const timers = new Map()
  const dom = new JSDOM(html, {
    url: 'https://aktools.cn/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addEventListener() {} })
      Object.defineProperty(window.performance, 'now', { value: () => now })
      window.Element.prototype.animate = (keyframes, options) => { animations.push({ keyframes, options }); return { cancel() {} } }
      window.setInterval = (callback, interval) => { timers.set(interval, callback); return interval }
      window.fetch = async (url, options) => {
        requests++
        assert.equal(url, '/api/value-clock')
        assert.equal(options.credentials, 'omit')
        if (reply instanceof Error) throw reply
        return new Response(JSON.stringify(reply), { headers: { 'Content-Type': 'application/json' } })
      }
    },
  })
  await flush()
  const document = dom.window.document
  return {
    dom, document, text: (id) => document.getElementById(id).textContent,
    advance(milliseconds) { now = milliseconds; timers.get(1000)() },
    async refresh(next) { reply = next; document.getElementById('retry').click(); await flush() },
    requests: () => requests,
    animations: () => animations,
  }
}

test('the built page stops at expiry, preserves a failed read, and accepts a downward correction', async () => {
  const clock = await page()
  try {
    assert.equal(clock.text('integer'), '100')
    assert.equal(clock.text('lmd'), '-10')
    clock.advance(4000)
    assert.equal(clock.text('integer'), '104')
    assert.equal(clock.document.querySelectorAll('.value-clock-digit').length, 3)
    assert.equal(clock.animations().at(-1).options.duration, 220)
    clock.advance(130_000)
    assert.equal(clock.text('integer'), '220')
    assert.equal(clock.text('status'), '数据暂未更新，已暂停增长')
    await clock.refresh(new Error('offline'))
    clock.advance(300_000)
    assert.equal(clock.text('integer'), '220')
    assert.equal(clock.document.getElementById('error-note').hidden, false)
    await clock.refresh(snapshot(300, 90, 2))
    assert.equal(clock.text('integer'), '90')
    assert.equal(clock.document.getElementById('calibrated-note').hidden, false)
    await clock.refresh({ ...snapshot(300), totals: null })
    assert.equal(clock.text('integer'), '90')
    assert.equal(clock.document.getElementById('error-note').hidden, false)
  } finally { clock.dom.window.close() }
})

test('pause freezes displayed readings across refreshes and resume uses the latest snapshot', async () => {
  const clock = await page()
  try {
    clock.advance(2000)
    clock.document.getElementById('pause').click()
    clock.advance(6000)
    await clock.refresh(snapshot(6, 106))
    assert.equal(clock.text('integer'), '102')
    assert.equal(clock.text('pause'), '继续')
    clock.document.getElementById('pause').click()
    assert.equal(clock.text('integer'), '106')
    clock.dom.window.Date.now = () => start + 86_400_000
    clock.advance(6000)
    assert.equal(clock.text('integer'), '106')
  } finally { clock.dom.window.close() }
})

test('an unavailable initial response leaves unknown readings empty', async () => {
  const clock = await page(new Error('feature disabled'))
  try {
    assert.equal(clock.text('integer'), '—')
    assert.equal(clock.text('accounts'), '—')
    assert.equal(clock.document.getElementById('error-note').hidden, false)
    assert.equal(clock.requests(), 1)
  } finally { clock.dom.window.close() }
})
