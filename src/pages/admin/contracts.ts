import type { Announcement, AnnouncementKind, AnnouncementStats as AnnouncementReachStats, LicenseOperator, ProductPermissionMode, RawPermissionMode, UserGameAccountKind } from '../../lib/types'
import type { AdminSection } from '../../lib/app-routes'
import { copy } from '../../copy/index'
import { getPermissionProfile, getPermissionRank, listAdminIssuablePermissions, productPolicies } from '../../lib/product-catalog'

export type { AdminSection } from '../../lib/app-routes'
export type Permission = RawPermissionMode

export type GeneratedPermission = ProductPermissionMode

export type CdkStatus = 'unused' | 'used' | 'frozen' | 'revoked'

export type AppUserStatus = 'active' | 'frozen' | 'revoked'

export type StatusFilter = CdkStatus | 'all'

export type PermissionFilter = GeneratedPermission | 'all'

export type BinaryFilter = 'all' | 'yes' | 'no'

export type FieldErrors = Record<string, string>

export interface CdkTableFilters {
  status: StatusFilter;
  permission: PermissionFilter;
  risk: BinaryFilter;
  generated: BinaryFilter;
}

export interface GeneratedCdk {
  code: string;
  permission: GeneratedPermission;
  created_at: string;
}

export interface AdminCdkCreateResponse {
  code?: string;
  permission?: GeneratedPermission;
  created_at?: string;
  count?: number;
  cdks?: Array<Partial<GeneratedCdk>>;
}

export interface AdminCdkRecord {
  code_hash: string;
  cdk_id: string;
  permission: Permission;
  status: CdkStatus;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
  frozen_at?: string | null;
  freeze_reason?: string | null;
  schedule_generate_count?: number;
  order_note: string | null;
  license_order_hash: string | null;
  operator_count: number | null;
  config_desc: string | null;
  risk_event_count?: number;
  risk_events?: Array<{ at: string; type: string; reason: string; soft_block?: boolean; escalation?: boolean }>;
  latest_risk_event?: { at: string; type: string; reason: string; soft_block?: boolean; escalation?: boolean } | null;
}

export interface AdminCdkDetail extends AdminCdkRecord {
  baseline_operator_count?: number | null;
  latest_operator_count?: number | null;
  risk_events?: Array<{ at: string; type: string; reason: string; detail?: Record<string, unknown> | null }>;
  linked_account?: { account_id: string; profile_id: string } | null;
}

export interface UsageTotals {
  unique_visitors: number;
  visits: number;
  free_previews: number;
  registers: number;
  schedule_generates: number;
  cdk_redeems: number;
  failures: number;
  schedule_failures: number;
  cdk_redeem_failures: number;
  skland_imports: number;
  skland_import_failures: number;
  announcement_impressions: number;
  announcement_reads: number;
}

export interface UsageDay extends UsageTotals {
  date: string;
}

export type UsageRangeKey = '7d' | '14d' | '30d'

export type UsageRangeMode = UsageRangeKey | 'custom'

export type AnnouncementSortKey = 'updated_desc' | 'updated_asc' | 'kind' | 'active'

export interface UsageRange {
  from: string;
  to: string;
  days: number;
}

export interface UsageFunnelStep {
  key: string;
  label: string;
  count: number;
  conversion_rate: number;
  dropoff: number;
}

export interface UsageFailureReason {
  reason_code: string;
  count: number;
  percentage: number;
  last_seen_at: string | null;
  events?: Record<string, number>;
}

export interface UsageFailureSample {
  created_at: string;
  event: string;
  reason_code: string;
  duration_ms: number | null;
  permission: string | null;
  cdk_status: string | null;
  source: string | null;
  has_profile: boolean;
}

export interface UsageLatencyStats {
  average_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  sample_count: number;
  days: Array<{ date: string; average_ms: number; p95_ms: number; sample_count: number }>;
}

export interface UsageSklandStats {
  attempts: number;
  success: number;
  failed: number;
  success_rate: number;
  credential_invalid: number;
  refresh_forbidden: number;
  not_bound: number;
  request_failed: number;
  days: Array<{ date: string; attempts: number; success: number; failed: number; success_rate: number }>;
}

