import { z } from 'zod'
import type { AiGenerationAccounting, AiTokenUsage } from '../src/lib/ai-usage'
import type { ScheduleExplanationConfig } from './storage/ai-settings-store'

const tokenCount = z.number().int().nonnegative()
const providerUsageSchema = z.object({
  input: tokenCount, output: tokenCount,
  cached: tokenCount.nullish(), write: tokenCount.optional(),
  write5m: tokenCount.optional(), write1h: tokenCount.optional(),
})

export function normalizeAiUsage(raw: unknown, protocol: ScheduleExplanationConfig['protocol']): AiTokenUsage | null {
  const parsed = providerUsageSchema.safeParse(raw)
  if (!parsed.success) return null
  const value = parsed.data
  const anthropic = protocol === 'anthropic_messages'
  const cached = value.cached ?? (anthropic ? 0 : null)
  const write = anthropic ? value.write ?? 0 : 0
  const input = value.input + (anthropic ? (cached ?? 0) + write : 0)
  const write5m = anthropic && write > 0 ? value.write5m ?? null : 0
  const write1h = anthropic && write > 0 ? value.write1h ?? null : 0
  if (!Number.isSafeInteger(input) || (cached ?? 0) + write > input
    || (write5m ?? 0) + (write1h ?? 0) > write) return null
  return { input_tokens: input, output_tokens: value.output, cached_input_tokens: cached,
    cache_write_tokens: write, cache_write_5m_tokens: write5m, cache_write_1h_tokens: write1h }
}

export function accountAiUsage(usage: AiTokenUsage | null, config: ScheduleExplanationConfig): Pick<AiGenerationAccounting, 'cost' | 'costBasis' | 'usage' | 'breakdown'> {
  const reserved = { cost: config.reservation, costBasis: 'reserved' as const, usage, breakdown: null }
  if (!usage) return reserved
  const cached = usage.cached_input_tokens ?? 0
  const write5m = usage.cache_write_5m_tokens ?? 0
  const write1h = usage.cache_write_1h_tokens ?? 0
  if (usage.cached_input_tokens === null && (config.cachedInputPrice ?? 0) > config.inputPrice
    || cached > 0 && config.cachedInputPrice === null
    || write5m > 0 && config.cacheWritePrice === null || write1h > 0 && config.cacheWrite1hPrice === null
    || usage.cache_write_tokens !== write5m + write1h) return reserved
  const breakdown = {
    input: (usage.input_tokens - cached - usage.cache_write_tokens) * config.inputPrice,
    cached_input: cached * (config.cachedInputPrice ?? 0),
    cache_write_5m: write5m * (config.cacheWritePrice ?? 0),
    cache_write_1h: write1h * (config.cacheWrite1hPrice ?? 0),
    output: usage.output_tokens * config.outputPrice,
  }
  return { cost: Math.ceil(Object.values(breakdown).reduce((sum, value) => sum + value, 0)),
    costBasis: usage.cached_input_tokens === null ? 'estimated' : 'usage', usage, breakdown }
}
