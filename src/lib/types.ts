// 干员数据（license 中的）
export interface LicenseOperator {
  id: string;
  name: string;
  own: boolean;
  elite: number;
  rarity: number;
  [key: string]: unknown;
}

// 配置数据
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

// License 文件结构（解密后）
export interface LicenseFile {
  version: number;
  order_hash: string;
  operators: LicenseOperator[];
  config: LicenseConfig;
  issued_at: string;
  sig: string;
}

// 用户态覆盖（仅 elite）
export interface ClientState {
  operator_elite_overrides: Record<string, number>;
  updated_at: string;
  client_sig: string;
}

// Workfile 结构（解密后）
export interface WorkFile {
  license: LicenseFile;
  client_state: ClientState;
}

// 优化请求参数
export interface OptimizeRequest {
  operators: LicenseOperator[];
  config: LicenseConfig;
  ignore_elite: boolean;
}

// 排班结果
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
  rooms: RoomAssignment[];
}

export interface RoomAssignment {
  room: string;
  operators: string[];
  efficiency: number;
  product?: string;
}

// 升级建议
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

// 应用状态
export type AppStep = 'upload' | 'optimize';
