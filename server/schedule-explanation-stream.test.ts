import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_AI_SETTINGS } from '../src/lib/ai-settings'
import type { OptimizeResult } from '../src/lib/types'
import { buildScheduleExplanationSummary, generateScheduleExplanation } from './schedule-explanation'

const config = { ...DEFAULT_AI_SETTINGS, enabled: true, apiKey: 'test-key', baseURL: 'https://example.test/v1', model: 'chat-model',
  provider: '测试', inputPrice: 1, outputPrice: 2, cachedInputPrice: 0.1, reservation: 9600 }
const summary = buildScheduleExplanationSummary({ buildingType: 243, plans: [] } as unknown as OptimizeResult)
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const sse = (text: string) => new Response(text, { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'openai-request', 'request-id': 'anthropic-request' } })
afterEach(() => vi.unstubAllGlobals())

it('streams Chat text before its final usage, requesting cached-token statistics in a single bounded call', async () => {
  const gate = Promise.withResolvers<void>()
  const upstream = vi.fn(async () => new Response(new ReadableStream({ async start(controller) {
    const push = (value: unknown) => controller.enqueue(new TextEncoder().encode(event(value)))
    push({ choices: [{ index: 0, delta: { content: '**先看库存**' }, finish_reason: null }] })
    await gate.promise
    push({ choices: [{ index: 0, delta: { content: '，再选一项培养。' }, finish_reason: 'stop' }] })
    push({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 800 } } })
    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req-chat' } }))
  vi.stubGlobal('fetch', upstream)
  const delta = vi.fn()
  const pending = generateScheduleExplanation(summary, config, delta)
  await vi.waitFor(() => expect(delta).toHaveBeenCalledWith('**先看库存**'))
  expect(delta).toHaveBeenCalledTimes(1)
  gate.resolve()
  await expect(pending).resolves.toMatchObject({ text: '**先看库存**，再选一项培养。', cost: 480, costBasis: 'usage', providerRequestId: 'req-chat',
    usage: { input_tokens: 1000, output_tokens: 100, cached_input_tokens: 800 } })
  expect(upstream).toHaveBeenCalledOnce()
  const init = upstream.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(init[1].body as string)).toMatchObject({ stream: true, stream_options: { include_usage: true }, max_tokens: 800 })
  expect(init[1].signal).toBeInstanceOf(AbortSignal)
})

it.each(['completed', 'incomplete'] as const)('settles Responses %s usage including cached tokens and only accepts completed text', async (status) => {
  const upstream = vi.fn(async () => sse(event({ type: 'response.output_text.delta', delta: '**库存**' }) + event({ type: `response.${status}`, response: {
    status, usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 800 } },
  } })))
  vi.stubGlobal('fetch', upstream)
  const delta = vi.fn()
  await expect(generateScheduleExplanation(summary, { ...config, protocol: 'openai_responses' }, delta)).resolves.toMatchObject({
    text: status === 'completed' ? '**库存**' : null, cost: 480, costBasis: 'usage', providerRequestId: 'openai-request',
    errorCode: status === 'completed' ? null : 'incomplete_output',
  })
  expect(delta).toHaveBeenCalledWith('**库存**')
  const init = upstream.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(init[1].body as string)).toMatchObject({ store: false, stream: true, max_output_tokens: 800 })
})

it.each(['end_turn', 'max_tokens'])('merges Anthropic input/cache details with final output usage for %s', async (stop) => {
  const upstream = vi.fn(async () => sse([
    { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 700, cache_creation_input_tokens: 200,
      cache_creation: { ephemeral_5m_input_tokens: 150, ephemeral_1h_input_tokens: 50 } } } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '不显示的推理' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '**库存**' } },
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 50 } },
    { type: 'message_stop' },
  ].map(event).join('')))
  vi.stubGlobal('fetch', upstream)
  const delta = vi.fn()
  await expect(generateScheduleExplanation(summary, { ...config, protocol: 'anthropic_messages', cacheWritePrice: 1.25, cacheWrite1hPrice: 2 }, delta)).resolves.toMatchObject({
    text: stop === 'end_turn' ? '**库存**' : null, cost: 558, costBasis: 'usage', providerRequestId: 'anthropic-request',
    usage: { input_tokens: 1000, output_tokens: 50, cached_input_tokens: 700, cache_write_5m_tokens: 150, cache_write_1h_tokens: 50 },
  })
  expect(delta).toHaveBeenCalledExactlyOnceWith('**库存**')
})

it.each(['openai_chat', 'openai_responses', 'anthropic_messages'] as const)('does not accept an interrupted %s stream or assume missing usage is zero', async (protocol) => {
  const first = protocol === 'openai_chat' ? { choices: [{ index: 0, delta: { content: '片段' }, finish_reason: null }] }
    : protocol === 'openai_responses' ? { type: 'response.output_text.delta', delta: '片段' }
      : { type: 'content_block_delta', delta: { type: 'text_delta', text: '片段' } }
  const upstream = vi.fn(async () => sse(event(first)))
  vi.stubGlobal('fetch', upstream)
  await expect(generateScheduleExplanation(summary, { ...config, protocol }, vi.fn())).resolves.toMatchObject({
    text: null, cost: config.reservation, costBasis: 'reserved', usage: null, errorCode: 'incomplete_output',
  })
  expect(upstream).toHaveBeenCalledOnce()
})

it('bounds streamed text and never retries provider failures', async () => {
  const upstream = vi.fn(async () => sse(event({ choices: [{ index: 0, delta: { content: 'x'.repeat(4001) }, finish_reason: null }] })))
  vi.stubGlobal('fetch', upstream)
  await expect(generateScheduleExplanation(summary, config, vi.fn())).rejects.toThrow('explanation_output_too_large')
  expect(upstream).toHaveBeenCalledOnce()
  upstream.mockResolvedValueOnce(new Response('private provider failure', { status: 500 }))
  await expect(generateScheduleExplanation(summary, config, vi.fn())).rejects.toThrow()
  expect(upstream).toHaveBeenCalledTimes(2)
})