export interface UsageAnnouncementStats {
  impressions: number;
  reads: number;
  unread: number;
  read_rate: number;
}

export interface UsageCdkDistributionItem {
  permission: string;
  total: number;
  success: number;
  failure: number;
  statuses: Record<string, number>;
}

export interface UsageStatsResponse {
  totals: UsageTotals;
  days: UsageDay[];
  range: UsageRange;
  funnel: UsageFunnelStep[];
  failure_reasons: UsageFailureReason[];
  recent_failures: UsageFailureSample[];
  latency: {
    schedule_generate: UsageLatencyStats;
  };
  skland: UsageSklandStats;
  announcement: UsageAnnouncementStats;
  cdk_distribution: UsageCdkDistributionItem[];
}

export interface CdkPermissionDistribution {
  permission: Permission;
  total: number;
  unused: number;
  used: number;
  frozen: number;
  revoked: number;
}

export interface CdkStatusDistribution {
  status: CdkStatus;
  total: number;
}

export interface RiskReasonStats {
  reason: string;
  type: string;
  count: number;
  last_seen_at: string | null;
  latest_record: AdminCdkRecord | null;
}

export interface RiskTrendDay {
  date: string;
  soft_blocks: number;
  freezes: number;
  escalations: number;
  total: number;
}

export interface CdkOpsSummary {
  permission_distribution: CdkPermissionDistribution[];
  status_distribution: CdkStatusDistribution[];
  risk_reasons: RiskReasonStats[];
  risk_trend: RiskTrendDay[];
  soft_blocks: number;
  freezes: number;
  escalations: number;
  risk_records: number;
  generated_records: number;
}

export interface RiskControlSettings {
  operator_data_risk_enabled: boolean;
  updated_at: string | null;
}

export type RiskControlSettingsPatch = Partial<Pick<RiskControlSettings, 'operator_data_risk_enabled'>>

export interface AdminUserSummary {
  username: string;
  created_at: string;
  updated_at: string;
}

