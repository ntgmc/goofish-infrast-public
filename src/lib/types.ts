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
  trading_stations_count: number;
  manufacturing_stations_count: number;
  product_requirements: {
    trading_stations: Record<string, number>;
    manufacturing_stations: Record<string, number>;
  };
  Fiammetta?: { enable: boolean };
  drones?: {
    enable: boolean;
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

export interface OptimizeRequest {
  operators: LicenseOperator[];
  config: LicenseConfig;
  ignore_elite: boolean;
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
  buildingType: number;
  planTimes: string;
  plans: ShiftPlan[];
  raw_results: AssignmentResult[];
}

export interface ShiftPlan {
  name: string;
  description?: string;
  rooms: Record<string, { operators?: string[]; product?: string; efficiency?: number; autofill?: boolean }[]>;
  Fiammetta?: { enable: boolean; target: string; order: string };
  drones?: { enable: boolean; room: string; index: number; order: string };
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
