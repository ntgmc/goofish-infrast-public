export interface LicenseOperator {
  id: string;
  name: string;
  own: boolean;
  elite: number;
  rarity: number;
  [key: string]: unknown;
}

export type IntermediateProduct = 'Originium Shard' | 'Pure Gold' | 'Orirock Cube';
type IntermediateInventory = Partial<Record<IntermediateProduct, number>>;

export interface LicenseConfig {
  layout: string;
  desc: string;
  schedule_mode?: 'maa' | 'rotation' | 'variable' | string;
  dormitory_rule?: 'fixed' | 'maa_autofill' | string;
  shift_hours?: number[] | string;
  trading_stations_count: number;
  manufacturing_stations_count: number;
  product_requirements: {
    trading_stations: Record<string, number>;
    manufacturing_stations: Record<string, number>;
  };
  Fiammetta?: { enable: boolean; candidate_mode?: string };
  optimization_mode?: 'fast' | 'exact' | 'exhaustive' | string;
  optimizer_search?: {
    optimization_mode?: 'fast' | 'exact' | 'exhaustive' | string;
    beam?: boolean;
    candidate_limit?: number;
    beam_width?: number;
    trace_search?: boolean;
    trace_dynamic_rules?: boolean;
    trace_candidates?: boolean;
  };
  drones?: {
    enable: boolean;
    auto?: boolean;
    auto_strategy?: string;
    auto_target_product?: string;
    order: string;
    targets: string[];
  };
  orundum_planning?: {
    daily_sanity_budget?: number;
    monthly_card?: boolean;
  };
  variable_shift_schedule?: {
    enable?: boolean;
    enabled?: boolean;
    max_shifts?: number;
    shift_step_minutes?: number;
    min_low_hours?: number;
    beam_width?: number;
    trace_variable_shifts?: boolean;
    trace_mood_cycle?: boolean;
  };
  intermediate_inventory?: IntermediateInventory;
  auto_balance_source?: string;
  [key: string]: unknown;
}


export interface IntermediateDepletion {
  product: IntermediateProduct;
  stock: number;
  net_per_day: number;
  days_remaining: number | null;
}

export interface OrundumEconomy {
  daily_sanity_budget: number;
  monthly_card: boolean;
  total_daily_sanity_budget: number;
  daily_orirock_supply: number;
  rock_limited_orundum: number;
  factory_orundum_capacity: number;
  trade_orundum_capacity: number;
  sustainable_orundum: number;
  short_term_orundum: number;
  case: 'capacity_limited' | 'budget_limited' | 'inventory_burst';
  bottleneck: 'orirock_budget' | 'manufacture' | 'trading' | 'inventory';
  hard_lmd_cost: number;
  inventory_depletion_days: number | null;
  shard_inventory_depletion_days: number | null;
  orirock_inventory_depletion_days: number | null;
  opportunity_cost_sanity: number;
  opportunity_lmd_equivalent: number;
}

export interface OrundumRoi {
  case: OrundumEconomy['case'];
  daily_orundum_gain: number;
  sustainable_orundum_gain: number;
  monthly_pulls_gain: number;
  opportunity_cost_delta: number;
  opportunity_lmd_equivalent_delta: number;
  inventory_depletion_days_delta: number | null;
}

type LegacyPermissionMode = 'basic' | 'premium';
export type ProductPermissionMode = 'recommended' | 'growth' | 'advanced' | 'ultimate';
type InternalPermissionMode = 'admin';
export type RawPermissionMode = LegacyPermissionMode | ProductPermissionMode | InternalPermissionMode;
export type PermissionMode = ProductPermissionMode | InternalPermissionMode;
export type UserGameAccountKind = 'cdk' | 'free_preview' | 'depot_value';

export interface LicenseFile {
  version: 1 | 2;
  order_hash: string;
  operators: LicenseOperator[];
  config: LicenseConfig;
  permission?: RawPermissionMode;
  issued_at: string;
  sig: string;
}

export interface AppBuildMeta {
  frontend_version: string;
  backend_version: string;
  data_version: string;
  generated_at: string;
  source_summary: string;
  git_sha?: string | null;
  build_context?: string;
}

export type AnnouncementKind = 'banner' | 'popup';

