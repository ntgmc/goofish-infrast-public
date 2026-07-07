export interface LicenseOperator {
  id: string;
  name: string;
  own: boolean;
  elite: number;
  rarity: number;
  [key: string]: unknown;
}

export interface LicenseConfig {
  layout: string;
  desc: string;
  schedule_mode?: 'maa' | 'rotation' | string;
  dormitory_rule?: 'fixed' | 'maa_autofill' | string;
  shift_hours?: number[] | string;
  trading_stations_count: number;
  manufacturing_stations_count: number;
  product_requirements: {
    trading_stations: Record<string, number>;
    manufacturing_stations: Record<string, number>;
  };
  Fiammetta?: { enable: boolean; candidate_mode?: string };
  drones?: {
    enable: boolean;
    auto?: boolean;
    auto_strategy?: string;
    auto_target_product?: string;
    order: string;
    targets: string[];
  };
  intermediate_inventory?: Record<string, number>;
  auto_balance_source?: string;
  [key: string]: unknown;
}

export type LegacyPermissionMode = 'basic' | 'premium';
export type ProductPermissionMode = 'recommended' | 'growth' | 'advanced' | 'ultimate';
export type InternalPermissionMode = 'admin';
export type RawPermissionMode = LegacyPermissionMode | ProductPermissionMode | InternalPermissionMode;
export type PermissionMode = ProductPermissionMode | InternalPermissionMode;
export type UserGameAccountKind = 'cdk' | 'depot_value';

export interface OperatorUpdateGrant {
  remaining: number;
  granted_at: string | null;
}

export interface LicenseFile {
  version: number;
  order_hash: string;
  operators: LicenseOperator[];
  config: LicenseConfig;
  permission?: RawPermissionMode;
  activation_token?: string | null;
  operator_update_grant?: OperatorUpdateGrant | null;
  issued_at: string;
  sig: string;
}

export interface ClientState {
  operator_elite_overrides: Record<string, number>;
  config_override?: LicenseConfig;
  updated_at: string;
  client_sig: string;
}

export interface WorkFile {
  license: LicenseFile;
  client_state: ClientState;
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

export interface AnnouncementAdminResponse {
  announcements: Announcement[];
}

export interface OptimizeRequest {
  license: LicenseFile;
  operators: LicenseOperator[];
  config: LicenseConfig;
  ignore_elite: boolean;
  profile_id?: string;
  activation_token?: string;
  history_source?: 'generated' | 'applied_suggestions';
  include_current?: boolean;
  suggestions_only?: boolean;
  upgrade_task_payload?: UpgradeTaskPayload;
}

export interface AnalyzeScheduleRequest {
  operators: LicenseOperator[];
  schedule: unknown;
  config?: Partial<LicenseConfig>;
  ignore_elite?: boolean;
}

export interface FreePreviewRequest {
  operators: LicenseOperator[];
  config: LicenseConfig;
}

export interface FreePreviewResult {
  operator_count: number;
  support: {
    supported: boolean;
    label: string;
    reason: string;
  };
  directions: string[];
  potential_range: {
    min: string;
    max: string;
    label: string;
    note: string;
  };
  limited_schedule: {
    plan_name: string;
    plan_count: number;
    room_limit: number;
    hidden_room_count: number;
    rooms: {
      key: string;
      label: string;
      index_label: string;
      product: string;
      operators: string[];
      efficiency: number;
    }[];
  };
  notices: string[];
  build_meta: AppBuildMeta;
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

export type DepotValueRankingMode = 'curve' | 'sample_adjusted';
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

export interface UpgradeTaskPayload {
  tasks: RawUpgradeTask[];
  baselineScore: number;
  currentFiammettaTargets?: string[];
  potentialFiammettaTargets?: string[];
}

export interface RawUpgradeTask {
  bundle: { id?: string; name: string; current: number; target: number }[];
  rule: unknown | null;
  roomName: string;
  estimatedGain: number;
}

export interface AssignmentResult {
  total_efficiency: number;
  assignment_detail: AssignmentDetail[];
}

export interface AssignmentDetail {
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
    suppress_total_efficiency: true;
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
  upgrade_suggestions?: RawUpgradeSuggestion[];
  current_result?: OptimizeResult;
  upgrade_task_payload?: UpgradeTaskPayload;
  analysis_summary?: ScheduleAnalysisSummary;
  build_meta?: AppBuildMeta;
}

export interface ScheduleAnalysisSummary {
  source: 'imported_schedule';
  plan_count: number;
  room_count: number;
  mood_valid: boolean;
  red_face_risk_count: number;
  red_face_operator_count: number;
  red_face_operators: string[];
  risks: {
    shift: string;
    operator: string;
    room_type: string;
    room_index: number;
    start?: number;
    needed?: number;
    end?: number;
  }[];
  overflow: {
    trading_rooms: number;
    manufacturing_rooms: number;
    earliest_trading_full_time?: string;
    earliest_manufacturing_full_time?: string;
  };
  warnings: string[];
}

export type AnalyzeScheduleResult = OptimizeResult & {
  analysis_summary: ScheduleAnalysisSummary;
};

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

export interface UpgradeTrainingOperatorCost {
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

export type RawUpgradeSuggestion = (
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
};

export interface RoomOverflow {
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
  shift_hours?: number[];
  manufacturing?: Record<string, number>;
  trading?: Record<string, number>;
  consumption?: Record<string, number>;
  net?: Record<string, number>;
  drones?: Record<string, number>;
  details?: Record<string, unknown>[];
}

export interface ShiftPlan {
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
  current_elite?: number;
  target_elite?: number;
  current?: number;
  target?: number;
  desc?: string;
  training_cost?: UpgradeTrainingCost;
}

export interface AuthUser {
  id: string;
  email: string;
  permission: PermissionMode;
  status: 'active' | 'frozen' | 'revoked';
  cdk_status: string;
  cdk_order_hash: string | null;
  created_at: string;
}

export type SklandCredentialStatus = 'available' | 'invalid';
export type SklandCredentialInvalidReason = 'expired_or_revoked' | 'credential_format_invalid';

export interface SklandPublicBinding {
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
  status: 'active' | 'frozen' | 'revoked';
  cdk_order_hash: string | null;
  display_name: string;
  note: string;
  skland_binding?: SklandPublicBinding | null;
  operator_count: number;
  updated_at: string | null;
  created_at: string;
}

export interface UserWorkspace {
  profile_id: string | null;
  operators: LicenseOperator[] | null;
  config: LicenseConfig | null;
  elite_overrides: Record<string, number>;
  last_result: OptimizeResult | null;
  saved_configs: WorkspaceSavedConfig[];
  result_history: WorkspaceResultHistoryItem[];
  updated_at: string | null;
}

export interface WorkspaceSavedConfig {
  id: string;
  name: string;
  config: LicenseConfig;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export type WorkspaceResultHistorySource = 'generated' | 'applied_suggestions' | 'legacy';

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

export type DepotValueProfileResponse = AuthSuccessResponse & {
  depot_profile: UserGameAccount;
};

export type AppStep = 'upload' | 'optimize';
