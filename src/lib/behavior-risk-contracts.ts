import { z } from 'zod'

const behaviorRiskStatusSchema = z.enum(['pending', 'dismissed', 'actioned'])

const evidenceSchema = z.record(z.string(), z.unknown())

const behaviorRiskRuleSchema = z.object({
  code: z.string(),
  category: z.string(),
  score: z.number().int().min(0).max(100),
  explanation: z.string(),
  evidence: evidenceSchema,
}).strict()

const behaviorRiskProfileSchema = z.object({
  profile_id: z.string(),
  profile_label: z.string(),
  kind: z.string(),
  status: z.string(),
}).strict()

const behaviorRiskMemberSchema = z.object({
  user_id: z.string(),
  account_email: z.string().email().nullable(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  first_seen_at: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  browser_prefixes: z.array(z.string()),
  network_prefixes: z.array(z.string()),
  uid_prefixes: z.array(z.string()),
  output_prefixes: z.array(z.string()),
  operator_fingerprint_prefixes: z.array(z.string()).optional(),
  profiles: z.array(behaviorRiskProfileSchema),
}).strict()

const behaviorRiskAuditSchema = z.object({
  id: z.string(),
  admin_username: z.string(),
  outcome: z.enum(['dismiss', 'restrict']),
  note: z.string(),
  actions: z.array(evidenceSchema),
  case_snapshot: evidenceSchema,
  created_at: z.string(),
  integrity_hash: z.string().nullable(),
}).strict()

const behaviorRiskCaseSchema = z.object({
  id: z.string(),
  status: behaviorRiskStatusSchema,
  score: z.number().int().min(0).max(100),
  categories: z.array(z.string()),
  rules: z.array(behaviorRiskRuleSchema),
  model_version: z.string(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  expires_at: z.string(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().nullable(),
  members: z.array(behaviorRiskMemberSchema),
  audits: z.array(behaviorRiskAuditSchema),
}).strict()

const behaviorRiskHealthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'unknown']),
  last_collection_at: z.string().nullable(),
  last_collection_status: z.enum(['success', 'disabled', 'failed']).nullable(),
  last_evaluation_at: z.string().nullable(),
  last_evaluation_status: z.enum(['success', 'lock_busy', 'failed']).nullable(),
  last_failure_at: z.string().nullable(),
  last_failure_stage: z.string().nullable(),
  backlog_count: z.number().int().nonnegative(),
  events_processed: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  purged_events: z.number().int().nonnegative(),
}).strict()

export const behaviorRiskCasePageSchema = z.object({
  cases: z.array(behaviorRiskCaseSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    page_size: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
    total_pages: z.number().int().nonnegative(),
  }).strict(),
  health: behaviorRiskHealthSchema,
  capabilities: z.array(z.enum(['risk_view', 'risk_review', 'risk_config'])).optional(),
}).strict()

export type BehaviorRiskMemberDto = z.infer<typeof behaviorRiskMemberSchema>
export type BehaviorRiskAuditDto = z.infer<typeof behaviorRiskAuditSchema>
export type BehaviorRiskCaseDto = z.infer<typeof behaviorRiskCaseSchema>
export type BehaviorRiskHealthDto = z.infer<typeof behaviorRiskHealthSchema>
export type BehaviorRiskCasePageDto = z.infer<typeof behaviorRiskCasePageSchema>
