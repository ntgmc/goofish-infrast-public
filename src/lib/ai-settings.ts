import { z } from 'zod'
import { aiSettingsCopy } from '../copy/zh-CN/ai-settings'
const messages = aiSettingsCopy.validation

export const AI_PROTOCOLS = ['openai_chat', 'openai_responses', 'anthropic_messages'] as const
const httpsBase = z.string().trim().max(2048).refine((value) => {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}, messages.https)

export const aiSettingsSchema = z.strictObject({
  provider: z.string().trim().max(80),
  protocol: z.enum(AI_PROTOCOLS),
  baseURL: httpsBase,
  model: z.string().trim().max(128),
  inputPrice: z.number().min(0).max(10000),
  outputPrice: z.number().min(0).max(10000),
  cachedInputPrice: z.number().min(0).max(10000).nullable().default(null),
  cacheWritePrice: z.number().min(0).max(10000).nullable().default(null),
  cacheWrite1hPrice: z.number().min(0).max(10000).nullable().default(null),
  requestCap: z.number().positive().max(100),
  dailyBudget: z.number().positive().max(100000),
  monthlyBudget: z.number().positive().max(1000000),
  trialLimit: z.number().int().min(0).max(100),
  monthlyLimit: z.number().int().min(0).max(1000),
  dailyAttemptLimit: z.number().int().min(1).max(1000),
  concurrencyLimit: z.number().int().min(1).max(10),
  maxInputTokens: z.number().int().min(2048).max(128000),
  maxOutputTokens: z.number().int().min(64).max(1600),
  timeoutMs: z.number().int().min(1000).max(90000),
})
export type AiSettings = z.infer<typeof aiSettingsSchema>
export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: '', protocol: 'openai_chat', baseURL: '', model: '', inputPrice: 0, outputPrice: 0,
  cachedInputPrice: null, cacheWritePrice: null, cacheWrite1hPrice: null,
  requestCap: 0.05, dailyBudget: 10, monthlyBudget: 200, trialLimit: 3, monthlyLimit: 10,
  dailyAttemptLimit: 20, concurrencyLimit: 1, maxInputTokens: 8000, maxOutputTokens: 800, timeoutMs: 45000,
}
export interface AdminAiSettings {
  settings: AiSettings
  has_api_key: boolean
  enabled: boolean
  effective_enabled: boolean
  revision: number
  feature_revision: number
  updated_at: string | null
}
export const adminAiSettingsUpdateSchema = z.strictObject({
  settings: aiSettingsSchema,
  enabled: z.boolean(),
  api_key: z.string().trim().min(1).max(4096).optional(),
  clear_api_key: z.boolean().default(false),
  expected_revision: z.number().int().nonnegative(),
  expected_feature_revision: z.number().int().nonnegative(),
  reason: z.string().trim().min(2).max(500),
}).refine((value) => !value.api_key || !value.clear_api_key, { message: messages.key_conflict, path: ['api_key'] })
export type AiSettingsUpdate = z.infer<typeof adminAiSettingsUpdateSchema>

export function aiConfigurationIssues(settings: AiSettings, hasApiKey: boolean) {
  const issues: Array<{ path: string; message: string }> = []
  for (const [path, message] of [['provider', messages.provider], ['baseURL', messages.baseURL], ['model', messages.model]] as const) {
    if (!settings[path]) issues.push({ path: `settings.${path}`, message })
  }
  if (!hasApiKey) issues.push({ path: 'api_key', message: messages.key })
  for (const path of ['inputPrice', 'outputPrice'] as const) {
    if (settings[path] <= 0) issues.push({ path: `settings.${path}`, message: messages.price })
  }
  if (getAiRequestReservation(settings) > Math.floor(settings.requestCap * 1e6)) {
    issues.push({ path: 'settings.requestCap', message: messages.cap })
  }
  return issues
}

export function getAiRequestReservation(settings: AiSettings) {
  return Math.ceil(settings.maxInputTokens * Math.max(settings.inputPrice, settings.cachedInputPrice ?? 0,
    settings.protocol === 'anthropic_messages' ? Math.max(settings.cacheWritePrice ?? 0, settings.cacheWrite1hPrice ?? 0) : 0)
    + settings.maxOutputTokens * settings.outputPrice)
}
