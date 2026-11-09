import { routesCopy } from '../copy/zh-CN/routes'
import { adminCopy } from '../copy/zh-CN/admin'

export const operationsPageLabels = routesCopy.labels
export type OperationsPage = keyof typeof operationsPageLabels

export const operationsToolLabels = adminCopy.operations_tools
export type OperationsTool = keyof typeof operationsToolLabels

export interface OperationsToolStats {
  tool: OperationsTool
  users: number
  anonymous_visitors: number
  attempts: number
  successful: number
  failed: number
  cancelled: number
  success_rate: number | null
  latency_samples: number
  p50_ms: number | null
  p95_ms: number | null
}

export interface OperationsToolsOverview {
  tracking_started_at: string | null
  pages: Array<{ page: OperationsPage; visitors: number; views: number }>
  current: OperationsToolStats[]
  previous: OperationsToolStats[]
}