export interface Announcement {
  id: string;
  kind: AnnouncementKind;
  active: boolean;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementPublicResponse {
  banner: Announcement | null;
  popups: Announcement[];
  announcements: Announcement[];
}

export interface AnnouncementStats {
  impressions: number;
  reads: number;
  server_reads: number;
  local_reads: number;
  unread: number;
  read_rate: number;
}

export interface AnnouncementAdminResponse {
  banner: Announcement | null;
  announcements: Announcement[];
  stats?: Record<string, AnnouncementStats>;
}

export type OptimizeJobPriority = 'priority_coupon' | 'paid' | 'analysis' | 'standard';
type OptimizeJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'dead_lettered';
export type OptimizeEstimateBucket =
  | 'maa_fiammetta'
  | 'maa_fiammetta_with_suggestions'
  | 'maa_plain'
  | 'maa_plain_with_suggestions'
  | 'rotation'
  | 'rotation_with_suggestions'
  | 'scenario_comparison';
export type OptimizeEstimateSource = 'history_p95' | 'fallback_p95';
type OptimizeRuntimeEstimatePhase = 'queued' | 'running' | 'overdue' | 'completed' | 'failed' | 'cancelled';
export type OptimizeCalculationStage =
  | 'starting'
  | 'generating_schedule'
  | 'generating_potential_schedule'
  | 'simulating_upgrades'
  | 'enriching_training_costs'
  | 'simulating_maa_baseline'
  | 'formatting_result'
  | 'persisting_result'
  | 'completed';

export interface OptimizeJobAccepted {
  job_id: string;
  status: 'queued' | 'running';
  priority: OptimizeJobPriority;
  priority_label: string;
  queue_position: number | null;
  submitted_at: string;
  poll_after_ms: number;
  estimated_duration_ms: number;
  estimate_bucket: OptimizeEstimateBucket;
  estimate_source: OptimizeEstimateSource;
  estimate_sample_count: number;
  estimated_remaining_ms: number | null;
  estimated_total_ms: number | null;
  estimate_phase: OptimizeRuntimeEstimatePhase;
  estimate_updated_at: string;
  calculation_stage: OptimizeCalculationStage | null;
  calculation_stage_updated_at: string | null;
  upgrade_suggestions_requested: boolean;
  upgrade_suggestions_allowed: boolean;
  poll_token?: string;
}

export interface OptimizeJobStatusResponse {
  job_id: string;
  status: OptimizeJobStatus;
  priority: OptimizeJobPriority;
  priority_label: string;
  queue_position: number | null;
  submitted_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  poll_token?: string;
  poll_after_ms: number;
  estimated_duration_ms: number;
  estimate_bucket: OptimizeEstimateBucket;
  estimate_source: OptimizeEstimateSource;
  estimate_sample_count: number;
  estimated_remaining_ms: number | null;
  estimated_total_ms: number | null;
  estimate_phase: OptimizeRuntimeEstimatePhase;
  estimate_updated_at: string;
  calculation_stage: OptimizeCalculationStage | null;
  calculation_stage_updated_at: string | null;
  upgrade_suggestions_requested: boolean;
  upgrade_suggestions_allowed: boolean;
  result?: OptimizeResult;
  error?: string;
  error_code?: string;
  error_retryable?: boolean;
  recovery_action?: 'retry' | 'review_input' | 'reauthorize' | 'contact_support' | 'none';
  support_reference?: string;
  failure_kind?: string;
  job_kind?: 'schedule' | 'scenario_comparison' | 'reorder_check';
  source?: string;
  execution_phase?: 'initial_queue' | 'retry_wait' | 'executing' | 'settling' | 'terminal';
  attempt_count?: number;
  failure_count?: number;
  next_attempt_at?: string | null;
  cancellation_requested?: boolean;
  can_cancel?: boolean;
  can_retry?: boolean;
}

export type DepotValueSource = 'upload' | 'skland';

export type DepotValueRequest =
  | {
      source: 'upload';
      inventory: unknown;
    }
  | {
      source: 'skland';
      profile_id: string;
    };

export interface DepotValueItem {
  id: string;
  name: string;
  count: number;
  unit_sanity: number;
  equivalent_sanity: number;
}

export interface DepotValueUnpricedItem {
  id: string;
  name: string;
  count: number;
}

type DepotValueRankingMode = 'curve' | 'sample_adjusted';
export type DepotValueSampleContributionStatus = 'saved' | 'not_applicable' | 'unavailable';

export interface DepotValueRanking {
  mode: DepotValueRankingMode;
  sample_count: number;
  sample_weight: number;
  curve_percentile: number;
  sample_percentile: number | null;
  contribution_status: DepotValueSampleContributionStatus;
}

export interface DepotValueResponse {
  source: DepotValueSource;
  item_count: number;
  priced_count: number;
  unpriced_count: number;
  total_equivalent_sanity: number;
  percentile: number;
  ranking: DepotValueRanking;
  top_items: DepotValueItem[];
  unpriced_items: DepotValueUnpricedItem[];
  warnings: string[];
  sources: {
    inventory: DepotValueSource;
    yituliu: 'ok' | 'unavailable';
    lmd_exp: 'fixed_lmd_exp_36_per_10000';
    ranking: 'entertainment_curve_v1' | 'sample_adjusted_curve_v1';
  };
  generated_at: string;
  build_meta: AppBuildMeta;
}

interface AssignmentResult {
  total_efficiency: number;
  assignment_detail: AssignmentDetail[];
}

interface AssignmentDetail {
  rule: string;
  ops: string[];
  eff: number;
  workplace: string;
  product?: string;
}

export interface OptimizeResult {
  author: string;
  title: string;
  description: string;
  schedule_mode?: string;
  schedule_mode_name?: string;
  dormitory_rule?: 'fixed' | 'maa_autofill' | string;
  dormitory_rule_name?: string;
  rotation_mode?: {
    queue_count: number;
    quick_switch: true;
    training_policy: 'assume_not_training';
    shift_hours_per_queue?: number;
    daily_production_normalized_hours?: number;
    total_cycle_hours?: number;
    suppress_total_efficiency?: false;
  };
  shift_hours?: number[];
  shift_pattern?: string;
  total_schedule_hours?: number;
  fiammetta_target_slots?: number[];
  buildingType: number;
  planTimes: string;
  plans: ShiftPlan[];
  raw_results: AssignmentResult[];
  daily_production?: DailyProduction;
  total_efficiency?: number;
  raw_total_efficiency?: number;
  optimization_mode?: 'fast' | 'exact' | 'exhaustive' | string;
  optimality?: 'global_within_candidate_set' | 'bounded_candidate_optimum' | 'approximate' | string;
  search_nodes?: number;
  pruned_nodes?: number;
  candidate_count?: number;
  elapsed_ms?: number;
  search_space_size?: string;
  optimal_objective_value?: number;
  cache_key?: string;
  job_recommended?: boolean;
  cross_shift_trace?: Record<string, unknown>[];
  bounded_incumbent_source?: 'fast_beam';
  bounded_incumbent_daily_score?: number;
  discarded_exact_daily_score?: number;
  maa_default_comparison?: MaaDefaultComparison;
  orundum_economy?: OrundumEconomy;
  intermediate_depletion?: IntermediateDepletion[];
  upgrade_suggestions?: RawUpgradeSuggestion[];
  upgrade_suggestions_status?: 'completed' | 'partial' | 'not_requested' | 'not_allowed' | 'failed';
  upgrade_suggestions_candidate_count?: number;
  upgrade_suggestions_evaluated_count?: number;
  upgrade_suggestions_truncated_reason?: 'deadline_budget' | 'simulation_limit';
  preview_limit?: {
    mode?: 'room_limited' | 'full_rotation_without_export';
    room_limit?: number;
    hidden_room_count: number;
    notice: string;
    free_schedule_entitlement?: FreeScheduleEntitlement;
  };
  build_meta?: AppBuildMeta;
}

type FreeScheduleEntitlementLockReason = 'confirmed' | 'revision_limit' | 'window_expired';

export interface FreeScheduleEntitlement {
  first_generated_at: string | null;
  revision_count: number;
  revision_limit: 3;
  revision_window_hours: 24;
  confirmed_at: string | null;
  locked_at: string | null;
  lock_reason: FreeScheduleEntitlementLockReason | null;
  strong_reorder_bonus: {
    month: string;
    granted_at: string;
    used_at: string | null;
  } | null;
}

type ReorderCheckRecommendation = 'no_need' | 'recommended' | 'strongly_recommended';

export interface ReorderCheckResult {
  recommendation: ReorderCheckRecommendation;
  estimated_gain_range: {
    min: number | null;
    max: number | null;
    unit: 'equivalent_sanity_per_day' | 'room_change_only';
    label: string;
  };
  changed_room_count: number;
  affected_facility_types: string[];
  key_operators: {
    id?: string;
    name: string;
    reason: 'newly_used' | 'core_combo_changed';
    occurrence_count: number;
  }[];
  current_plan_usable: boolean;
  quota: {
    limit: 2;
    used: number;
    remaining: number;
    reset_at: string;
    timezone: 'Asia/Shanghai';
  };
  baseline: {
    history_id: string;
    created_at: string;
    name: string;
  };
  free_schedule_entitlement?: FreeScheduleEntitlement;
  reasons: string[];
  build_meta?: AppBuildMeta;
}

export interface UpgradeTrainingMaterial {
  id: string;
  name: string;
  count: number;
  rarity?: number;
  sortId?: number;
  equivalent_sanity?: number | null;
}

export interface UpgradeTrainingCostBucket {
  cash: number;
  exp: number;
  materials: UpgradeTrainingMaterial[];
  equivalent_sanity: number | null;
}

interface UpgradeTrainingOperatorCost {
  id: string;
  name: string;
  current_elite: number;
  target_elite: number;
  current_level: number;
  target_level: number;
  totals: UpgradeTrainingCostBucket;
  missing: UpgradeTrainingCostBucket;
  warnings: string[];
}

export interface UpgradeTrainingCost {
  status: 'available' | 'partial' | 'unavailable';
  target?: {
    id: string;
    name: string;
    current_elite: number;
    target_elite: number;
  };
  totals: UpgradeTrainingCostBucket;
  available?: UpgradeTrainingCostBucket;
  missing: UpgradeTrainingCostBucket;
  equivalent_sanity: number | null;
  unpriced_items: UpgradeTrainingMaterial[];
  sources: {
    skland: 'ok' | 'unavailable';
    yituliu: 'ok' | 'unavailable';
    lmd_exp: 'fixed_lmd_trade_gold_net_exp_36_per_10000';
  };
  warnings: string[];
  operators: UpgradeTrainingOperatorCost[];
}

export interface UpgradeImpactRoom {
  room_name: string;
  room_type: string;
  product: string;
  rule_description: string;
  operators: string[];
  missing_operators: string[];
  estimated_gain: number;
}

export interface UpgradeImpact {
  rooms: UpgradeImpactRoom[];
  summary?: string;
}

export interface UpgradeSuggestionRoi {
  efficiency_gain: number;
  daily_sanity_gain: number | null;
  payback_days: number | null;
  payback_basis: 'missing_sanity';
  unavailable_reason?: string;
}

export interface UpgradePartialOutcome {
  missing_operator: { id?: string; name: string; current?: number; target?: number };
  remaining_ops: { id?: string; name: string; current?: number; target?: number }[];
  efficiency_gain: number;
  daily_sanity_gain: number | null;
  has_benefit: boolean;
  rooms: string;
}

type RawUpgradeSuggestion = (
  | {
      type: 'single';
      id?: string;
      name: string;
      current: number;
      target: number;
      gain: number;
      rooms?: string;
      specialType?: string;
    }
  | {
      type: 'bundle';
      ops: { id?: string; name: string; current: number; target: number }[];
      gain: number;
      rooms?: string;
      specialType?: string;
    }
) & {
  training_cost?: UpgradeTrainingCost;
  roi?: UpgradeSuggestionRoi;
  orundum_roi?: OrundumRoi;
  impact?: UpgradeImpact;
  partial_outcomes?: UpgradePartialOutcome[];
  partial_outcomes_truncated?: boolean;
  partial_outcomes_unavailable_reason?: string;
};

interface RoomOverflow {
  equivalent?: {
    equivalent_efficiency?: number;
    equivalent_efficiency_delta?: number;
    manufacturing_equivalent_efficiency?: number;
    [key: string]: unknown;
  };
  final_efficiency?: number;
  speed_efficiency?: number;
  display_efficiency?: number;
  speed_efficiency_adjusted?: boolean;
  expected_order_time?: string;
  time?: string;
  strategy?: string;
  [key: string]: unknown;
}

export interface ShiftRoom {
  operators?: string[];
  product?: string;
  efficiency?: number;
  final_efficiency?: number;
  overflow?: RoomOverflow;
  dynamic_resources?: Record<string, number>;
  dynamic_resource_details?: Record<string, unknown>[];
  mood?: Record<string, {
    start?: number;
    cost_per_hour?: number;
    consumed?: number;
    end?: number;
    red_face?: boolean;
  }>;
  rotation?: {
    queue_index?: number;
    trigger_operators?: string[];
    work_hours_to_zero?: number | null;
    sync_valid?: boolean;
    sync_group?: string;
    training_policy?: 'assume_not_training';
  };
  autofill?: boolean;
}

export interface DroneAssignment {
  enable: boolean;
  room: string;
  index: number;
  order: string;
  mode?: 'auto' | 'manual';
  product?: string;
  efficiency?: number;
  display_efficiency?: number;
  candidate_count?: number;
  reason?: string;
}

export interface DailyProduction {
  hours?: number;
  source_hours?: number;
  normalization_factor?: number;
  shift_hours?: number[];
  manufacturing?: Record<string, number>;
  trading?: Record<string, number>;
  consumption?: Record<string, number>;
  net?: Record<string, number>;
  drones?: Record<string, number>;
  dynamic_resources?: Record<string, number>;
  dynamic_resource_details?: Record<string, unknown>[];
  details?: Record<string, unknown>[];
}

interface DailyProductionDelta {
  total_efficiency: number;
  raw_total_efficiency: number;
  manufacturing: Record<string, number>;
  trading: Record<string, number>;
  consumption: Record<string, number>;
  net: Record<string, number>;
  drones: Record<string, number>;
}

interface MaaDefaultComparison {
  source: 'maa_default_simulation_v1';
  simulation: {
    algorithm: 'maa_default_room_local_greedy_v1' | string;
    facility_order: string[];
    drones: 'Money' | string;
    shift_hours: number[];
  };
  baseline: {
    daily_production: DailyProduction;
    total_efficiency: number;
    raw_total_efficiency: number;
    plan_count: number;
    room_count: number;
  };
  delta: DailyProductionDelta;
  orundum_economy?: {
    current: OrundumEconomy;
    baseline: OrundumEconomy;
    delta: OrundumRoi;
  };
  warnings: string[];
}

interface ShiftPlan {
  name: string;
  description?: string;
  schedule_mode?: string;
  shift_hours?: number;
  rooms: Record<string, ShiftRoom[]>;
  Fiammetta?: {
    enable: boolean;
    requested?: boolean;
    available?: boolean;
    target: string;
    target_slot?: boolean;
    order: string;
    status?: string;
    reason?: string;
    mood_recovery?: Record<string, unknown>;
  };
  drones?: DroneAssignment;
  dynamic_resources?: Record<string, number>;
  dynamic_resource_details?: Record<string, unknown>[];
  mood_valid?: boolean;
  mood_errors?: Record<string, unknown>[];
    mood_assumptions?: {
      max_mood?: number;
      shift_hours?: number;
      resting_operator_recovers_full?: boolean;
      cyclic_mood_simulation?: boolean;
      cyclic_mood_simulation_iterations?: number;
      cyclic_mood_simulation_delta?: number;
      fiammetta_target_recovers_full?: boolean;
      dormitory_recovery_calculated?: boolean;
    dormitory_default_level?: number;
    dormitory_default_ambience?: number;
  };
}

export interface UpgradeSuggestion {
  type: 'single' | 'bundle';
  id?: string;
  name?: string;
  ops?: { id?: string; name: string; current?: number; target?: number; current_elite?: number; target_elite?: number }[];
  gain: number;
  rooms?: string;
  specialType?: string;
  current_elite?: number;
  target_elite?: number;
  current?: number;
  target?: number;
  desc?: string;
  training_cost?: UpgradeTrainingCost;
  roi?: UpgradeSuggestionRoi;
  orundum_roi?: OrundumRoi;
  impact?: UpgradeImpact;
  partial_outcomes?: UpgradePartialOutcome[];
  partial_outcomes_truncated?: boolean;
  partial_outcomes_unavailable_reason?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  permission: PermissionMode;
  status: 'active' | 'frozen' | 'revoked' | 'pending_deletion';
  cdk_status: string;
  cdk_order_hash: string | null;
  created_at: string;
}

export type SklandCredentialStatus = 'available' | 'invalid';
export type SklandCredentialInvalidReason = 'expired_or_revoked' | 'credential_format_invalid';

interface SklandPublicBinding {
  uid: string;
  nickname: string;
  channel_name: string;
  bound_at: string;
  last_imported_at: string | null;
  credential_status: SklandCredentialStatus;
  credential_invalid_at: string | null;
  credential_invalid_reason: SklandCredentialInvalidReason | null;
}

export interface UserGameAccount {
  id: string;
  user_id: string;
  kind: UserGameAccountKind;
  permission: PermissionMode;
  trial?: FreePreviewTrial | null;
  status: 'active' | 'frozen' | 'revoked';
  cdk_order_hash: string | null;
  display_name: string;
  note: string;
  skland_binding?: SklandPublicBinding | null;
  operator_count: number;
  updated_at: string | null;
  created_at: string;
}

export interface TemporaryProfilePermission {
  source: 'limited_profile_voucher';
  activity_id: string;
  permission: 'advanced';
  starts_at: string;
  ends_at: string;
  operation_id: string;
}

export interface FreePreviewTrial {
  id: string;
  starts_at: string;
  ends_at: string;
  active: boolean;
  effective_permission: 'advanced' | null;
}

export interface UserWorkspace {
  profile_id: string | null;
  operators: LicenseOperator[] | null;
  config: LicenseConfig | null;
  elite_overrides: Record<string, number>;
  last_result: OptimizeResult | null;
  saved_configs: WorkspaceSavedConfig[];
  result_history: WorkspaceResultHistoryItem[];
  archived_results: WorkspaceResultHistoryItem[];
  free_schedule_entitlement: FreeScheduleEntitlement | null;
  updated_at: string | null;
}

export interface WorkspaceSavedConfig {
  id: string;
  name: string;
  config: LicenseConfig;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  read_only?: boolean;
}

type WorkspaceResultHistorySource = 'generated' | 'applied_suggestions' | 'legacy';

export interface WorkspaceResultHistoryItem {
  id: string;
  name: string;
  created_at: string;
  config: LicenseConfig | null;
  result: OptimizeResult;
  operator_count: number;
  source: WorkspaceResultHistorySource;
}

export type WorkspaceSavedConfigAction =
  | { type: 'save'; id?: string; name: string; config: LicenseConfig }
  | { type: 'rename'; id: string; name: string }
  | { type: 'delete'; id: string }
  | { type: 'touch'; id: string };

export interface UserAnnouncementRead {
  announcement: Announcement;
  read_at: string | null;
}

export interface UserNotificationItemGrantDetail {
  item_code: string;
  name: string;
  icon_key: string;
  quantity: number;
  expires_at: string | null;
}

export type UserNotificationPayload = {
  kind: 'item_grant';
  items: UserNotificationItemGrantDetail[];
};

export interface UserNotification {
  id: string;
  type: 'item_grant';
  title: string;
  body: string;
  action: { kind: 'inventory' } | null;
  payload: UserNotificationPayload;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserNotificationPage {
  notifications: UserNotification[];
  unread_count: number;
  next_cursor: string | null;
}

export interface AuthMeResponse {
  user: AuthUser | null;
  profiles?: UserGameAccount[];
  active_profile?: UserGameAccount | null;
  workspace: UserWorkspace | null;
  announcement_unread_count?: number;
}

export interface AuthSuccessResponse {
  user: AuthUser;
  profiles: UserGameAccount[];
  active_profile: UserGameAccount | null;
  workspace: UserWorkspace | null;
  announcement_unread_count?: number;
}

export type InvitationRewardRecipient = 'inviter' | 'invitee';

export type InvitationExpiryPolicy =
  | { mode: 'never' }
  | { mode: 'relative_days'; days: number };

type InvitationItemKind = 'consumable' | 'capacity_upgrade' | 'gift_pack';

export interface InvitationRewardRule {
  recipient: InvitationRewardRecipient;
  item_code: string;
  quantity: number;
  expiry: InvitationExpiryPolicy;
  gift_pack_version_id: string | null;
}

export interface InvitationSettings {
  version: 2;
  enabled: boolean;
  activation_rule: 'first_active_profile';
  daily_inviter_reward_limit: number;
  rewards: InvitationRewardRule[];
  updated_at: string | null;
}

export type BrevoQuotaAction = 'pause_registration' | 'allow_unverified_registration';

export type BrevoEmailPurpose =
  | 'email_verification'
  | 'admin_invite_verification'
  | 'password_reset'
  | 'account_deletion_cancellation'
  | 'account_deletion_receipt';

export interface BrevoEmailDailyStat {
  date: string;
  sent_count: number;
  reserved_count: number;
  uncertain_count: number;
  failed_count: number;
  local_quota_used_count: number;
  quota_used_count: number;
  remaining_count: number;
  limit_reached: boolean;
  by_purpose: Record<BrevoEmailPurpose, number>;
}

export interface BrevoOfficialQuotaStatus {
  status: 'fresh' | 'stale' | 'unavailable';
  reported_remaining_count: number | null;
  reported_used_count: number | null;
  external_used_offset: number;
  synced_at: string | null;
  last_attempt_at: string | null;
}

export interface BrevoEmailStats {
  timezone: 'UTC';
  daily_limit: number;
  official_quota: BrevoOfficialQuotaStatus;
  today: BrevoEmailDailyStat;
  days: BrevoEmailDailyStat[];
}

export interface RegistrationSettings {
  version: 4;
  email_verification_required: boolean;
  invite_code_required: boolean;
  brevo_quota_action: BrevoQuotaAction;
  admin_invite_email_reserve: number;
  password_reset_email_reserve: number;
  updated_at: string | null;
}

export type AdminRegistrationInvitationStatus = 'active' | 'used' | 'revoked' | 'expired';

export interface AdminRegistrationInvitation {
  id: string;
  status: AdminRegistrationInvitationStatus;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  consumed_by_user_id: string | null;
  consumed_by_email: string | null;
}

export interface InvitationSummary {
  can_invite: boolean;
  campaign_enabled: boolean;
  code: string | null;
  share_url: string | null;
  reward_preview: {
    inviter: InvitationRewardPreviewItem[];
    invitee: InvitationRewardPreviewItem[];
  };
  stats: {
    registered: number;
    activated: number;
    rewarded_invitations: number;
    today_rewarded: number;
  };
  daily_limit: {
    used: number;
    limit: number;
    remaining: number;
    reset_at: string;
  };
  records: InvitationRecordSummary[];
  next_cursor: string | null;
}

export interface RewardBalance {
  type: 'priority_compute_coupon';
  available: number;
  permanent: number;
  next_expiry_at: string | null;
}

export interface InvitationGiftPackSummary {
  id: string;
  version: number;
  status: 'published' | 'retired';
  contents: Array<{
    item_code: string;
    name: string;
    quantity: number;
    expiry: InvitationExpiryPolicy;
  }>;
}

export interface InvitationRewardCatalogItem {
  item_code: string;
  name: string;
  description: string;
  kind: InvitationItemKind;
  icon_key: string;
  issuance_enabled: boolean;
  selectable: boolean;
  unavailable_reason: string | null;
  latest_gift_pack_version: InvitationGiftPackSummary | null;
}

export interface AdminInvitationSettingsResponse {
  settings: InvitationSettings;
  catalog: InvitationRewardCatalogItem[];
  configured_gift_pack_versions: InvitationGiftPackSummary[];
}

export interface InvitationRewardPreviewItem {
  item_code: string;
  name: string;
  description: string;
  kind: InvitationItemKind;
  icon_key: string;
  quantity: number;
  expiry: InvitationExpiryPolicy;
  gift_pack_version: InvitationGiftPackSummary | null;
  available: boolean;
}

type InvitationProgressStatus = 'registered' | 'activated' | 'settled';
export type InviterRewardStatus =
  | 'pending_activation'
  | 'pending_campaign_resume'
  | 'settlement_pending'
  | 'granted'
  | 'daily_limit_skipped'
  | 'inviter_ineligible'
  | 'not_configured';

export interface InvitationRecordSummary {
  id: string;
  invitee_label: string;
  registered_at: string;
  activated_at: string | null;
  status: InvitationProgressStatus;
  inviter_reward_status: InviterRewardStatus;
  inviter_rewards: InvitationRewardPreviewItem[];
}

export type DepotValueProfileResponse = AuthSuccessResponse & {
  depot_profile: UserGameAccount;
};
