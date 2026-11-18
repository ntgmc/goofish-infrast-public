import { expect, it } from 'vitest'
import { DEFAULT_AI_SETTINGS, aiConfigurationIssues } from '../src/lib/ai-settings'
import { accountAiUsage, normalizeAiUsage } from './ai-usage-accounting'
import type { ScheduleExplanationConfig } from './storage/ai-settings-store'

const config: ScheduleExplanationConfig = { ...DEFAULT_AI_SETTINGS, enabled: true, apiKey: 'test',
  provider: 'test', baseURL: 'https://example.test', model: 'test', inputPrice: 2, outputPrice: 8,
  cachedInputPrice: 0.2, cacheWritePrice: 2.5, cacheWrite1hPrice: 4,
  reservation: 50000, dailyBudget: 10e6, monthlyBudget: 200e6 }

it('charges OpenAI cache hits within the input total once, including zero-priced cache hits', () => {
  const usage = normalizeAiUsage({ input: 1000, output: 100, cached: 800 }, 'openai_chat')
  expect(accountAiUsage(usage, config)).toMatchObject({ cost: 1360, costBasis: 'usage',
    breakdown: { input: 400, cached_input: 160, output: 800 }, usage: { input_tokens: 1000, cached_input_tokens: 800 } })
  expect(accountAiUsage(usage, { ...config, cachedInputPrice: 0 })).toMatchObject({ cost: 1200, costBasis: 'usage' })
  expect(accountAiUsage(usage, { ...config, cachedInputPrice: null })).toMatchObject({ cost: 50000, costBasis: 'reserved', breakdown: null, usage })
})

it('adds Anthropic cache reads and both cache creation durations to total input and prices them separately', () => {
  const usage = normalizeAiUsage({ input: 100, output: 50, cached: 700, write: 200, write5m: 150, write1h: 50 }, 'anthropic_messages')
  expect(accountAiUsage(usage, config)).toEqual({ cost: 1315, costBasis: 'usage', usage: {
    input_tokens: 1000, output_tokens: 50, cached_input_tokens: 700, cache_write_tokens: 200,
    cache_write_5m_tokens: 150, cache_write_1h_tokens: 50,
  }, breakdown: { input: 200, cached_input: 140, cache_write_5m: 375, cache_write_1h: 200, output: 400 } })
  expect(accountAiUsage(usage, { ...config, cacheWrite1hPrice: null }).costBasis).toBe('reserved')
  const unknownDuration = normalizeAiUsage({ input: 100, output: 50, cached: 700, write: 200 }, 'anthropic_messages')
  expect(accountAiUsage(unknownDuration, config)).toMatchObject({ costBasis: 'reserved', usage: { cache_write_tokens: 200, cache_write_5m_tokens: null } })
})

it('marks omitted cache details as estimated and invalid or missing token usage as reserved', () => {
  expect(accountAiUsage(normalizeAiUsage({ input: 100, output: 50 }, 'openai_responses'), config)).toMatchObject({
    cost: 600, costBasis: 'estimated', usage: { cached_input_tokens: null },
  })
  expect(accountAiUsage(normalizeAiUsage({ input: 100, output: 50 }, 'openai_chat'), { ...config, cachedInputPrice: 10 })).toMatchObject({ costBasis: 'reserved', cost: 50000 })
  for (const raw of [{ input: -1, output: 5 }, { input: 100, output: 5, cached: 101 }, { input: 1.5, output: 5 },
    { input: 100 }, { input: 100, output: '5' }, { input: Number.MAX_SAFE_INTEGER + 1, output: 5 }]) {
    expect(normalizeAiUsage(raw, 'openai_chat')).toBeNull()
  }
  expect(normalizeAiUsage({ input: 100, output: 5, write: 10, write5m: 20 }, 'anthropic_messages')).toBeNull()
  expect(accountAiUsage(null, config)).toEqual({ cost: 50000, costBasis: 'reserved', usage: null, breakdown: null })
})

it('checks the most expensive configured input category before enabling calls', () => {
  const issues = aiConfigurationIssues({ ...config, protocol: 'anthropic_messages', cacheWrite1hPrice: 10, requestCap: 0.05 }, true)
  expect(issues).toContainEqual(expect.objectContaining({ path: 'settings.requestCap' }))
  expect(aiConfigurationIssues({ ...config, protocol: 'openai_chat', requestCap: 0.05 }, true)).toEqual([])
})
