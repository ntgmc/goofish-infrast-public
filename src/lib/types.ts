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
    order: string;
    targets: string[];
  };
  [key: string]: unknown;
}

export type PermissionMode = 'basic' | 'premium' | 'admin';

export interface LicenseFile {
  version: number;
  order_hash: string;
  operators: LicenseOperator[];
  config: LicenseConfig;
  permission?: PermissionMode;
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

export interface OptimizeRequest {
  license: LicenseFile;
  operators: LicenseOperator[];
  config: LicenseConfig;
  ignore_elite: boolean;
  include_current?: boolean;
  suggestions_only?: boolean;
  upgrade_task_payload?: UpgradeTaskPayload;
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
  buildingType: number;
  planTimes: string;
  plans: ShiftPlan[];
  raw_results: AssignmentResult[];
  daily_production?: DailyProduction;
  total_efficiency?: number;
  upgrade_suggestions?: RawUpgradeSuggestion[];
  current_result?: OptimizeResult;
  upgrade_task_payload?: UpgradeTaskPayload;
  build_meta?: AppBuildMeta;
}

export type RawUpgradeSuggestion =
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
    trigger_operators?: string[];
    work_hours_to_zero?: number | null;
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
  rooms: Record<string, ShiftRoom[]>;
  Fiammetta?: {
    enable: boolean;
    requested?: boolean;
    available?: boolean;
    target: string;
    order: string;
    status?: string;
    reason?: string;
  };
  drones?: DroneAssignment;
  mood_valid?: boolean;
  mood_errors?: Record<string, unknown>[];
  mood_assumptions?: {
    max_mood?: number;
    shift_hours?: number;
    resting_operator_recovers_full?: boolean;
    fiammetta_target_recovers_full?: boolean;
  };
}

export interface UpgradeSuggestion {
  type: 'single' | 'bundle';
  id?: string;
  name?: string;
  ops?: { id: string; name: string; current_elite: number; target_elite: number }[];
  gain: number;
  current_elite?: number;
  target_elite?: number;
  desc?: string;
}

export type AppStep = 'upload' | 'optimize';
