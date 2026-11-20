import { expect, it, vi } from 'vitest'
import { readScheduleExplanationResponse } from './schedule-explanation'
import { readServerSentEvents } from './server-sent-events'

const state = { explanation: { text: '**库存** 🐰', created_at: '2026-11-17T12:00:00.000Z' }, pending: false,
  available: false, reason: null, credits: { service: 'schedule_explanation', price: '1.00', charge: '0.00', available: '5.00' }, provider: '测试' }
function response(text: string) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
    controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`

it('decodes UTF-8 and split CRLF boundaries, ignores heartbeats, and validates the settled result', async () => {
  const delta = vi.fn()
  const result = await readScheduleExplanationResponse(response(': keep-alive\r\n\r\n' + event({ type: 'delta', text: '**库存** 🐰' }) + event({ type: 'state', state })), delta)
  expect(delta).toHaveBeenCalledWith('**库存** 🐰')
  expect(result).toEqual(state)
})

it('supports multiline SSE data and discards unterminated events', async () => {
  const items = []
  for await (const data of readServerSentEvents(response('data: first\ndata: second\n\ndata: incomplete').body!)) items.push(data)
  expect(items).toEqual(['first\nsecond'])
})

it.each([
  event({ type: 'delta', text: '部分内容' }),
  event({ type: 'state', state: { ...state, explanation: null, pending: true } }),
  event({ type: 'state', state: {} }),
  'data: not json\n\n',
])('rejects interrupted or invalid streams instead of treating partial text as a saved answer', async (data) => {
  await expect(readScheduleExplanationResponse(response(data), vi.fn())).rejects.toThrow()
})

it('surfaces a safe generation error and supports existing JSON cached/pending responses', async () => {
  await expect(readScheduleExplanationResponse(response(event({ type: 'error', error: '本次未扣除积分。', code: 'ai_generation_failed' })), vi.fn()))
    .rejects.toMatchObject({ message: '本次未扣除积分。', code: 'ai_generation_failed' })
  const pending = { ...state, explanation: null, pending: true }
  await expect(readScheduleExplanationResponse(Response.json(pending), vi.fn())).resolves.toEqual(pending)
})

it('bounds provider event and accumulated answer sizes and cancels the reader on failure', async () => {
  const cancel = vi.fn()
  const oversized = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: ' + 'x'.repeat(65537))) }, cancel }), { headers: { 'Content-Type': 'text/event-stream' } })
  await expect(readScheduleExplanationResponse(oversized, vi.fn())).rejects.toThrow('event_too_large')
  expect(cancel).toHaveBeenCalledOnce()
  await expect(readScheduleExplanationResponse(response(event({ type: 'delta', text: 'a'.repeat(3000) }) + event({ type: 'delta', text: 'a'.repeat(2000) })), vi.fn())).rejects.toThrow('explanation_too_large')
})
