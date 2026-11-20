import { z } from 'zod'
import { aiSettingsCopy } from '../copy/zh-CN/ai-settings'
import { normalizePointsAmount } from './balance-contracts'

export const AI_CREDIT_SERVICES = ['schedule_explanation', 'comparison', 'cultivation', 'changes'] as const
export type AiCreditService = typeof AI_CREDIT_SERVICES[number]

const price = z.string().transform((value, context) => {
  const normalized = normalizePointsAmount(value)
  if (normalized) return normalized
  context.addIssue({ code: 'custom', message: aiSettingsCopy.validation.points })
  return z.NEVER
}).nullable().default(null)

export const aiCreditPricesSchema = z.strictObject({
  schedule_explanation: price, comparison: price, cultivation: price, changes: price,
})
export type AiCreditPrices = z.infer<typeof aiCreditPricesSchema>
export const DEFAULT_AI_CREDIT_PRICES: AiCreditPrices = {
  schedule_explanation: null, comparison: null, cultivation: null, changes: null,
}

export const aiAcceptedPointsSchema = z.string().regex(/^(?:0(?:\.00)?|[1-9]\d{0,6}(?:\.\d{1,2})?|0\.\d{1,2})$/).max(10).optional()

export const aiCreditQuoteSchema = z.object({
  service: z.enum(AI_CREDIT_SERVICES),
  price: z.string().nullable(),
  charge: z.string(),
  available: z.string(),
})
