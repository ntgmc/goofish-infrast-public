export const ADMIN_AUDIT_SOURCES = ['admin', 'inventory', 'risk_review', 'risk_access', 'risk_settings', 'registration', 'commercial', 'balance'] as const
export type AdminAuditSource = typeof ADMIN_AUDIT_SOURCES[number]

export interface AdminAuditRecord {
  source: AdminAuditSource
  id: string
  actor_username: string | null
  action: string
  target_type: string
  target_id: string
  reason: string
  request_id: string | null
  created_at: string
}

export interface AdminAuditPage {
  items: AdminAuditRecord[]
  pagination: { page: number; page_size: number; total: number; total_pages: number }
}

export interface AdminAuditDetail extends AdminAuditRecord {
  client_ip: string | null
  before_json: unknown
  after_json: unknown
  context_json: unknown
}

export interface AdminAuditFilters {
  actor?: string
  from?: string
  to?: string
  action?: string
  target_type?: string
  target_id?: string
  request_id?: string
  related_source?: AdminAuditSource
  related_id?: string
}
