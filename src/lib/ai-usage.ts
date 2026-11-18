import type { AiSettings } from './ai-settings'

export interface AiTokenUsage {
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number | null
  cache_write_tokens: number
  cache_write_5m_tokens: number | null
  cache_write_1h_tokens: number | null
}
export type AiCostBasis = 'usage' | 'estimated' | 'reserved' | 'legacy'
export interface AiCostBreakdown {
  input: number
  cached_input: number
  cache_write_5m: number
  cache_write_1h: number
  output: number
}
export type AiPriceSnapshot = Pick<AiSettings, 'provider' | 'protocol' | 'model' | 'inputPrice' | 'outputPrice' | 'cachedInputPrice' | 'cacheWritePrice' | 'cacheWrite1hPrice'>
export interface AiGenerationAccounting {
  cost: number
  costBasis: Exclude<AiCostBasis, 'legacy'>
  usage: AiTokenUsage | null
  breakdown: AiCostBreakdown | null
  providerRequestId: string | null
  errorCode: 'provider_error' | 'input_too_large' | 'disabled' | 'incomplete_output' | null
}
export interface AiUsageRecord {
  id: string
  user_id: string | null
  profile_id: string | null
  result_id: string | null
  status: 'pending' | 'succeeded' | 'failed'
  created_at: string
  settled_at: string | null
  duration_ms: number | null
  cost_micro_cny: number
  reserved_micro_cny: number | null
  cost_basis: AiCostBasis
  pricing: AiPriceSnapshot | null
  usage: AiTokenUsage | null
  breakdown: AiCostBreakdown | null
  provider_request_id: string | null
  error_code: string | null
}
export interface AiUsageTotals {
  requests: number
  succeeded: number
  failed: number
  pending: number
  metered_requests: number
  cache_reported_requests: number
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  cache_write_tokens: number
  cost_micro_cny: number
  usage_cost_micro_cny: number
  estimated_cost_micro_cny: number
  reserved_cost_micro_cny: number
  input_cost_micro_cny: number | null
  cached_input_cost_micro_cny: number | null
  cache_write_cost_micro_cny: number | null
  output_cost_micro_cny: number | null
}
export interface AdminAiUsagePage {
  items: AiUsageRecord[]
  totals: AiUsageTotals
  daily: Array<AiUsageTotals & { day: string }>
  models: Array<AiUsageTotals & { provider: string | null; model: string | null; protocol: string | null }>
  pagination: { page: number; page_size: number; total: number; total_pages: number }
}
export interface AdminAiUsageDetail {
  item: AiUsageRecord
  explanation: { text: string; created_at: string } | null
}
export interface AiUsageFilters {
  from?: string
  to?: string
  status?: AiUsageRecord['status']
  provider?: string
  model?: string
  user_id?: string
}