export interface AdminOptimizationDeadLetter {
  id: string;
  job_id: string;
  profile_id: string | null;
  source: string;
  failure_kind: string;
  public_error_code: string;
  internal_error_message: string;
  diagnostic_json: Record<string, unknown>;
  attempt_count: number;
  status: 'pending_review' | 'replayed' | 'discarded' | 'resolved';
  replay_count: number;
  replayed_job_id: string | null;
  replayed_by: string | null;
  replayed_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AdminOptimizationQueueStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'dead_lettered'

export interface AdminOptimizationQueueJob {
  id: string;
  status: AdminOptimizationQueueStatus;
  queue_position: number | null;
  source: string;
  priority: {
    value: number;
    label: '优先券' | '付费任务' | '分析任务' | '标准任务';
  };
  permission: string | null;
  user: { id: string; email: string } | null;
  profile: { id: string; display_name: string } | null;
  attempt_count: number;
  failure_count: number;
  worker_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  heartbeat_at: string | null;
  next_attempt_at: string | null;
  expires_at: string | null;
  cancel_requested_at: string | null;
  failure_kind: string | null;
  public_error_code: string | null;
  error_summary: string | null;
}

export interface AdminOptimizationQueueSnapshot {
  snapshot_at: string;
  capacity: {
    queue_limit: number;
    worker_concurrency: number;
  };
  counts: {
    queued: number;
    running: number;
    retry_waiting: number;
    recent_failed: number;
  };
  queued_jobs: AdminOptimizationQueueJob[];
  running_jobs: AdminOptimizationQueueJob[];
  recent_jobs: AdminOptimizationQueueJob[];
}

export interface AppUserSummary {
  id: string;
  email: string;
  permission?: Permission;
  status: AppUserStatus;
  cdk_order_hash?: string | null;
  profile_count: number;
  profile_access: AdminProfileAccessSummary[];
  created_at: string;
  updated_at: string;
}

export interface AdminProfileAccessSummary {
  kind: UserGameAccountKind;
  permission: Permission;
}

interface AdminWorkspaceSummary {
  exists: boolean;
  operator_count: number;
  has_operators: boolean;
  has_config: boolean;
  config_desc: string | null;
  layout: string | null;
  schedule_mode: string;
  dormitory_rule: string | null;
  trading_stations_count: number | null;
  manufacturing_stations_count: number | null;
  has_last_result: boolean;
  last_result_title: string | null;
  updated_at: string | null;
}

interface AdminLinkedCdkSummary {
  cdk_id: string;
  permission: Permission;
  status: CdkStatus;
  license_order_hash: string | null;
  order_note: string | null;
  operator_count: number | null;
  used_at: string | null;
  frozen_at: string | null;
  freeze_reason: string | null;
  risk_event_count: number;
}

export interface AdminProfileSummary {
  id: string;
  user_id: string;
  kind: UserGameAccountKind;
  display_name: string;
  note: string;
  permission: Permission;
  status: AppUserStatus;
  cdk_order_hash?: string | null;
  skland_binding: {
    uid: string;
    nickname: string;
    channel_name: string;
    bound_at: string;
    last_imported_at: string | null;
  } | null;
  skland_pending_binding: {
    uid: string;
    nickname: string;
    channel_name: string;
    operator_count: number;
    created_at: string;
    expires_at: string;
  } | null;
  skland_risk: {
    uid_mismatch_count: number;
    last_mismatch_uid: string | null;
    last_mismatch_nickname: string | null;
    last_mismatch_at: string | null;
  } | null;
  operator_count: number;
  created_at: string;
  updated_at: string;
  workspace: AdminWorkspaceSummary;
  cdk: AdminLinkedCdkSummary | null;
}

export interface AdminUserDetail {
  user: AppUserSummary;
  profiles: AdminProfileSummary[];
}

export interface AdminProfileOperatorData {
  user: {
    id: string;
    email: string;
  };
  profile: {
    id: string;
    display_name: string;
    kind: UserGameAccountKind;
    status: AppUserStatus;
    permission: Permission;
    skland_binding: {
      uid: string;
      nickname: string;
      channel_name: string;
      bound_at: string;
      last_imported_at: string | null;
    } | null;
    workspace_updated_at: string | null;
  };
  operators: LicenseOperator[];
  total_operator_records: number;
  owned_operator_count: number;
  generated_at: string;
}

export const EMPTY_ANNOUNCEMENTS: Announcement[] = []

export const EMPTY_ANNOUNCEMENT_REACH_STATS: AnnouncementReachStats = {
  impressions: 0,
  reads: 0,
  server_reads: 0,
  local_reads: 0,
  unread: 0,
  read_rate: 0,
}

export const DEFAULT_RISK_SETTINGS: RiskControlSettings = {
  operator_data_risk_enabled: productPolicies.risk.operator_data_enabled_by_default,
  updated_at: null,
}

export const permissionLabels = new Proxy({} as Record<Permission, string>, {
  get: (_target, permission: string) => getPermissionProfile(permission as Permission).label,
})

export const statusLabels: Record<CdkStatus, string> = {
  unused: '未使用',
  used: '已使用',
  frozen: '已冻结',
  revoked: '已撤销',
}

export const appUserStatusLabels: Record<AppUserStatus, string> = {
  active: '正常',
  frozen: '已冻结',
  revoked: '已撤销',
}

export const sectionLabels: Record<AdminSection, string> = {
  overview: '总览',
  queue: '异步队列',
  cdk: 'CDK',
  risk: '风控',
  registration: copy.admin.registration_nav,
  invitation: '邀请设置',
  announcement: '公告管理',
  users: '用户维护',
}

export const announcementKindLabels: Record<AnnouncementKind, string> = {
  banner: '横幅',
  popup: '弹出式公告',
}

export const announcementSortLabels: Record<AnnouncementSortKey, string> = {
  updated_desc: '更新时间新到旧',
  updated_asc: '更新时间旧到新',
  kind: '公告类型',
  active: '启用状态',
}

export const cdkProductPermissions: GeneratedPermission[] = listAdminIssuablePermissions()

export const MAX_CDK_BATCH_COUNT = 100

export const cdkProductPermissionRank = Object.fromEntries(
  cdkProductPermissions.map((permission) => [permission, getPermissionRank(permission)]),
) as Record<GeneratedPermission, number>
