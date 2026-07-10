import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Announcement, AnnouncementAdminResponse, AnnouncementKind, AnnouncementStats as AnnouncementReachStats, LicenseOperator, ProductPermissionMode, RawPermissionMode, UserGameAccountKind } from '../lib/types'
import { apiJson, apiVoid } from '../lib/api-client'

type Permission = RawPermissionMode
type GeneratedPermission = ProductPermissionMode
type CdkStatus = 'unused' | 'used' | 'frozen' | 'revoked'
type AppUserStatus = 'active' | 'frozen' | 'revoked'
type StatusFilter = CdkStatus | 'all'
type PermissionFilter = GeneratedPermission | 'all'
type BinaryFilter = 'all' | 'yes' | 'no'
type AdminSection = 'overview' | 'cdk' | 'risk' | 'announcement' | 'users'
type FieldErrors = Record<string, string>

interface CdkTableFilters {
  status: StatusFilter;
  permission: PermissionFilter;
  bound: BinaryFilter;
  risk: BinaryFilter;
  generated: BinaryFilter;
}

interface GeneratedCdk {
  code: string;
  permission: GeneratedPermission;
  created_at: string;
}

interface AdminCdkCreateResponse {
  code?: string;
  permission?: GeneratedPermission;
  created_at?: string;
  count?: number;
  cdks?: Array<Partial<GeneratedCdk>>;
}

interface AdminCdkRecord {
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
  operator_update_grant_count?: number;
  operator_update_used_count?: number;
  operator_update_grant_remaining?: number;
  operator_update_granted_at?: string | null;
  operator_update_consumed_at?: string | null;
  operator_update_event_count?: number;
  activation_bound?: boolean;
  user_agent_count?: number;
  ip_prefix_count?: number;
  risk_event_count?: number;
  risk_events?: Array<{ at: string; type: string; reason: string; soft_block?: boolean; escalation?: boolean }>;
  latest_risk_event?: { at: string; type: string; reason: string; soft_block?: boolean; escalation?: boolean } | null;
}

interface AdminCdkDetail extends AdminCdkRecord {
  baseline_operator_count?: number | null;
  latest_operator_count?: number | null;
  risk_events?: Array<{ at: string; type: string; reason: string; detail?: Record<string, unknown> | null }>;
  operator_update_events?: Array<{ at: string; operator_count: number }>;
  device_signals?: {
    activation_bound: boolean;
    user_agent_count: number;
    ip_prefix_count: number;
  };
  linked_account?: { account_id: string; profile_id: string } | null;
}

interface UsageTotals {
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

interface UsageDay extends UsageTotals {
  date: string;
}

type UsageRangeKey = '7d' | '14d' | '30d'
type UsageRangeMode = UsageRangeKey | 'custom'
type AnnouncementSortKey = 'updated_desc' | 'updated_asc' | 'kind' | 'active'

interface UsageRange {
  from: string;
  to: string;
  days: number;
}

interface UsageFunnelStep {
  key: string;
  label: string;
  count: number;
  conversion_rate: number;
  dropoff: number;
}

interface UsageFailureReason {
  reason_code: string;
  count: number;
  percentage: number;
  last_seen_at: string | null;
  events?: Record<string, number>;
}

interface UsageFailureSample {
  created_at: string;
  event: string;
  reason_code: string;
  duration_ms: number | null;
  permission: string | null;
  cdk_status: string | null;
  source: string | null;
  has_profile: boolean;
}

interface UsageLatencyStats {
  average_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  sample_count: number;
  days: Array<{ date: string; average_ms: number; p95_ms: number; sample_count: number }>;
}

interface UsageSklandStats {
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

interface UsageAnnouncementStats {
  impressions: number;
  reads: number;
  unread: number;
  read_rate: number;
}

interface UsageCdkDistributionItem {
  permission: string;
  total: number;
  success: number;
  failure: number;
  statuses: Record<string, number>;
}

interface UsageStatsResponse {
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

interface CdkPermissionDistribution {
  permission: Permission;
  total: number;
  unused: number;
  used: number;
  frozen: number;
  revoked: number;
}

interface CdkStatusDistribution {
  status: CdkStatus;
  total: number;
}

interface RiskReasonStats {
  reason: string;
  type: string;
  count: number;
  last_seen_at: string | null;
  latest_record: AdminCdkRecord | null;
}

interface RiskTrendDay {
  date: string;
  soft_blocks: number;
  freezes: number;
  escalations: number;
  total: number;
}

interface CdkOpsSummary {
  permission_distribution: CdkPermissionDistribution[];
  status_distribution: CdkStatusDistribution[];
  risk_reasons: RiskReasonStats[];
  risk_trend: RiskTrendDay[];
  soft_blocks: number;
  freezes: number;
  escalations: number;
  risk_records: number;
  generated_records: number;
  bound_records: number;
}

interface RiskControlSettings {
  operator_data_risk_enabled: boolean;
  device_risk_enabled: boolean;
  updated_at: string | null;
}

type RiskControlSettingsPatch = Partial<Pick<RiskControlSettings, 'operator_data_risk_enabled' | 'device_risk_enabled'>>

interface AdminUserSummary {
  username: string;
  created_at: string;
  updated_at: string;
}

interface AppUserSummary {
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

interface AdminProfileAccessSummary {
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
  operator_update_event_count: number;
}

interface AdminProfileSummary {
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

interface AdminUserDetail {
  user: AppUserSummary;
  profiles: AdminProfileSummary[];
}

interface AdminProfileOperatorData {
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

const EMPTY_ANNOUNCEMENTS: Announcement[] = []
const EMPTY_ANNOUNCEMENT_REACH_STATS: AnnouncementReachStats = {
  impressions: 0,
  reads: 0,
  server_reads: 0,
  local_reads: 0,
  unread: 0,
  read_rate: 0,
}
const DEFAULT_RISK_SETTINGS: RiskControlSettings = {
  operator_data_risk_enabled: true,
  device_risk_enabled: false,
  updated_at: null,
}

const permissionLabels: Record<Permission, string> = {
recommended: '单次重置卡',
growth: '练度提升卡',
advanced: '单账号终身卡',
ultimate: 'Admin卡',
basic: '练度提升卡',
premium: '单账号终身卡',
admin: 'Admin卡',
}

const statusLabels: Record<CdkStatus, string> = {
  unused: '未使用',
  used: '已使用',
  frozen: '已冻结',
  revoked: '已撤销',
}

const appUserStatusLabels: Record<AppUserStatus, string> = {
  active: '正常',
  frozen: '已冻结',
  revoked: '已撤销',
}

const sectionLabels: Record<AdminSection, string> = {
  overview: '总览',
  cdk: 'CDK',
  risk: '风控',
  announcement: '公告管理',
  users: '用户维护',
}

const announcementKindLabels: Record<AnnouncementKind, string> = {
  banner: '横幅',
  popup: '弹出式公告',
}

const announcementSortLabels: Record<AnnouncementSortKey, string> = {
  updated_desc: '更新时间新到旧',
  updated_asc: '更新时间旧到新',
  kind: '公告类型',
  active: '启用状态',
}

const cdkProductPermissions: GeneratedPermission[] = ['recommended', 'growth', 'advanced', 'ultimate']
const MAX_CDK_BATCH_COUNT = 100
const cdkProductPermissionRank: Record<GeneratedPermission, number> = {
  recommended: 0,
  growth: 1,
  advanced: 2,
  ultimate: 3,
}

export default function AdminPage() {
  const [credentials, setCredentials] = useState(() => readStoredCredentials())
  const [loginUser, setLoginUser] = useState(credentials?.user ?? '')
  const [loginPassword, setLoginPassword] = useState(credentials?.password ?? '')
  const [authenticated, setAuthenticated] = useState(Boolean(credentials))
  const [activeSection, setActiveSection] = useState<AdminSection>('overview')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>('all')
  const [boundFilter, setBoundFilter] = useState<BinaryFilter>('all')
  const [riskFilter, setRiskFilter] = useState<BinaryFilter>('all')
  const [generatedFilter, setGeneratedFilter] = useState<BinaryFilter>('all')
  const [records, setRecords] = useState<AdminCdkRecord[]>([])
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [appUsers, setAppUsers] = useState<AppUserSummary[]>([])
  const [usageRange, setUsageRange] = useState<UsageRangeMode>('7d')
  const [usageRangeFrom, setUsageRangeFrom] = useState(() => getDateOffsetString(6))
  const [usageRangeTo, setUsageRangeTo] = useState(() => getDateOffsetString(0))
  const [usageStats, setUsageStats] = useState<UsageStatsResponse | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>(EMPTY_ANNOUNCEMENTS)
  const [announcementStats, setAnnouncementStats] = useState<Record<string, AnnouncementReachStats>>({})
  const [announcementSort, setAnnouncementSort] = useState<AnnouncementSortKey>('updated_desc')
  const [riskSettings, setRiskSettings] = useState<RiskControlSettings>(DEFAULT_RISK_SETTINGS)
  const [permission, setPermission] = useState<GeneratedPermission>('growth')
  const [orderNote, setOrderNote] = useState('')
  const [cdkCount, setCdkCount] = useState('1')
  const [generatedCodes, setGeneratedCodes] = useState<GeneratedCdk[]>([])
  const [selectedCdkHashes, setSelectedCdkHashes] = useState<string[]>([])
  const [selectedCdkDetail, setSelectedCdkDetail] = useState<AdminCdkDetail | null>(null)
  const [selectedUserDetail, setSelectedUserDetail] = useState<AdminUserDetail | null>(null)
  const [operatorDataByProfileId, setOperatorDataByProfileId] = useState<Record<string, AdminProfileOperatorData>>({})
  const [expandedOperatorProfileId, setExpandedOperatorProfileId] = useState<string | null>(null)
  const [resetUserEmail, setResetUserEmail] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [loginFieldErrors, setLoginFieldErrors] = useState<FieldErrors>({})
  const [resetFieldErrors, setResetFieldErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const authHeaders = useMemo<Record<string, string>>(() => {
    if (!credentials) return {} as Record<string, string>
    return {
      'X-Admin-User': credentials.user,
      'X-Admin-Password': credentials.password,
    }
  }, [credentials])
  const usageStatsQuery = useMemo(
    () => buildUsageStatsQuery(usageRange, usageRangeFrom, usageRangeTo),
    [usageRange, usageRangeFrom, usageRangeTo],
  )

const summary = useMemo(
() => buildSummary(records, usageStats?.totals, users.length),
[records, usageStats, users.length],
)
  const cdkOpsSummary = useMemo(() => buildCdkOpsSummary(records), [records])
  const cdkFilters = useMemo<CdkTableFilters>(() => ({
    status: statusFilter,
    permission: permissionFilter,
    bound: boundFilter,
    risk: riskFilter,
    generated: generatedFilter,
  }), [statusFilter, permissionFilter, boundFilter, riskFilter, generatedFilter])
  const visibleRecords = useMemo(
    () => records.filter((record) => recordMatchesCdkFilters(record, cdkFilters)),
    [records, cdkFilters],
  )
  const sortedAnnouncements = useMemo(
    () => sortAnnouncements(announcements, announcementSort),
    [announcements, announcementSort],
  )
  const riskRecords = useMemo(
    () => records.filter((record) => record.status === 'frozen' || (record.risk_event_count ?? 0) > 0),
    [records],
  )
  const selectedRecords = useMemo(() => {
    const selected = new Set(selectedCdkHashes)
    return records.filter((record) => selected.has(record.code_hash))
  }, [records, selectedCdkHashes])

  const loadDashboard = useCallback(async (nextCredentials = credentials) => {
    if (!nextCredentials) return
    if (!usageStatsQuery) {
      setError('自定义时间范围无效，请选择开始和结束日期')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const headers = {
        'X-Admin-User': nextCredentials.user,
        'X-Admin-Password': nextCredentials.password,
      }
      const [cdkData, usageData, announcementData, usersData, riskSettingsData] = await Promise.all([
        apiJson<{ cdks?: AdminCdkRecord[] }>('/api/admin/cdk?status=all', { headers, fallbackMessage: '加载 CDK 失败' }),
        apiJson<Partial<UsageStatsResponse>>(`/api/admin/usage-stats?${usageStatsQuery}`, { headers, fallbackMessage: '加载统计失败' }),
        apiJson<Partial<AnnouncementAdminResponse>>('/api/admin/announcement', { headers, fallbackMessage: '加载公告失败' }),
        apiJson<{ users?: AdminUserSummary[]; app_users?: AppUserSummary[] }>('/api/admin/users', { headers, fallbackMessage: '加载账号失败' }),
        apiJson<{ settings?: Partial<RiskControlSettings> }>('/api/admin/risk-settings', { headers, fallbackMessage: '加载风控设置失败' }),
      ])
      const nextAnnouncements = normalizeAnnouncementList(announcementData.announcements)
      setRecords(cdkData.cdks ?? [])
      setUsageStats(normalizeUsageStats(usageData))
      setAnnouncements(nextAnnouncements)
      setAnnouncementStats(normalizeAnnouncementStatsMap(announcementData.stats, nextAnnouncements))
      setRiskSettings(normalizeRiskSettings(riskSettingsData.settings))
      setUsers(usersData.users ?? [])
      setAppUsers(usersData.app_users ?? [])
      setAuthenticated(true)
    } catch (caught) {
      setError((caught as Error).message)
      setAuthenticated(false)
      clearStoredCredentials()
      setCredentials(null)
    } finally {
      setLoading(false)
    }
  }, [credentials, usageStatsQuery])

  useEffect(() => {
    if (credentials) void loadDashboard(credentials)
  }, [usageStatsQuery])

  useEffect(() => {
    const available = new Set(records.map((record) => record.code_hash))
    setSelectedCdkHashes((current) => current.filter((hash) => available.has(hash)))
  }, [records])

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    if (!loginUser.trim()) nextErrors.loginUser = '请输入账号'
    if (!loginPassword) nextErrors.loginPassword = '请输入密码'
    setLoginFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    const next = { user: loginUser.trim(), password: loginPassword }
    setCredentials(next)
    storeCredentials(next)
    await loadDashboard(next)
  }

  const handleLogout = () => {
    clearStoredCredentials()
    setCredentials(null)
    setAuthenticated(false)
    setRecords([])
    setUsers([])
    setAppUsers([])
    setUsageStats(null)
    setAnnouncements([])
    setAnnouncementStats({})
    setRiskSettings(DEFAULT_RISK_SETTINGS)
    setSelectedCdkHashes([])
    setSelectedCdkDetail(null)
    setSelectedUserDetail(null)
    setOperatorDataByProfileId({})
    setExpandedOperatorProfileId(null)
  }

  const handleExportUsageReport = async (format: 'csv' | 'json') => {
    if (!credentials) return
    if (!usageStats) {
      setError('统计数据尚未加载完成')
      return
    }
    setBusyAction(`report:${format}`)
    setError(null)
    setNotice(null)
    try {
      const range = usageStats?.range
      const filenameRange = range?.from && range?.to ? `${range.from}_${range.to}` : usageRange
      const report = buildCurrentOpsReport(usageStats, cdkOpsSummary, announcements, announcementStats)
      const blob = format === 'json'
        ? new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' })
        : new Blob([`\uFEFF${buildCurrentOpsReportCsv(report)}`], { type: 'text/csv;charset=utf-8' })
      downloadBlob(blob, `admin-ops-report-${filenameRange}.${format}`)
      setNotice(format === 'csv' ? 'CSV 报表已导出' : 'JSON 报表已导出')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleGenerateCdk = async (event: FormEvent) => {
    event.preventDefault()
    const batchCount = Number(cdkCount)
    setError(null)
    setNotice(null)
    if (!Number.isInteger(batchCount) || batchCount < 1 || batchCount > MAX_CDK_BATCH_COUNT) {
      setGeneratedCodes([])
      setError(`生成数量必须是 1-${MAX_CDK_BATCH_COUNT} 的整数`)
      return
    }

    setBusyAction('generate')
    try {
      const data = await apiJson<AdminCdkCreateResponse>('/api/admin/cdk', {
        method: 'POST',
        headers: authHeaders,
        json: { admin_user: credentials?.user, admin_password: credentials?.password, permission, order_note: orderNote, count: batchCount },
        fallbackMessage: '生成失败',
      })
      const nextGeneratedCodes = normalizeGeneratedCdks(data)
      if (nextGeneratedCodes.length === 0) {
        throw new Error('生成失败')
      }
      setGeneratedCodes(nextGeneratedCodes)
      setOrderNote('')
      setNotice(`已生成 ${nextGeneratedCodes.length} 个 CDK`)
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleCopyGeneratedCdks = async () => {
    if (generatedCodes.length === 0) return
    try {
      await navigator.clipboard.writeText(generatedCodes.map((item) => item.code).join('\n'))
      setNotice(generatedCodes.length === 1 ? 'CDK 已复制' : `已复制 ${generatedCodes.length} 个 CDK`)
    } catch (caught) {
      setError((caught as Error).message || '复制失败')
    }
  }

  const handleDownloadGeneratedCdks = () => {
    if (generatedCodes.length === 0) return
    const blob = new Blob([`\uFEFF${buildGeneratedCdkCsv(generatedCodes)}`], { type: 'text/csv;charset=utf-8' })
    downloadBlob(blob, `generated-cdks-${formatDownloadTimestamp()}.csv`)
    setNotice('CDK CSV 已导出')
  }

  const handleSaveAnnouncement = async (event: FormEvent) => {
    event.preventDefault()
    setBusyAction('announcement')
    setError(null)
    setNotice(null)
    try {
      const data = await apiJson<Partial<AnnouncementAdminResponse>>('/api/admin/announcement', {
        method: 'PUT',
        headers: authHeaders,
        json: {
          admin_user: credentials?.user,
          admin_password: credentials?.password,
          announcements,
        },
        fallbackMessage: '保存公告失败',
      })
      const nextAnnouncements = normalizeAnnouncementList(data.announcements)
      setAnnouncements(nextAnnouncements)
      setAnnouncementStats(normalizeAnnouncementStatsMap(data.stats, nextAnnouncements))
      setNotice('公告已保存')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleSaveRiskSettings = async (patch: RiskControlSettingsPatch) => {
    setBusyAction('risk-settings')
    setError(null)
    setNotice(null)
    try {
      const data = await apiJson<{ settings?: Partial<RiskControlSettings> }>('/api/admin/risk-settings', {
        method: 'PUT',
        headers: authHeaders,
        json: {
          admin_user: credentials?.user,
          admin_password: credentials?.password,
          ...patch,
        },
        fallbackMessage: '保存风控设置失败',
      })
      setRiskSettings(normalizeRiskSettings(data.settings))
      setNotice('风控设置已保存')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const addAnnouncement = (kind: AnnouncementKind) => {
    setAnnouncements((current) => [createDraftAnnouncement(kind), ...current])
  }

  const updateAnnouncement = (id: string, patch: Partial<Pick<Announcement, 'kind' | 'active' | 'title' | 'body'>>) => {
    setAnnouncements((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const deleteAnnouncement = (id: string) => {
    setAnnouncements((current) => current.filter((item) => item.id !== id))
  }

  const patchCdk = async (
    record: AdminCdkRecord,
    action: string,
    nextPermission?: GeneratedPermission,
    extraBody: Record<string, unknown> = {},
  ) => {
    setBusyAction(`${action}:${record.code_hash}`)
    setError(null)
    try {
      const data = await apiJson<{ cdk?: AdminCdkDetail }>('/api/admin/cdk', {
        method: 'PATCH',
        headers: authHeaders,
        json: {
          admin_user: credentials?.user,
          admin_password: credentials?.password,
          code_hash: record.code_hash,
          action,
          ...(nextPermission ? { permission: nextPermission } : {}),
          ...extraBody,
        },
        fallbackMessage: '操作失败',
      })
      if (data.cdk) {
        setSelectedCdkDetail(data.cdk)
      } else if (selectedCdkDetail?.code_hash === record.code_hash) {
        const detailData = await apiJson<{ cdk?: AdminCdkDetail }>(`/api/admin/cdk?code_hash=${encodeURIComponent(record.code_hash)}`, {
          headers: authHeaders,
          fallbackMessage: '加载 CDK 详情失败',
        })
        if (detailData.cdk) setSelectedCdkDetail(detailData.cdk)
      }
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const deleteCdk = async (record: AdminCdkRecord) => {
    if (record.status !== 'unused') return
    if (!window.confirm(`确认删除未使用 CDK ${record.cdk_id}？`)) return
    setBusyAction(`delete:${record.code_hash}`)
    setError(null)
    try {
      await apiVoid('/api/admin/cdk', {
        method: 'DELETE',
        headers: authHeaders,
        json: { admin_user: credentials?.user, admin_password: credentials?.password, code_hash: record.code_hash },
        fallbackMessage: '删除失败',
      })
      if (selectedCdkDetail?.code_hash === record.code_hash) setSelectedCdkDetail(null)
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const loadCdkDetail = async (record: AdminCdkRecord) => {
    setBusyAction(`cdk-detail:${record.code_hash}`)
    setError(null)
    try {
      const data = await apiJson<{ cdk?: AdminCdkDetail }>(`/api/admin/cdk?code_hash=${encodeURIComponent(record.code_hash)}`, {
        headers: authHeaders,
        fallbackMessage: '加载 CDK 详情失败',
      })
      if (!data.cdk) throw new Error('加载 CDK 详情失败')
      setSelectedCdkDetail(data.cdk)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleUpdateCdkNote = async (record: AdminCdkDetail) => {
    const nextNote = window.prompt('请输入新的订单备注，留空可清除备注。', record.order_note ?? '')
    if (nextNote === null) return
    await patchCdk(record, 'update_note', undefined, { order_note: nextNote.trim() })
  }

  const handleSetCdkPermission = async (record: AdminCdkDetail) => {
    const nextPermission = window.prompt(
      `请输入授权类型：${cdkProductPermissions.join(' / ')}`,
      normalizeProductPermission(record.permission) ?? 'growth',
    )
    if (nextPermission === null) return
    const permissionValue = normalizeProductPermission(nextPermission.trim())
    if (!permissionValue) {
      setNotice(null)
      setError('授权类型必须是 recommended、growth、advanced 或 ultimate。')
      return
    }
    await patchCdk(record, 'set_permission', permissionValue)
  }

  const handleBulkRevoke = async () => {
    const targets = selectedRecords.filter((record) => record.status === 'used' || record.status === 'frozen')
    if (targets.length === 0 || !window.confirm(`确认撤销 ${targets.length} 个授权？`)) return
    for (const record of targets) await patchCdk(record, 'revoke')
    setSelectedCdkHashes([])
  }

  const loadUserDetail = async (user: AppUserSummary) => {
    setBusyAction(`user-detail:${user.id}`)
    setError(null)
    try {
      const data = await apiJson<{ detail?: AdminUserDetail }>(`/api/admin/users?user_id=${encodeURIComponent(user.id)}`, {
        headers: authHeaders,
        fallbackMessage: '加载用户详情失败',
      })
      if (!data.detail) throw new Error('加载用户详情失败')
      setSelectedUserDetail(data.detail)
      setOperatorDataByProfileId({})
      setExpandedOperatorProfileId(null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const loadProfileOperatorData = async (
    profile: AdminProfileSummary,
    options: { expand?: boolean; busyKey?: string } = {},
  ): Promise<AdminProfileOperatorData | null> => {
    if (!selectedUserDetail) return null
    const busyKey = options.busyKey ?? `profile-operators:${profile.id}`
    setBusyAction(busyKey)
    setError(null)
    setNotice(null)
    try {
      const data = await apiJson<{ operator_data?: AdminProfileOperatorData }>(
        `/api/admin/users?user_id=${encodeURIComponent(selectedUserDetail.user.id)}&profile_id=${encodeURIComponent(profile.id)}&include=operators`,
        {
          headers: authHeaders,
          fallbackMessage: '加载干员数据失败',
        },
      )
      if (!data.operator_data) throw new Error('加载干员数据失败')
      setOperatorDataByProfileId((current) => ({
        ...current,
        [profile.id]: data.operator_data as AdminProfileOperatorData,
      }))
      if (options.expand !== false) setExpandedOperatorProfileId(profile.id)
      return data.operator_data
    } catch (caught) {
      setError((caught as Error).message)
      return null
    } finally {
      setBusyAction(null)
    }
  }

  const handleViewProfileOperators = async (profile: AdminProfileSummary) => {
    if (expandedOperatorProfileId === profile.id) {
      setExpandedOperatorProfileId(null)
      return
    }
    if (operatorDataByProfileId[profile.id]) {
      setExpandedOperatorProfileId(profile.id)
      return
    }
    await loadProfileOperatorData(profile)
  }

  const handleDownloadProfileOperators = async (profile: AdminProfileSummary) => {
    const data = operatorDataByProfileId[profile.id]
      ?? await loadProfileOperatorData(profile, { expand: false, busyKey: `profile-operators-download:${profile.id}` })
    if (!data) return
    downloadOperatorsJson(data)
    setNotice(`已开始下载 ${profile.display_name || '账号档案'} 的干员 JSON`)
  }

  const patchUserProfile = async (
    profile: AdminProfileSummary,
    action: 'update_profile' | 'set_profile_status' | 'set_profile_permission' | 'upgrade_preview_profile' | 'clear_profile_skland_binding' | 'clear_profile_workspace',
    extraBody: Record<string, unknown> = {},
  ) => {
    if (!selectedUserDetail) return
    const busyKey = `profile:${action}:${profile.id}`
    setBusyAction(busyKey)
    setError(null)
    setNotice(null)
    try {
      const data = await apiJson<{ detail?: AdminUserDetail }>('/api/admin/users', {
        method: 'PATCH',
        headers: authHeaders,
        json: {
          admin_user: credentials?.user,
          admin_password: credentials?.password,
          action,
          user_id: selectedUserDetail.user.id,
          profile_id: profile.id,
          ...extraBody,
        },
        fallbackMessage: '档案操作失败',
      })
      if (!data.detail) throw new Error('档案操作失败')
      setSelectedUserDetail(data.detail)
      setOperatorDataByProfileId((current) => omitProfileOperatorData(current, profile.id))
      if (expandedOperatorProfileId === profile.id) setExpandedOperatorProfileId(null)
      setNotice('档案已更新')
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleUpdateProfile = async (profile: AdminProfileSummary) => {
    const displayName = window.prompt('请输入档案名称。', profile.display_name)
    if (displayName === null) return
    const note = window.prompt('请输入档案备注，留空可清除备注。', profile.note ?? '')
    if (note === null) return
    await patchUserProfile(profile, 'update_profile', { display_name: displayName.trim(), note: note.trim() })
  }

  const handleSetProfileStatus = async (profile: AdminProfileSummary) => {
    const status = window.prompt('请输入档案状态：active / frozen / revoked', profile.status)
    if (status === null) return
    if (!isAppUserStatus(status.trim())) {
      setNotice(null)
      setError('档案状态必须是 active、frozen 或 revoked。')
      return
    }
    await patchUserProfile(profile, 'set_profile_status', { status: status.trim() })
  }

  const handleSetProfilePermission = async (profile: AdminProfileSummary) => {
    const nextPermission = window.prompt(
      `请输入档案权限：${cdkProductPermissions.join(' / ')}`,
      normalizeProductPermission(profile.permission) ?? 'growth',
    )
    if (nextPermission === null) return
    const permissionValue = normalizeProductPermission(nextPermission.trim())
    if (!permissionValue) {
      setNotice(null)
      setError('档案权限必须是 recommended、growth、advanced 或 ultimate。')
      return
    }
    await patchUserProfile(profile, 'set_profile_permission', { permission: permissionValue })
  }

  const handleUpgradePreviewProfile = async (profile: AdminProfileSummary) => {
    const nextPermission = window.prompt(
      `请选择免 CDK 升级后的档案权限：${cdkProductPermissions.join(' / ')}`,
      'growth',
    )
    if (nextPermission === null) return
    const permissionValue = normalizeProductPermission(nextPermission.trim())
    if (!permissionValue) {
      setNotice(null)
      setError('档案权限必须是 recommended、growth、advanced 或 ultimate。')
      return
    }
    if (!window.confirm(`确认将档案「${profile.display_name}」免 CDK 升级为${permissionLabels[permissionValue]}？此操作不可撤销。`)) return
    await patchUserProfile(profile, 'upgrade_preview_profile', { permission: permissionValue })
  }

  const handleClearProfileSklandBinding = async (profile: AdminProfileSummary) => {
    if (!window.confirm(`确认清空档案「${profile.display_name}」的森空岛绑定和风控计数？`)) return
    await patchUserProfile(profile, 'clear_profile_skland_binding')
  }

  const handleClearProfileWorkspace = async (profile: AdminProfileSummary) => {
    if (!window.confirm(`确认清空档案「${profile.display_name}」的工作区？干员、配置和最近结果都会重置为空摘要。`)) return
    await patchUserProfile(profile, 'clear_profile_workspace')
  }

  const handleResetUserPassword = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: FieldErrors = {}
    const emailError = validateEmailInput(resetUserEmail)
    const passwordError = validatePasswordInput(resetPassword)
    if (emailError) nextErrors.resetUserEmail = emailError
    if (passwordError) nextErrors.resetPassword = passwordError
    setResetFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setBusyAction('reset-password')
    setError(null)
    setNotice(null)
    try {
      const data = await apiJson<{ user?: { email: string } }>('/api/admin/users', {
        method: 'PATCH',
        headers: authHeaders,
        json: {
          admin_user: credentials?.user,
          admin_password: credentials?.password,
          action: 'reset_password',
          email: resetUserEmail,
          new_password: resetPassword,
        },
        fallbackMessage: '重置密码失败',
      })
      setNotice(`已重置 ${data.user?.email ?? resetUserEmail} 的密码`)
      setResetUserEmail('')
      setResetPassword('')
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const patchAppUser = async (
    user: AppUserSummary,
    action: 'freeze_account' | 'unfreeze_account' | 'delete_account',
    successMessage: string,
    extraBody: Record<string, unknown> = {},
  ) => {
    const busyKey = `app-user:${action}:${user.id}`
    setBusyAction(busyKey)
    setError(null)
    setNotice(null)
    try {
      const data = await apiJson<{ detail?: AdminUserDetail; deleted?: boolean }>('/api/admin/users', {
        method: 'PATCH',
        headers: authHeaders,
        json: {
          admin_user: credentials?.user,
          admin_password: credentials?.password,
          action,
          user_id: user.id,
          ...extraBody,
        },
        fallbackMessage: `${successMessage}失败`,
      })
      if (data.detail) setSelectedUserDetail(data.detail)
      if (data.deleted && selectedUserDetail?.user.id === user.id) {
        setSelectedUserDetail(null)
        setOperatorDataByProfileId({})
        setExpandedOperatorProfileId(null)
      }
      setNotice(`${successMessage}：${user.email}`)
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleFreezeAppUser = async (user: AppUserSummary) => {
    if (!window.confirm(`确认冻结账号 ${user.email}？`)) return
    await patchAppUser(user, 'freeze_account', '已冻结账号')
  }

  const handleUnfreezeAppUser = async (user: AppUserSummary) => {
    await patchAppUser(user, 'unfreeze_account', '已解冻账号')
  }

  const handleDeleteAppUser = async (user: AppUserSummary) => {
    const confirmedEmail = window.prompt(`删除账号会清空 ${user.email} 的用户数据。请输入该邮箱确认删除。`)
    if (confirmedEmail === null) return
    if (confirmedEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      setNotice(null)
      setError('确认邮箱不匹配，已取消删除。')
      return
    }
    await patchAppUser(user, 'delete_account', '已删除账号', { confirm_email: confirmedEmail.trim() })
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-surface-0 px-6 py-10 text-ink-primary">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_380px]">
          <section>
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-brand-500">MAA 基建管理后台</p>
              <h1 className="mt-3 text-3xl font-semibold text-ink-primary sm:text-4xl">管理工作台</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-ink-secondary">
                使用独立管理账号进入后台。Root 口令只用于创建和维护管理账号，日常操作不再需要反复输入。
              </p>
            </div>
          </section>
        <form onSubmit={handleLogin} noValidate className="rounded-xl border border-surface-3 bg-surface-1 p-6">
          <h2 className="text-lg font-semibold text-ink-primary">账号登录</h2>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">账号</span>
            <input
              id="admin-login-user"
              value={loginUser}
              onChange={(event) => {
                setLoginUser(event.currentTarget.value)
                setLoginFieldErrors((current) => omitFieldError(current, 'loginUser'))
              }}
              onFocus={() => setLoginFieldErrors((current) => omitFieldError(current, 'loginUser'))}
              className={inputClassName(Boolean(loginFieldErrors.loginUser))}
              autoComplete="username"
              aria-invalid={Boolean(loginFieldErrors.loginUser)}
              aria-describedby={loginFieldErrors.loginUser ? 'admin-login-user-error' : undefined}
            />
            {loginFieldErrors.loginUser && <p id="admin-login-user-error" className="mt-1.5 text-sm text-error">{loginFieldErrors.loginUser}</p>}
          </label>
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-medium text-ink-secondary">密码</span>
            <input
              id="admin-login-password"
              type="password"
              value={loginPassword}
              onChange={(event) => {
                setLoginPassword(event.currentTarget.value)
                setLoginFieldErrors((current) => omitFieldError(current, 'loginPassword'))
              }}
              onFocus={() => setLoginFieldErrors((current) => omitFieldError(current, 'loginPassword'))}
              className={inputClassName(Boolean(loginFieldErrors.loginPassword))}
              autoComplete="current-password"
              aria-invalid={Boolean(loginFieldErrors.loginPassword)}
              aria-describedby={loginFieldErrors.loginPassword ? 'admin-login-password-error' : undefined}
            />
            {loginFieldErrors.loginPassword && <p id="admin-login-password-error" className="mt-1.5 text-sm text-error">{loginFieldErrors.loginPassword}</p>}
          </label>
            {error && <div className="mt-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}
          <button type="submit" disabled={loading} className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
              {loading ? '正在登录...' : '进入后台'}
            </button>
            <a href="/admin/setup" className="mt-4 block text-center text-sm font-medium text-brand-500 underline-offset-4 hover:underline">添加管理账号</a>
          </form>
        </div>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-surface-3 bg-surface-1 px-4 py-5 lg:block">
        <div className="px-2">
          <p className="text-sm font-semibold text-brand-500">MAA 管理后台</p>
          <p className="mt-1 truncate text-xs text-ink-muted">{credentials?.user}</p>
        </div>
        <nav className="mt-8 space-y-1">
          {(Object.keys(sectionLabels) as AdminSection[]).map((section) => (
            <button key={section} type="button" onClick={() => setActiveSection(section)} className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${activeSection === section ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}>
              {sectionLabels[section]}
            </button>
          ))}
        </nav>
        <button type="button" onClick={handleLogout} className="absolute bottom-5 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">退出登录</button>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-surface-3 bg-surface-0/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-ink-primary">{sectionLabels[activeSection]}</h1>
              <p className="mt-1 text-sm text-ink-muted">最近同步 {loading ? '进行中' : formatDate(new Date().toISOString())}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void loadDashboard()} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">刷新数据</button>
              <a href="/admin/setup" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500">账号设置</a>
            </div>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {(Object.keys(sectionLabels) as AdminSection[]).map((section) => (
              <button key={section} type="button" onClick={() => setActiveSection(section)} className={`rounded-lg px-3 py-2 text-sm font-medium ${activeSection === section ? 'bg-brand-600 text-white' : 'bg-surface-1 text-ink-secondary'}`}>
                {sectionLabels[section]}
              </button>
            ))}
          </div>
        </header>

        <div className="px-5 py-6 sm:px-8">
          {error && <div className="mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
          {notice && <div className="mb-5 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{notice}</div>}

          {activeSection === 'overview' && (
            <section className="space-y-6">
              <div className="flex flex-col gap-3 rounded-xl border border-surface-3 bg-surface-1 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-ink-primary">运营概览</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    {usageStats?.range.from && usageStats?.range.to ? `${usageStats.range.from} 至 ${usageStats.range.to}` : '选择统计范围'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['7d', '14d', '30d'] as UsageRangeKey[]).map((range) => (
                    <button
                      key={range}
                      type="button"
                      onClick={() => setUsageRange(range)}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 ${usageRange === range ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'}`}
                    >
                      {range === '7d' ? '7 天' : range === '14d' ? '14 天' : '30 天'}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setUsageRange('custom')}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 ${usageRange === 'custom' ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'}`}
                  >
                    自定义
                  </button>
                  {usageRange === 'custom' && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5">
                      <input
                        type="date"
                        value={usageRangeFrom}
                        max={usageRangeTo}
                        onChange={(event) => setUsageRangeFrom(event.currentTarget.value)}
                        className="rounded-md border border-surface-4 bg-surface-0 px-2 py-1.5 text-sm text-ink-primary"
                        aria-label="统计开始日期"
                      />
                      <span className="text-xs text-ink-muted">至</span>
                      <input
                        type="date"
                        value={usageRangeTo}
                        min={usageRangeFrom}
                        onChange={(event) => setUsageRangeTo(event.currentTarget.value)}
                        className="rounded-md border border-surface-4 bg-surface-0 px-2 py-1.5 text-sm text-ink-primary"
                        aria-label="统计结束日期"
                      />
                    </div>
                  )}
                  <button type="button" onClick={() => void handleExportUsageReport('csv')} disabled={busyAction === 'report:csv'} className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3 disabled:bg-surface-3 disabled:text-ink-muted">
                    {busyAction === 'report:csv' ? '导出中...' : '导出 CSV'}
                  </button>
                  <button type="button" onClick={() => void handleExportUsageReport('json')} disabled={busyAction === 'report:json'} className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3 disabled:bg-surface-3 disabled:text-ink-muted">
                    {busyAction === 'report:json' ? '导出中...' : '导出 JSON'}
                  </button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="免费预览" value={summary.freePreviews} />
                <Metric label="注册数" value={summary.registers} />
                <Metric label="CDK 兑换" value={summary.cdkRedeems} />
                <Metric label="排班生成" value={summary.scheduleGenerates} />
                <Metric label="生成成功率" value={`${summary.scheduleSuccessRate}%`} tone={summary.scheduleSuccessRate < 80 && summary.scheduleAttempts > 0 ? 'warning' : 'default'} />
                <Metric label="平均耗时" value={formatDuration(usageStats?.latency.schedule_generate.average_ms ?? 0)} />
                <Metric label="P95 耗时" value={formatDuration(usageStats?.latency.schedule_generate.p95_ms ?? 0)} tone={(usageStats?.latency.schedule_generate.p95_ms ?? 0) > 10000 ? 'warning' : 'default'} />
                <Metric label="冻结/软拦截" value={summary.frozenCdks + summary.riskEvents} tone={summary.frozenCdks + summary.riskEvents > 0 ? 'warning' : 'default'} />
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-ink-primary">趋势</h2>
                    <span className="text-xs text-ink-muted">访问 / 生成 / 兑换</span>
                  </div>
                  <UsageTrendChart days={usageStats?.days ?? []} />
                </section>
                <FunnelPanel steps={usageStats?.funnel ?? []} />
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <FailureReasonPanel reasons={usageStats?.failure_reasons ?? []} samples={usageStats?.recent_failures ?? []} />
                <LatencyPanel stats={usageStats?.latency.schedule_generate ?? EMPTY_LATENCY_STATS} />
              </div>
              <div className="grid gap-5 xl:grid-cols-3">
                <OpsSummaryPanel summary={summary} />
                <SklandPanel stats={usageStats?.skland ?? EMPTY_SKLAND_STATS} />
                <AnnouncementStatsPanel stats={usageStats?.announcement ?? EMPTY_ANNOUNCEMENT_STATS} />
              </div>
              <CdkDistributionPanel items={usageStats?.cdk_distribution ?? []} />
            </section>
          )}

      {activeSection === 'cdk' && (
        <section className="space-y-5">
          <form onSubmit={handleGenerateCdk} className="rounded-xl border border-surface-3 bg-surface-1 p-5">
            <div className="grid gap-4 lg:grid-cols-[220px_140px_1fr_auto] lg:items-end">
              <label>
                <span className="mb-2 block text-sm font-medium text-ink-secondary">授权类型</span>
                <select value={permission} onChange={(event) => setPermission(event.currentTarget.value as GeneratedPermission)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary">
                  {cdkProductPermissions.map((item) => <option key={item} value={item}>{permissionLabels[item]}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-2 block text-sm font-medium text-ink-secondary">生成数量</span>
                <input type="number" min={1} max={MAX_CDK_BATCH_COUNT} step={1} value={cdkCount} onChange={(event) => setCdkCount(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" />
              </label>
              <label>
                <span className="mb-2 block text-sm font-medium text-ink-secondary">订单备注</span>
                <input value={orderNote} maxLength={120} onChange={(event) => setOrderNote(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="闲鱼订单号、用户昵称或售后备注" />
              </label>
              <button type="submit" disabled={busyAction === 'generate'} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">{busyAction === 'generate' ? '生成中...' : '生成 CDK'}</button>
            </div>
            {generatedCodes.length > 0 && (
              <div className="mt-4 border-t border-surface-3 pt-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-ink-primary">已生成 {generatedCodes.length} 个 CDK</div>
                    <div className="mt-1 text-xs text-ink-muted">{permissionLabels[generatedCodes[0].permission]} · {formatDate(generatedCodes[0].created_at)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={handleCopyGeneratedCdks} className="rounded-lg bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">{generatedCodes.length === 1 ? '复制 CDK' : '复制全部'}</button>
                    <button type="button" onClick={handleDownloadGeneratedCdks} className="rounded-lg bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">下载 CSV</button>
                  </div>
                </div>
                <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-surface-3 bg-surface-0">
                  {generatedCodes.map((item) => (
                    <div key={item.code} className="flex flex-col gap-1 border-b border-surface-3 px-3 py-2 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                      <span className="break-all font-mono text-sm font-semibold text-ink-primary">{item.code}</span>
                      <span className="text-xs text-ink-muted">{formatDate(item.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>
              <CdkRecordDistributionPanel summary={cdkOpsSummary} />
              <CdkTable
                records={visibleRecords}
                selected={selectedCdkHashes}
                filters={cdkFilters}
                busyAction={busyAction}
                onFilterChange={(patch) => {
                  if (patch.status) setStatusFilter(patch.status)
                  if (patch.permission) setPermissionFilter(patch.permission)
                  if (patch.bound) setBoundFilter(patch.bound)
                  if (patch.risk) setRiskFilter(patch.risk)
                  if (patch.generated) setGeneratedFilter(patch.generated)
                }}
                onSelect={setSelectedCdkHashes}
                onBulkRevoke={handleBulkRevoke}
                onPatch={patchCdk}
                onOpenDetail={loadCdkDetail}
                onDelete={deleteCdk}
              />
              {selectedCdkDetail && (
                <CdkDetailPanel
                  detail={selectedCdkDetail}
                  busyAction={busyAction}
                  onClose={() => setSelectedCdkDetail(null)}
                  onPatch={patchCdk}
                  onUpdateNote={handleUpdateCdkNote}
                  onSetPermission={handleSetCdkPermission}
                />
              )}
            </section>
          )}

          {activeSection === 'risk' && (
            <section className="space-y-5">
              <RiskSettingsPanel
                settings={riskSettings}
                saving={busyAction === 'risk-settings'}
                onChange={handleSaveRiskSettings}
              />
              <RiskConsoleSummary summary={cdkOpsSummary} />
              <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                <RiskTrendPanel days={cdkOpsSummary.risk_trend} />
                <RiskReasonPanel reasons={cdkOpsSummary.risk_reasons} onOpenDetail={loadCdkDetail} />
              </div>
              <RiskTable records={riskRecords} busyAction={busyAction} onPatch={patchCdk} onOpenDetail={loadCdkDetail} />
            </section>
          )}

        {activeSection === 'announcement' && (
          <form onSubmit={handleSaveAnnouncement} className="space-y-5">
            <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-ink-primary">横幅和弹出式公告</h2>
                  <p className="mt-1 text-sm text-ink-secondary">横幅显示在工具页内，弹出式公告会在用户首次未读时弹出。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary">
                    <span>排序</span>
                    <select
                      value={announcementSort}
                      onChange={(event) => setAnnouncementSort(event.currentTarget.value as AnnouncementSortKey)}
                      className="bg-transparent text-sm font-semibold text-ink-primary outline-none"
                    >
                      {Object.entries(announcementSortLabels).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => addAnnouncement('banner')} className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">新增横幅</button>
                  <button type="button" onClick={() => addAnnouncement('popup')} className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">新增弹出式公告</button>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {announcements.length === 0 && (
                  <div className="rounded-lg border border-dashed border-surface-4 bg-surface-0 px-4 py-6 text-sm text-ink-muted">
                    还没有公告。新增横幅或弹出式公告后保存即可生效。
                  </div>
                )}
                {sortedAnnouncements.map((item) => {
                  const stats = announcementStats[item.id] ?? EMPTY_ANNOUNCEMENT_REACH_STATS
                  return (
                    <article key={item.id} className="rounded-lg border border-surface-3 bg-surface-0 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={item.kind}
                            onChange={(event) => updateAnnouncement(item.id, { kind: event.currentTarget.value as AnnouncementKind })}
                            className="rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary"
                          >
                            {Object.entries(announcementKindLabels).map(([kind, label]) => (
                              <option key={kind} value={kind}>{label}</option>
                            ))}
                          </select>
                          <label className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-ink-secondary">
                            <input
                              type="checkbox"
                              checked={item.active}
                              onChange={(event) => updateAnnouncement(item.id, { active: event.currentTarget.checked })}
                              className="h-4 w-4 accent-brand-600"
                            />
                            启用
                          </label>
                        </div>
                        <button type="button" onClick={() => deleteAnnouncement(item.id)} className="rounded-lg bg-error/10 px-3 py-2 text-sm font-semibold text-error hover:bg-error/20">
                          删除
                        </button>
                      </div>

                      <AnnouncementReachMetrics stats={stats} />

                      <label className="mt-4 block">
                        <span className="mb-2 block text-sm font-medium text-ink-secondary">标题</span>
                        <input
                          value={item.title}
                          maxLength={80}
                          onChange={(event) => updateAnnouncement(item.id, { title: event.currentTarget.value })}
                          className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary"
                        />
                      </label>
                      <label className="mt-4 block">
                        <span className="mb-2 block text-sm font-medium text-ink-secondary">正文</span>
                        <textarea
                          value={item.body}
                          maxLength={600}
                          rows={5}
                          onChange={(event) => updateAnnouncement(item.id, { body: event.currentTarget.value })}
                          className="w-full resize-y rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm leading-6 text-ink-primary"
                        />
                      </label>
                      <p className="mt-3 text-xs text-ink-muted">更新时间：{formatDate(item.updated_at)}</p>
                    </article>
                  )
                })}
              </div>

              <button type="submit" disabled={busyAction === 'announcement'} className="mt-5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                {busyAction === 'announcement' ? '保存中...' : '保存公告'}
              </button>
            </section>
            </form>
          )}

          {activeSection === 'users' && (
            <section className="space-y-5">
            <form onSubmit={handleResetUserPassword} noValidate className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                <h2 className="text-lg font-semibold text-ink-primary">重置用户密码</h2>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">输入用户邮箱和新临时密码。保存后该用户现有登录会话会失效。</p>
                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_240px_auto] lg:items-end">
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">用户邮箱</span>
                  <input
                    id="admin-reset-email"
                    value={resetUserEmail}
                    onChange={(event) => {
                      setResetUserEmail(event.currentTarget.value)
                      setResetFieldErrors((current) => omitFieldError(current, 'resetUserEmail'))
                    }}
                    onFocus={() => setResetFieldErrors((current) => omitFieldError(current, 'resetUserEmail'))}
                    className={inputClassName(Boolean(resetFieldErrors.resetUserEmail))}
                    placeholder="user@example.com"
                    aria-invalid={Boolean(resetFieldErrors.resetUserEmail)}
                    aria-describedby={resetFieldErrors.resetUserEmail ? 'admin-reset-email-error' : undefined}
                  />
                  {resetFieldErrors.resetUserEmail && <p id="admin-reset-email-error" className="mt-1.5 text-sm text-error">{resetFieldErrors.resetUserEmail}</p>}
                </label>
                <label>
                  <span className="mb-2 block text-sm font-medium text-ink-secondary">新密码</span>
                  <input
                    id="admin-reset-password"
                    type="password"
                    value={resetPassword}
                    onChange={(event) => {
                      setResetPassword(event.currentTarget.value)
                      setResetFieldErrors((current) => omitFieldError(current, 'resetPassword'))
                    }}
                    onFocus={() => setResetFieldErrors((current) => omitFieldError(current, 'resetPassword'))}
                    className={inputClassName(Boolean(resetFieldErrors.resetPassword))}
                    aria-invalid={Boolean(resetFieldErrors.resetPassword)}
                    aria-describedby={resetFieldErrors.resetPassword ? 'admin-reset-password-error' : undefined}
                  />
                  {resetFieldErrors.resetPassword && <p id="admin-reset-password-error" className="mt-1.5 text-sm text-error">{resetFieldErrors.resetPassword}</p>}
                </label>
                <button type="submit" disabled={busyAction === 'reset-password'} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                    {busyAction === 'reset-password' ? '重置中...' : '重置密码'}
                  </button>
                </div>
              </form>

              <section className="rounded-xl border border-surface-3 bg-surface-1">
                <div className="border-b border-surface-3 p-4">
                  <h2 className="text-lg font-semibold text-ink-primary">注册用户</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
                      <tr>
                        <th className="px-4 py-3">邮箱</th>
                        <th className="px-4 py-3">状态</th>
                        <th className="px-4 py-3">权限</th>
                        <th className="px-4 py-3">档案</th>
                        <th className="px-4 py-3">时间</th>
                        <th className="px-4 py-3">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-3">
                      {appUsers.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-ink-muted">暂无注册用户。</td></tr>
                      ) : appUsers.map((item) => (
                        <tr key={item.id} className="hover:bg-surface-2/50">
                          <td className="px-4 py-4 font-medium text-ink-primary">{item.email}</td>
                          <td className="px-4 py-4"><UserStatusPill status={item.status} /></td>
                          <td className="px-4 py-4 text-ink-secondary">{formatAdminProfileAccess(item.profile_access)}</td>
                          <td className="px-4 py-4 text-ink-secondary">{item.profile_count}</td>
                          <td className="px-4 py-4 text-xs text-ink-muted">{formatDate(item.updated_at)}</td>
                          <td className="px-4 py-4">
                            <div className="flex flex-wrap gap-2">
                              <SmallButton onClick={() => void loadUserDetail(item)} loading={busyAction === `user-detail:${item.id}`}>详情</SmallButton>
                              {item.status === 'active' && <SmallButton onClick={() => void handleFreezeAppUser(item)} loading={busyAction === `app-user:freeze_account:${item.id}`}>冻结</SmallButton>}
                              {item.status === 'frozen' && <SmallButton onClick={() => void handleUnfreezeAppUser(item)} loading={busyAction === `app-user:unfreeze_account:${item.id}`} tone="success">解冻</SmallButton>}
                              <SmallButton onClick={() => void handleDeleteAppUser(item)} loading={busyAction === `app-user:delete_account:${item.id}`} tone="danger">删除</SmallButton>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              {selectedUserDetail && (
                <UserDetailDialog
                  detail={selectedUserDetail}
                  busyAction={busyAction}
                  operatorDataByProfileId={operatorDataByProfileId}
                  expandedOperatorProfileId={expandedOperatorProfileId}
                  onClose={() => {
                    setSelectedUserDetail(null)
                    setOperatorDataByProfileId({})
                    setExpandedOperatorProfileId(null)
                  }}
                  onUpdateProfile={handleUpdateProfile}
                  onSetProfileStatus={handleSetProfileStatus}
                  onSetProfilePermission={handleSetProfilePermission}
                  onUpgradePreviewProfile={handleUpgradePreviewProfile}
                  onClearSklandBinding={handleClearProfileSklandBinding}
                  onClearWorkspace={handleClearProfileWorkspace}
                  onViewOperators={handleViewProfileOperators}
                  onDownloadOperators={handleDownloadProfileOperators}
                  onFreezeUser={handleFreezeAppUser}
                  onUnfreezeUser={handleUnfreezeAppUser}
                  onDeleteUser={handleDeleteAppUser}
                />
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

interface UserDetailPanelProps {
  detail: AdminUserDetail;
  busyAction: string | null;
  operatorDataByProfileId: Record<string, AdminProfileOperatorData>;
  expandedOperatorProfileId: string | null;
  onClose: () => void;
  onUpdateProfile: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfileStatus: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfilePermission: (profile: AdminProfileSummary) => Promise<void>;
  onUpgradePreviewProfile: (profile: AdminProfileSummary) => Promise<void>;
  onClearSklandBinding: (profile: AdminProfileSummary) => Promise<void>;
  onClearWorkspace: (profile: AdminProfileSummary) => Promise<void>;
  onViewOperators: (profile: AdminProfileSummary) => Promise<void>;
  onDownloadOperators: (profile: AdminProfileSummary) => Promise<void>;
  onFreezeUser: (user: AppUserSummary) => Promise<void>;
  onUnfreezeUser: (user: AppUserSummary) => Promise<void>;
  onDeleteUser: (user: AppUserSummary) => Promise<void>;
}

function UserDetailDialog(props: UserDetailPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => {
      const preferredTarget = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')
      const focusTarget = preferredTarget ?? dialog
      focusTarget.focus()
    })
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleEscape)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-user-detail-title"
        tabIndex={-1}
        className="max-h-full w-full max-w-6xl overflow-y-auto rounded-xl bg-surface-1 shadow-2xl focus:outline-none"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ))
          if (focusable.length === 0) {
            event.preventDefault()
            return
          }
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <UserDetailPanel {...props} />
      </div>
    </div>
  )
}

function UserDetailPanel({
  detail,
  busyAction,
  operatorDataByProfileId,
  expandedOperatorProfileId,
  onClose,
  onUpdateProfile,
  onSetProfileStatus,
  onSetProfilePermission,
  onUpgradePreviewProfile,
  onClearSklandBinding,
  onClearWorkspace,
  onViewOperators,
  onDownloadOperators,
  onFreezeUser,
  onUnfreezeUser,
  onDeleteUser,
}: UserDetailPanelProps) {
  const user = detail.user
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1">
      <div className="flex flex-col gap-3 border-b border-surface-3 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="admin-user-detail-title" className="break-all text-lg font-semibold text-ink-primary">{user.email}</h2>
            <UserStatusPill status={user.status} />
            <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold text-ink-secondary">{formatAdminProfileAccess(user.profile_access)}</span>
          </div>
          <p className="mt-2 break-all text-sm text-ink-muted">用户 ID：{user.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {user.status === 'active' && <SmallButton onClick={() => void onFreezeUser(user)} loading={busyAction === `app-user:freeze_account:${user.id}`}>冻结用户</SmallButton>}
          {user.status === 'frozen' && <SmallButton onClick={() => void onUnfreezeUser(user)} loading={busyAction === `app-user:unfreeze_account:${user.id}`} tone="success">解冻用户</SmallButton>}
          <SmallButton onClick={() => void onDeleteUser(user)} loading={busyAction === `app-user:delete_account:${user.id}`} tone="danger">删除用户</SmallButton>
          <SmallButton onClick={onClose} autoFocus>关闭</SmallButton>
        </div>
      </div>

      <div className="p-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <DetailItem label="账号状态" value={appUserStatusLabels[user.status]} />
          <DetailItem label="档案数量" value={String(detail.profiles.length)} />
          <DetailItem label="CDK 订单标识" value={user.cdk_order_hash || '-'} />
          <DetailItem label="创建时间" value={formatDate(user.created_at)} />
          <DetailItem label="更新时间" value={formatDate(user.updated_at)} />
        </dl>

        <div className="mt-5 space-y-4">
          {detail.profiles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-surface-4 bg-surface-0 px-4 py-8 text-center text-sm text-ink-muted">该用户暂无档案。</div>
          ) : detail.profiles.map((profile) => (
            <ProfileDetailCard
              key={profile.id}
              profile={profile}
              busyAction={busyAction}
              operatorData={operatorDataByProfileId[profile.id] ?? null}
              operatorsExpanded={expandedOperatorProfileId === profile.id}
              onUpdateProfile={onUpdateProfile}
              onSetProfileStatus={onSetProfileStatus}
              onSetProfilePermission={onSetProfilePermission}
              onUpgradePreviewProfile={onUpgradePreviewProfile}
              onClearSklandBinding={onClearSklandBinding}
              onClearWorkspace={onClearWorkspace}
              onViewOperators={onViewOperators}
              onDownloadOperators={onDownloadOperators}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function ProfileDetailCard({
  profile,
  busyAction,
  operatorData,
  operatorsExpanded,
  onUpdateProfile,
  onSetProfileStatus,
  onSetProfilePermission,
  onUpgradePreviewProfile,
  onClearSklandBinding,
  onClearWorkspace,
  onViewOperators,
  onDownloadOperators,
}: {
  profile: AdminProfileSummary;
  busyAction: string | null;
  operatorData: AdminProfileOperatorData | null;
  operatorsExpanded: boolean;
  onUpdateProfile: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfileStatus: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfilePermission: (profile: AdminProfileSummary) => Promise<void>;
  onUpgradePreviewProfile: (profile: AdminProfileSummary) => Promise<void>;
  onClearSklandBinding: (profile: AdminProfileSummary) => Promise<void>;
  onClearWorkspace: (profile: AdminProfileSummary) => Promise<void>;
  onViewOperators: (profile: AdminProfileSummary) => Promise<void>;
  onDownloadOperators: (profile: AdminProfileSummary) => Promise<void>;
}) {
  const sklandSummary = profile.skland_binding
    ? `${profile.skland_binding.nickname || '-'} / ${profile.skland_binding.uid} / ${profile.skland_binding.channel_name || '-'}`
    : profile.skland_pending_binding
      ? `待确认：${profile.skland_pending_binding.nickname || '-'} / ${profile.skland_pending_binding.uid}`
      : '-'
  const riskCount = profile.skland_risk?.uid_mismatch_count ?? 0
  return (
    <article className="rounded-lg border border-surface-3 bg-surface-0 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink-primary">{profile.display_name || '账号档案'}</h3>
            <UserStatusPill status={profile.status} />
            <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold text-ink-secondary">{getAdminProfileAccessLabel(profile)}</span>
          </div>
          <p className="mt-2 break-all text-xs text-ink-muted">档案 ID：{profile.id}</p>
          {profile.note && <p className="mt-2 text-sm text-ink-secondary">{profile.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={() => void onUpdateProfile(profile)} loading={busyAction === `profile:update_profile:${profile.id}`}>改名称</SmallButton>
          <SmallButton onClick={() => void onSetProfileStatus(profile)} loading={busyAction === `profile:set_profile_status:${profile.id}`}>改状态</SmallButton>
          <SmallButton onClick={() => void onSetProfilePermission(profile)} loading={busyAction === `profile:set_profile_permission:${profile.id}`}>改权限</SmallButton>
          {profile.kind === 'free_preview' && <SmallButton onClick={() => void onUpgradePreviewProfile(profile)} loading={busyAction === `profile:upgrade_preview_profile:${profile.id}`} tone="success">免 CDK 升级</SmallButton>}
          <SmallButton onClick={() => void onViewOperators(profile)} loading={busyAction === `profile-operators:${profile.id}`}>{operatorsExpanded ? '收起干员' : '查看干员'}</SmallButton>
          <SmallButton onClick={() => void onDownloadOperators(profile)} loading={busyAction === `profile-operators-download:${profile.id}`}>下载 JSON</SmallButton>
          <SmallButton onClick={() => void onClearSklandBinding(profile)} loading={busyAction === `profile:clear_profile_skland_binding:${profile.id}`} tone="danger">清绑定</SmallButton>
          <SmallButton onClick={() => void onClearWorkspace(profile)} loading={busyAction === `profile:clear_profile_workspace:${profile.id}`} tone="danger">清工作区</SmallButton>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <DetailItem label="档案类型" value={profile.kind} />
        <DetailItem label="CDK 订单标识" value={profile.cdk_order_hash || profile.cdk?.license_order_hash || '-'} />
        <DetailItem label="森空岛绑定" value={sklandSummary} />
        <DetailItem label="绑定时间" value={formatDate(profile.skland_binding?.bound_at ?? null)} />
        <DetailItem label="最近导入" value={formatDate(profile.skland_binding?.last_imported_at ?? null)} />
        <DetailItem label="风险计数" value={String(riskCount)} />
        <DetailItem label="工作区存在" value={profile.workspace.exists ? '是' : '否'} />
        <DetailItem label="工作区干员" value={String(profile.workspace.operator_count)} />
        <DetailItem label="拥有干员" value={String(profile.operator_count)} />
        <DetailItem label="配置摘要" value={profile.workspace.config_desc || '-'} />
        <DetailItem label="最近结果" value={profile.workspace.has_last_result ? (profile.workspace.last_result_title || '有结果') : '无结果'} />
        <DetailItem label="结果更新时间" value={formatDate(profile.workspace.updated_at)} />
      </dl>

      {profile.cdk && (
        <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium text-ink-primary">{profile.cdk.cdk_id}</span>
            <StatusPill status={profile.cdk.status} />
            <span className="text-ink-secondary">{permissionLabels[profile.cdk.permission]}</span>
          </div>
          <div className="mt-2 grid gap-2 text-xs text-ink-muted sm:grid-cols-3">
            <span>备注：{profile.cdk.order_note || '-'}</span>
            <span>风险：{profile.cdk.risk_event_count}</span>
            <span>更新：{profile.cdk.operator_update_event_count}</span>
          </div>
        </div>
      )}
      {operatorsExpanded && operatorData && <ProfileOperatorsPanel data={operatorData} />}
    </article>
  )
}

function ProfileOperatorsPanel({ data }: { data: AdminProfileOperatorData }) {
  const operators = data.operators
  const sklandSummary = data.profile.skland_binding
    ? `${data.profile.skland_binding.nickname || '-'} / ${data.profile.skland_binding.uid} / ${data.profile.skland_binding.channel_name || '-'}`
    : '-'
  return (
    <div className="mt-4 border-t border-surface-3 pt-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-ink-primary">森空岛干员数据</h4>
          <p className="mt-1 text-xs text-ink-muted">生成时间：{formatDate(data.generated_at)}</p>
        </div>
        <div className="grid gap-2 text-xs text-ink-secondary sm:grid-cols-3 lg:min-w-[420px]">
          <span className="rounded-md bg-surface-2 px-2 py-1">总记录 {data.total_operator_records}</span>
          <span className="rounded-md bg-surface-2 px-2 py-1">拥有 {data.owned_operator_count}</span>
          <span className="rounded-md bg-surface-2 px-2 py-1">更新 {formatDate(data.profile.workspace_updated_at)}</span>
        </div>
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <DetailItem label="档案" value={data.profile.display_name || data.profile.id} />
        <DetailItem label="档案状态" value={appUserStatusLabels[data.profile.status]} />
        <DetailItem label="森空岛绑定" value={sklandSummary} />
      </dl>
      <div className="mt-3 overflow-x-auto rounded-lg border border-surface-3">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">干员</th>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">拥有</th>
              <th className="px-3 py-2">精英化</th>
              <th className="px-3 py-2">等级</th>
              <th className="px-3 py-2">稀有度</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3">
            {operators.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-muted">该档案暂无干员数据。</td></tr>
            ) : operators.map((operator, index) => (
              <tr key={`${operator.id}-${index}`} className="hover:bg-surface-2/50">
                <td className="px-3 py-2 font-medium text-ink-primary">{operator.name || '-'}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-muted">{operator.id || '-'}</td>
                <td className="px-3 py-2 text-ink-secondary">{operator.own === false ? '否' : '是'}</td>
                <td className="px-3 py-2 text-ink-secondary">{formatOperatorValue(operator.elite)}</td>
                <td className="px-3 py-2 text-ink-secondary">{formatOperatorValue(operator.level)}</td>
                <td className="px-3 py-2 text-ink-secondary">{formatOperatorValue(operator.rarity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CdkTable({ records, selected, filters, busyAction, onFilterChange, onSelect, onBulkRevoke, onPatch, onOpenDetail, onDelete }: {
  records: AdminCdkRecord[];
  selected: string[];
  filters: CdkTableFilters;
  busyAction: string | null;
  onFilterChange: (patch: Partial<CdkTableFilters>) => void;
  onSelect: (hashes: string[]) => void;
  onBulkRevoke: () => void;
  onPatch: (record: AdminCdkRecord, action: string, nextPermission?: GeneratedPermission, extraBody?: Record<string, unknown>) => Promise<void>;
  onOpenDetail: (record: AdminCdkRecord) => Promise<void>;
  onDelete: (record: AdminCdkRecord) => Promise<void>;
}) {
  const allSelected = records.length > 0 && records.every((record) => selected.includes(record.code_hash))
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1">
      <div className="flex flex-col gap-3 border-b border-surface-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {(['all', 'unused', 'used', 'frozen', 'revoked'] as StatusFilter[]).map((item) => (
            <button key={item} type="button" onClick={() => onFilterChange({ status: item })} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filters.status === item ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3'}`}>
              {item === 'all' ? '全部' : statusLabels[item]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onBulkRevoke} disabled={selected.length === 0} className="rounded-lg bg-error/10 px-3 py-2 text-sm font-semibold text-error hover:bg-error/20 disabled:bg-surface-2 disabled:text-ink-muted">批量撤销</button>
      </div>
      <div className="grid gap-3 border-b border-surface-3 p-4 md:grid-cols-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">权限</span>
          <select value={filters.permission} onChange={(event) => onFilterChange({ permission: event.currentTarget.value as PermissionFilter })} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary">
            <option value="all">全部权限</option>
            {cdkProductPermissions.map((item) => <option key={item} value={item}>{permissionLabels[item]}</option>)}
          </select>
        </label>
        <BinaryFilterSelect label="设备绑定" value={filters.bound} onChange={(value) => onFilterChange({ bound: value })} />
        <BinaryFilterSelect label="风险事件" value={filters.risk} onChange={(value) => onFilterChange({ risk: value })} />
        <BinaryFilterSelect label="生成过排班" value={filters.generated} onChange={(value) => onFilterChange({ generated: value })} />
      </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] table-fixed text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="w-12 px-4 py-3"><input type="checkbox" checked={allSelected} onChange={(event) => onSelect(event.currentTarget.checked ? records.map((record) => record.code_hash) : [])} /></th>
                <th className="w-36 px-4 py-3">CDK</th>
                <th className="w-32 px-4 py-3">状态</th>
                <th className="w-56 px-4 py-3">数据</th>
                <th className="w-44 px-4 py-3">时间</th>
                <th className="w-48 px-4 py-3">备注</th>
                <th className="w-64 px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
            {records.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-muted">当前筛选没有记录。</td></tr>
            ) : records.map((record) => {
              const nextPermission = getNextProductPermission(record.permission)
              return (
                <tr key={record.code_hash} className="hover:bg-surface-2/50">
                    <td className="px-4 py-4 align-top"><input type="checkbox" checked={selected.includes(record.code_hash)} onChange={(event) => onSelect(event.currentTarget.checked ? [...selected, record.code_hash] : selected.filter((hash) => hash !== record.code_hash))} /></td>
                    <td className="px-4 py-4 align-top font-mono text-ink-primary">{record.cdk_id}</td>
                    <td className="px-4 py-4 align-top"><StatusPill status={record.status} /><div className="mt-1 text-xs text-ink-muted">{permissionLabels[record.permission]}</div></td>
                    <td className="px-4 py-4 align-top text-ink-secondary">
                      <div>{record.operator_count ?? '-'} 干员 / 生成 {record.schedule_generate_count ?? 0}</div>
                      <div className="mt-1 text-xs text-ink-muted">终身更新 {record.operator_update_event_count ?? 0} / 风险 {record.risk_event_count ?? 0}</div>
                    </td>
                    <td className="px-4 py-4 align-top text-xs text-ink-secondary"><div>创建 {formatDate(record.created_at)}</div><div className="mt-1">使用 {formatDate(record.used_at)}</div></td>
                    <td className="px-4 py-4 align-top text-ink-secondary"><div className="truncate" title={record.order_note || undefined}>{record.order_note || '-'}</div></td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex min-w-0 flex-wrap gap-2">
                      <SmallButton onClick={() => void onOpenDetail(record)} loading={busyAction === `cdk-detail:${record.code_hash}`}>详情</SmallButton>
                      {nextPermission && record.status !== 'frozen' && record.status !== 'revoked' && <SmallButton onClick={() => onPatch(record, 'upgrade', nextPermission)} loading={busyAction === `upgrade:${record.code_hash}`}>升级</SmallButton>}
                      {record.status === 'frozen' && <SmallButton onClick={() => onPatch(record, 'unfreeze')} loading={busyAction === `unfreeze:${record.code_hash}`} tone="success">解冻</SmallButton>}
                      {(record.status === 'used' || record.status === 'frozen') && <SmallButton onClick={() => onPatch(record, 'revoke')} loading={busyAction === `revoke:${record.code_hash}`} tone="danger">撤销</SmallButton>}
                      {record.status === 'unused' && <SmallButton onClick={() => onDelete(record)} loading={busyAction === `delete:${record.code_hash}`} tone="danger">删除</SmallButton>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function BinaryFilterSelect({ label, value, onChange }: { label: string; value: BinaryFilter; onChange: (value: BinaryFilter) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-muted">{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value as BinaryFilter)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary">
        <option value="all">全部</option>
        <option value="yes">是</option>
        <option value="no">否</option>
      </select>
    </label>
  )
}

function CdkDetailPanel({
  detail,
  busyAction,
  onClose,
  onPatch,
  onUpdateNote,
  onSetPermission,
}: {
  detail: AdminCdkDetail;
  busyAction: string | null;
  onClose: () => void;
  onPatch: (record: AdminCdkRecord, action: string, nextPermission?: GeneratedPermission, extraBody?: Record<string, unknown>) => Promise<void>;
  onUpdateNote: (record: AdminCdkDetail) => Promise<void>;
  onSetPermission: (record: AdminCdkDetail) => Promise<void>;
}) {
  const nextPermission = getNextProductPermission(detail.permission)
  const canGrantOperatorUpdate = detail.status === 'used' && Boolean(detail.license_order_hash)
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1">
      <div className="flex flex-col gap-3 border-b border-surface-3 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-base font-semibold text-ink-primary">{detail.cdk_id}</h2>
            <StatusPill status={detail.status} />
            <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold text-ink-secondary">{permissionLabels[detail.permission]}</span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">订单备注：{detail.order_note || '-'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={() => void onUpdateNote(detail)} loading={busyAction === `update_note:${detail.code_hash}`}>改备注</SmallButton>
          {detail.status !== 'revoked' && <SmallButton onClick={() => void onSetPermission(detail)} loading={busyAction === `set_permission:${detail.code_hash}`}>改授权</SmallButton>}
          {nextPermission && detail.status !== 'frozen' && detail.status !== 'revoked' && <SmallButton onClick={() => void onPatch(detail, 'upgrade', nextPermission)} loading={busyAction === `upgrade:${detail.code_hash}`}>升级</SmallButton>}
          {canGrantOperatorUpdate && <SmallButton onClick={() => void onPatch(detail, 'grant_operator_update')} loading={busyAction === `grant_operator_update:${detail.code_hash}`}>发放更新</SmallButton>}
          {detail.status === 'frozen' && <SmallButton onClick={() => void onPatch(detail, 'unfreeze')} loading={busyAction === `unfreeze:${detail.code_hash}`} tone="success">解冻</SmallButton>}
          {(detail.status === 'used' || detail.status === 'frozen') && <SmallButton onClick={() => void onPatch(detail, 'revoke')} loading={busyAction === `revoke:${detail.code_hash}`} tone="danger">撤销</SmallButton>}
          <SmallButton onClick={onClose}>关闭</SmallButton>
        </div>
      </div>

      <div className="grid gap-5 p-4 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-lg border border-surface-3 bg-surface-0 p-4">
          <h3 className="text-sm font-semibold text-ink-primary">授权摘要</h3>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <DetailItem label="订单标识" value={detail.license_order_hash || '-'} />
            <DetailItem label="工作区干员" value={formatNullableNumber(detail.operator_count)} />
            <DetailItem label="初始干员数" value={formatNullableNumber(detail.baseline_operator_count)} />
            <DetailItem label="最近干员数" value={formatNullableNumber(detail.latest_operator_count)} />
            <DetailItem label="排班生成" value={String(detail.schedule_generate_count ?? 0)} />
            <DetailItem label="配置摘要" value={detail.config_desc || '-'} />
            <DetailItem label="创建时间" value={formatDate(detail.created_at)} />
            <DetailItem label="使用时间" value={formatDate(detail.used_at)} />
            <DetailItem label="冻结时间" value={formatDate(detail.frozen_at ?? null)} />
            <DetailItem label="撤销时间" value={formatDate(detail.revoked_at)} />
          </dl>
        </section>

        <section className="rounded-lg border border-surface-3 bg-surface-0 p-4">
          <h3 className="text-sm font-semibold text-ink-primary">设备和更新</h3>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <DetailItem label="设备绑定" value={(detail.device_signals?.activation_bound ?? detail.activation_bound) ? '已绑定' : '未绑定'} />
            <DetailItem label="UA 摘要数" value={String(detail.device_signals?.user_agent_count ?? detail.user_agent_count ?? 0)} />
            <DetailItem label="IP 段摘要数" value={String(detail.device_signals?.ip_prefix_count ?? detail.ip_prefix_count ?? 0)} />
            <DetailItem label="更新权限剩余" value={String(detail.operator_update_grant_remaining ?? 0)} />
            <DetailItem label="更新权限发放" value={String(detail.operator_update_grant_count ?? 0)} />
            <DetailItem label="更新权限使用" value={String(detail.operator_update_used_count ?? 0)} />
            <DetailItem label="发放时间" value={formatDate(detail.operator_update_granted_at ?? null)} />
            <DetailItem label="使用时间" value={formatDate(detail.operator_update_consumed_at ?? null)} />
          </dl>
          {detail.linked_account && (
            <p className="mt-4 break-all rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-secondary">
              关联用户：{detail.linked_account.account_id} / 档案 {detail.linked_account.profile_id}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-surface-3 bg-surface-0 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink-primary">风控事件</h3>
            <span className="text-xs text-ink-muted">{detail.risk_events?.length ?? 0} 条</span>
          </div>
          <div className="mt-4 space-y-3">
            {(detail.risk_events ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">暂无风控事件。</p>
            ) : (detail.risk_events ?? []).slice().reverse().slice(0, 8).map((event, index) => (
              <article key={`${event.at}-${index}`} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-primary">{event.type}</span>
                  <span className="text-xs text-ink-muted">{formatDate(event.at)}</span>
                </div>
                <p className="mt-1 text-ink-secondary">{event.reason}</p>
                {event.detail && <p className="mt-1 break-all text-xs text-ink-muted">{formatRiskDetail(event.detail)}</p>}
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-surface-3 bg-surface-0 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink-primary">干员更新事件</h3>
            <span className="text-xs text-ink-muted">{detail.operator_update_events?.length ?? 0} 条</span>
          </div>
          <div className="mt-4 space-y-3">
            {(detail.operator_update_events ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">暂无干员更新事件。</p>
            ) : (detail.operator_update_events ?? []).slice().reverse().slice(0, 8).map((event, index) => (
              <article key={`${event.at}-${index}`} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <div className="font-medium text-ink-primary">{event.operator_count} 名干员</div>
                <div className="mt-1 text-xs text-ink-muted">{formatDate(event.at)}</div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}

function RiskSettingsPanel({
  settings,
  saving,
  onChange,
}: {
  settings: RiskControlSettings;
  saving: boolean;
  onChange: (patch: RiskControlSettingsPatch) => Promise<void>;
}) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-3 p-4">
        <div>
          <h2 className="text-base font-semibold text-ink-primary">风控开关</h2>
          <p className="mt-1 text-sm text-ink-muted">设备风控默认关闭，避免浏览器或网络变化造成误触发。</p>
        </div>
        <span className="text-xs text-ink-muted">{saving ? '保存中...' : `更新 ${formatDate(settings.updated_at)}`}</span>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        <RiskToggle
          label="干员数据风控"
          description="校验干员消失、练度回退和拥有数异常下降。"
          checked={settings.operator_data_risk_enabled}
          disabled={saving}
          onChange={(checked) => onChange({ operator_data_risk_enabled: checked })}
        />
        <RiskToggle
          label="设备风控"
          description="校验设备 Token、浏览器环境和网络位置。"
          checked={settings.device_risk_enabled}
          disabled={saving}
          onChange={(checked) => onChange({ device_risk_enabled: checked })}
        />
      </div>
    </section>
  )
}

function RiskToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => Promise<void>;
}) {
  return (
    <label className={`flex min-h-28 items-start justify-between gap-4 rounded-lg border p-4 transition-colors duration-150 ${checked ? 'border-brand-500/50 bg-brand-500/10' : 'border-surface-3 bg-surface-2/40'} ${disabled ? 'opacity-70' : 'cursor-pointer hover:border-brand-400/60'}`}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-primary">{label}</span>
        <span className="mt-2 block text-sm leading-6 text-ink-secondary">{description}</span>
        <span className={`mt-3 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${checked ? 'bg-success/10 text-success' : 'bg-surface-3 text-ink-muted'}`}>{checked ? '已启用' : '已关闭'}</span>
      </span>
      <span className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors duration-150 ${checked ? 'bg-brand-600' : 'bg-surface-4'}`}>
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => void onChange(event.currentTarget.checked)}
        />
        <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
    </label>
  )
}

function RiskTable({ records, busyAction, onPatch, onOpenDetail }: { records: AdminCdkRecord[]; busyAction: string | null; onPatch: (record: AdminCdkRecord, action: string) => Promise<void>; onOpenDetail: (record: AdminCdkRecord) => Promise<void> }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1">
      <div className="border-b border-surface-3 p-4">
        <h2 className="text-base font-semibold text-ink-primary">风险记录</h2>
      </div>
      <div className="divide-y divide-surface-3">
        {records.length === 0 ? <div className="p-8 text-center text-sm text-ink-muted">暂无风险记录。</div> : records.map((record) => (
          <div key={record.code_hash} className="grid gap-3 p-4 lg:grid-cols-[180px_1fr_auto] lg:items-center">
            <div><div className="font-mono text-sm text-ink-primary">{record.cdk_id}</div><StatusPill status={record.status} /></div>
            <div className="text-sm text-ink-secondary">
              <div>{record.freeze_reason || record.latest_risk_event?.reason || '记录了风控事件'}</div>
              <div className="mt-1 text-xs text-ink-muted">风险 {record.risk_event_count ?? 0} / UA {record.user_agent_count ?? 0} / IP {record.ip_prefix_count ?? 0} / 冻结 {formatDate(record.frozen_at ?? null)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <SmallButton onClick={() => void onOpenDetail(record)} loading={busyAction === `cdk-detail:${record.code_hash}`}>详情</SmallButton>
              {record.status === 'frozen' && <SmallButton onClick={() => onPatch(record, 'unfreeze')} loading={busyAction === `unfreeze:${record.code_hash}`} tone="success">解冻</SmallButton>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Metric({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'warning' }) {
return <div className={`rounded-xl border p-4 ${tone === 'warning' ? 'border-warning/30 bg-warning/10' : 'border-surface-3 bg-surface-1'}`}>
<div className="text-2xl font-semibold text-ink-primary">{value}</div>
<div className="mt-1 text-sm text-ink-muted">{label}</div>
</div>
}

const EMPTY_LATENCY_STATS: UsageLatencyStats = {
  average_ms: 0,
  p50_ms: 0,
  p95_ms: 0,
  max_ms: 0,
  sample_count: 0,
  days: [],
}

const EMPTY_SKLAND_STATS: UsageSklandStats = {
  attempts: 0,
  success: 0,
  failed: 0,
  success_rate: 0,
  credential_invalid: 0,
  refresh_forbidden: 0,
  not_bound: 0,
  request_failed: 0,
  days: [],
}

const EMPTY_ANNOUNCEMENT_STATS: UsageAnnouncementStats = {
  impressions: 0,
  reads: 0,
  unread: 0,
  read_rate: 0,
}

function FunnelPanel({ steps }: { steps: UsageFunnelStep[] }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <h2 className="text-base font-semibold text-ink-primary">运营漏斗</h2>
      <div className="mt-4 space-y-3">
        {steps.length === 0 && <div className="rounded-lg bg-surface-2 px-4 py-6 text-center text-sm text-ink-muted">暂无漏斗数据</div>}
        {steps.map((step) => (
          <div key={step.key} className="rounded-lg bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-ink-primary">{step.label}</span>
              <span className="font-semibold text-ink-primary">{step.count}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, Math.max(0, step.conversion_rate))}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
              <span>转化 {step.conversion_rate}%</span>
              <span>掉失 {step.dropoff}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function FailureReasonPanel({ reasons, samples }: { reasons: UsageFailureReason[]; samples: UsageFailureSample[] }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink-primary">失败原因 Top</h2>
        <span className="text-xs text-ink-muted">稳定 reason_code</span>
      </div>
      <div className="mt-4 space-y-3">
        {reasons.length === 0 && <div className="rounded-lg bg-surface-2 px-4 py-6 text-center text-sm text-ink-muted">暂无失败事件</div>}
        {reasons.slice(0, 5).map((item) => (
          <div key={item.reason_code} className="rounded-lg bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-mono text-xs font-semibold text-ink-primary">{item.reason_code}</span>
              <span className="font-semibold text-ink-primary">{item.count}</span>
            </div>
            <div className="mt-2 text-xs text-ink-muted">{item.percentage}% · 最近 {formatDate(item.last_seen_at)}</div>
          </div>
        ))}
      </div>
      {samples.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-ink-muted">
              <tr>
                <th className="pb-2 pr-3 font-medium">时间</th>
                <th className="pb-2 pr-3 font-medium">事件</th>
                <th className="pb-2 pr-3 font-medium">原因</th>
                <th className="pb-2 font-medium">耗时</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {samples.slice(0, 5).map((sample) => (
                <tr key={`${sample.created_at}-${sample.event}-${sample.reason_code}`}>
                  <td className="py-2 pr-3 text-ink-secondary">{formatDate(sample.created_at)}</td>
                  <td className="py-2 pr-3 text-ink-secondary">{sample.event}</td>
                  <td className="py-2 pr-3 font-mono text-ink-primary">{sample.reason_code}</td>
                  <td className="py-2 text-ink-secondary">{sample.duration_ms === null ? '-' : formatDuration(sample.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function LatencyPanel({ stats }: { stats: UsageLatencyStats }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <h2 className="text-base font-semibold text-ink-primary">优化耗时</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <DetailItem label="平均" value={formatDuration(stats.average_ms)} />
        <DetailItem label="P50" value={formatDuration(stats.p50_ms)} />
        <DetailItem label="P95" value={formatDuration(stats.p95_ms)} />
        <DetailItem label="样本" value={String(stats.sample_count)} />
      </div>
      <div className="mt-4 space-y-2">
        {stats.days.slice(-7).map((day) => (
          <div key={day.date} className="grid grid-cols-[72px_1fr_64px] items-center gap-3 text-xs">
            <span className="text-ink-muted">{day.date.slice(5)}</span>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-warning" style={{ width: `${Math.min(100, day.p95_ms / 200)}%` }} />
            </div>
            <span className="text-right text-ink-secondary">{formatDuration(day.p95_ms)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function OpsSummaryPanel({ summary }: { summary: ReturnType<typeof buildSummary> }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <h2 className="text-base font-semibold text-ink-primary">运营摘要</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <InfoRow label="独立访客" value={String(summary.uniqueVisitors)} />
        <InfoRow label="访问次数" value={String(summary.visits)} />
        <InfoRow label="管理账号" value={String(summary.adminUsers)} />
        <InfoRow label="CDK 转化" value={`${summary.redeemRate}%`} />
      </dl>
    </section>
  )
}

function SklandPanel({ stats }: { stats: UsageSklandStats }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <h2 className="text-base font-semibold text-ink-primary">Skland 导入</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <InfoRow label="尝试" value={String(stats.attempts)} />
        <InfoRow label="成功" value={String(stats.success)} />
        <InfoRow label="失败" value={String(stats.failed)} />
        <InfoRow label="成功率" value={`${stats.success_rate}%`} />
        <InfoRow label="凭据失效" value={String(stats.credential_invalid)} />
      </dl>
    </section>
  )
}

function AnnouncementStatsPanel({ stats }: { stats: UsageAnnouncementStats }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <h2 className="text-base font-semibold text-ink-primary">公告触达</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <InfoRow label="触达" value={String(stats.impressions)} />
        <InfoRow label="已读" value={String(stats.reads)} />
        <InfoRow label="未读估算" value={String(stats.unread)} />
        <InfoRow label="阅读率" value={`${stats.read_rate}%`} />
      </dl>
    </section>
  )
}

function AnnouncementReachMetrics({ stats }: { stats: AnnouncementReachStats }) {
  return (
    <dl className="mt-4 grid gap-y-3 border-y border-surface-3 py-3 text-sm sm:grid-cols-4 sm:divide-x sm:divide-surface-3">
      <div className="sm:px-3 first:sm:pl-0">
        <dt className="text-xs text-ink-muted">触达</dt>
        <dd className="mt-1 font-semibold text-ink-primary">{stats.impressions}</dd>
      </div>
      <div className="sm:px-3">
        <dt className="text-xs text-ink-muted">已读</dt>
        <dd className="mt-1 font-semibold text-ink-primary">{stats.reads}</dd>
        <dd className="mt-0.5 text-xs text-ink-muted">账号 {stats.server_reads} / 本地 {stats.local_reads}</dd>
      </div>
      <div className="sm:px-3">
        <dt className="text-xs text-ink-muted">未读估算</dt>
        <dd className="mt-1 font-semibold text-ink-primary">{stats.unread}</dd>
      </div>
      <div className="sm:px-3">
        <dt className="text-xs text-ink-muted">阅读率</dt>
        <dd className="mt-1 font-semibold text-ink-primary">{stats.read_rate}%</dd>
      </div>
    </dl>
  )
}

function CdkDistributionPanel({ items }: { items: UsageCdkDistributionItem[] }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <h2 className="text-base font-semibold text-ink-primary">CDK 兑换事件分布</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs text-ink-muted">
            <tr>
              <th className="pb-2 pr-4 font-medium">权限</th>
              <th className="pb-2 pr-4 font-medium">总量</th>
              <th className="pb-2 pr-4 font-medium">成功</th>
              <th className="pb-2 font-medium">失败</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3">
            {items.length === 0 && (
              <tr><td colSpan={4} className="py-5 text-center text-sm text-ink-muted">暂无 CDK 兑换事件</td></tr>
            )}
            {items.map((item) => (
              <tr key={item.permission}>
                <td className="py-3 pr-4 font-medium text-ink-primary">{permissionLabels[item.permission as Permission] ?? item.permission}</td>
                <td className="py-3 pr-4 text-ink-secondary">{item.total}</td>
                <td className="py-3 pr-4 text-success">{item.success}</td>
                <td className="py-3 text-error">{item.failure}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CdkRecordDistributionPanel({ summary }: { summary: CdkOpsSummary }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-ink-primary">CDK 权限与状态分布</h2>
        <span className="text-xs text-ink-muted">基于当前 CDK 记录</span>
      </div>
      <div className="mt-4 grid gap-5 xl:grid-cols-[1fr_0.75fr]">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs text-ink-muted">
              <tr>
                <th className="pb-2 pr-4 font-medium">权限</th>
                <th className="pb-2 pr-4 font-medium">总量</th>
                <th className="pb-2 pr-4 font-medium">未用</th>
                <th className="pb-2 pr-4 font-medium">已用</th>
                <th className="pb-2 pr-4 font-medium">冻结</th>
                <th className="pb-2 font-medium">撤销</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {summary.permission_distribution.map((item) => (
                <tr key={item.permission}>
                  <td className="py-3 pr-4 font-medium text-ink-primary">{permissionLabels[item.permission] ?? item.permission}</td>
                  <td className="py-3 pr-4 text-ink-secondary">{item.total}</td>
                  <td className="py-3 pr-4 text-ink-secondary">{item.unused}</td>
                  <td className="py-3 pr-4 text-ink-secondary">{item.used}</td>
                  <td className="py-3 pr-4 text-warning">{item.frozen}</td>
                  <td className="py-3 text-error">{item.revoked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {summary.status_distribution.map((item) => (
            <div key={item.status} className="rounded-lg bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <StatusPill status={item.status} />
                <span className="text-lg font-semibold text-ink-primary">{item.total}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function RiskConsoleSummary({ summary }: { summary: CdkOpsSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="风险 CDK" value={summary.risk_records} tone={summary.risk_records > 0 ? 'warning' : 'default'} />
      <Metric label="软拦截" value={summary.soft_blocks} tone={summary.soft_blocks > 0 ? 'warning' : 'default'} />
      <Metric label="冻结事件" value={summary.freezes} tone={summary.freezes > 0 ? 'warning' : 'default'} />
      <Metric label="升级冻结" value={summary.escalations} tone={summary.escalations > 0 ? 'warning' : 'default'} />
      <Metric label="设备绑定" value={summary.bound_records} />
    </div>
  )
}

function RiskTrendPanel({ days }: { days: RiskTrendDay[] }) {
  const maxValue = Math.max(1, ...days.map((day) => day.total))
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <h2 className="text-base font-semibold text-ink-primary">风控趋势</h2>
      <div className="mt-4 space-y-2">
        {days.length === 0 && <div className="rounded-lg bg-surface-2 px-4 py-6 text-center text-sm text-ink-muted">暂无风控趋势数据</div>}
        {days.map((day) => (
          <div key={day.date} className="grid grid-cols-[72px_1fr_116px] items-center gap-3 text-xs">
            <span className="text-ink-muted">{day.date.slice(5)}</span>
            <div className="flex h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="bg-warning" style={{ width: `${(day.soft_blocks / maxValue) * 100}%` }} />
              <div className="bg-error" style={{ width: `${(day.freezes / maxValue) * 100}%` }} />
            </div>
            <span className="text-right text-ink-secondary">软 {day.soft_blocks} / 冻 {day.freezes}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function RiskReasonPanel({ reasons, onOpenDetail }: { reasons: RiskReasonStats[]; onOpenDetail: (record: AdminCdkRecord) => Promise<void> }) {
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
      <h2 className="text-base font-semibold text-ink-primary">风险原因分布</h2>
      <div className="mt-4 space-y-3">
        {reasons.length === 0 && <div className="rounded-lg bg-surface-2 px-4 py-6 text-center text-sm text-ink-muted">暂无风险原因</div>}
        {reasons.slice(0, 6).map((item) => (
          <div key={`${item.type}:${item.reason}`} className="rounded-lg bg-surface-2 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium text-ink-primary">{item.type}</div>
                <div className="mt-1 line-clamp-2 text-sm text-ink-secondary">{item.reason}</div>
                <div className="mt-1 text-xs text-ink-muted">最近 {formatDate(item.last_seen_at)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-md bg-surface-1 px-2 py-1 text-sm font-semibold text-ink-primary">{item.count}</span>
                {item.latest_record && <SmallButton onClick={() => void onOpenDetail(item.latest_record!)}>详情</SmallButton>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

type TrendMetricKey = 'visits' | 'schedule_generates' | 'cdk_redeems'

const trendMetrics: Array<{ key: TrendMetricKey; label: string; stroke: string; dasharray?: string }> = [
  { key: 'visits', label: '访问', stroke: 'var(--color-brand-500)' },
  { key: 'schedule_generates', label: '生成', stroke: 'var(--color-warning)', dasharray: '8 5' },
  { key: 'cdk_redeems', label: '兑换', stroke: 'var(--color-success)', dasharray: '2 5' },
]

const trendChart = {
  width: 640,
  height: 260,
  left: 44,
  right: 18,
  top: 20,
  bottom: 38,
}

function UsageTrendChart({ days }: { days: UsageDay[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  if (days.length === 0) {
    return (
      <div className="mt-5 flex h-64 w-full items-center justify-center rounded-lg bg-surface-2 text-sm text-ink-muted">
        暂无趋势数据
      </div>
    )
  }

  const plotWidth = trendChart.width - trendChart.left - trendChart.right
  const plotHeight = trendChart.height - trendChart.top - trendChart.bottom
  const maxValue = Math.max(0, ...days.flatMap((day) => trendMetrics.map((metric) => Number(day[metric.key]) || 0)))
  const yMax = Math.max(1, maxValue)
  const yTicks = buildTrendTicks(yMax)
  const yFor = (value: number) => trendChart.top + plotHeight - (value / yMax) * plotHeight
  const xFor = (index: number) => trendChart.left + (days.length === 1 ? plotWidth / 2 : (plotWidth * index) / (days.length - 1))
  const points = days.map((day, index) => ({
    day,
    x: xFor(index),
    values: trendMetrics.map((metric) => ({
      ...metric,
      value: Number(day[metric.key]) || 0,
      y: yFor(Number(day[metric.key]) || 0),
    })),
  }))
  const activePoint = activeIndex === null ? null : points[activeIndex]
  const tooltipLeft = activePoint ? Math.min(82, Math.max(18, (activePoint.x / trendChart.width) * 100)) : 50
  const tooltipTop = activePoint
    ? Math.min(72, Math.max(12, (Math.min(...activePoint.values.map((value) => value.y)) / trendChart.height) * 100))
    : 50

  return (
    <div className="relative mt-5 h-64 overflow-hidden rounded-lg bg-surface-2/80 p-3 sm:h-72">
      <div className="absolute right-3 top-3 z-10 flex flex-wrap justify-end gap-2 text-xs text-ink-secondary">
        {trendMetrics.map((metric) => (
          <span key={metric.key} className="inline-flex items-center gap-1.5 rounded-md bg-surface-1/90 px-2 py-1">
            <span
              aria-hidden="true"
              className="h-0.5 w-5 rounded-full"
              style={{
                backgroundColor: metric.stroke,
                backgroundImage: metric.dasharray ? `repeating-linear-gradient(90deg, ${metric.stroke} 0 6px, transparent 6px 10px)` : undefined,
              }}
            />
            {metric.label}
          </span>
        ))}
      </div>
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${trendChart.width} ${trendChart.height}`}
        role="img"
        aria-labelledby="usage-trend-title usage-trend-desc"
        onMouseLeave={() => setActiveIndex(null)}
      >
        <title id="usage-trend-title">7 日趋势</title>
        <desc id="usage-trend-desc">最近 7 日访问、生成、兑换三项指标的趋势折线图。</desc>
        {yTicks.map((tick) => {
          const y = yFor(tick)
          return (
            <g key={tick}>
              <line x1={trendChart.left} x2={trendChart.width - trendChart.right} y1={y} y2={y} stroke="var(--color-surface-3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <text x={trendChart.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-muted)">
                {tick}
              </text>
            </g>
          )
        })}
        <line x1={trendChart.left} x2={trendChart.left} y1={trendChart.top} y2={trendChart.top + plotHeight} stroke="var(--color-surface-4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1={trendChart.left} x2={trendChart.width - trendChart.right} y1={trendChart.top + plotHeight} y2={trendChart.top + plotHeight} stroke="var(--color-surface-4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {trendMetrics.map((metric) => (
          <path
            key={metric.key}
            d={buildTrendPath(points.map((point) => ({ x: point.x, y: point.values.find((value) => value.key === metric.key)?.y ?? yFor(0) })))}
            fill="none"
            stroke={metric.stroke}
            strokeWidth="2.5"
            strokeDasharray={metric.dasharray}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {points.map((point) => (
          <g key={point.day.date}>
            {point.values.map((value) => (
              <circle key={value.key} cx={point.x} cy={value.y} r={activePoint?.day.date === point.day.date ? 4 : 3} fill="var(--color-surface-1)" stroke={value.stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            ))}
            <text x={point.x} y={trendChart.height - 12} textAnchor="middle" fontSize="11" fill="var(--color-ink-muted)">
              {point.day.date.slice(5)}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const previousX = index === 0 ? trendChart.left : (points[index - 1].x + point.x) / 2
          const nextX = index === points.length - 1 ? trendChart.width - trendChart.right : (point.x + points[index + 1].x) / 2
          return (
            <rect
              key={`${point.day.date}-hit`}
              x={previousX}
              y={trendChart.top}
              width={Math.max(16, nextX - previousX)}
              height={plotHeight}
              fill="transparent"
              tabIndex={0}
              aria-label={`${point.day.date}，访问 ${point.day.visits}，生成 ${point.day.schedule_generates}，兑换 ${point.day.cdk_redeems}`}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              onMouseEnter={() => setActiveIndex(index)}
            />
          )
        })}
      </svg>
      {activePoint && (
        <div
          className="pointer-events-none absolute z-20 min-w-36 -translate-x-1/2 rounded-lg border border-surface-3 bg-surface-1 px-3 py-2 text-xs shadow-lg"
          style={{ left: `${tooltipLeft}%`, top: `${tooltipTop}%` }}
        >
          <div className="mb-1 font-semibold text-ink-primary">{activePoint.day.date}</div>
          <div className="space-y-1 text-ink-secondary">
            {activePoint.values.map((value) => (
              <div key={value.key} className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: value.stroke }} />
                  {value.label}
                </span>
                <span className="font-medium text-ink-primary">{value.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <dl className="sr-only">
        {days.map((day) => (
          <div key={day.date}>
            <dt>{day.date}</dt>
            <dd>
              访问 {day.visits}，生成 {day.schedule_generates}，兑换 {day.cdk_redeems}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function buildTrendTicks(maxValue: number) {
  if (maxValue <= 3) {
    return Array.from({ length: maxValue + 1 }, (_, index) => maxValue - index)
  }
  return Array.from(new Set([maxValue, Math.round(maxValue * 0.66), Math.round(maxValue * 0.33), 0]))
}

function buildTrendPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 1) {
    const [point] = points
    return `M ${point.x - 12} ${point.y} L ${point.x + 12} ${point.y}`
  }
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function InfoRow({ label, value }: { label: string; value: string }) {
return <div className="flex items-center justify-between gap-4 border-b border-surface-3 pb-2 last:border-0"><dt className="text-ink-muted">{label}</dt><dd className="font-medium text-ink-primary">{value}</dd></div>
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-ink-primary">{value}</dd>
    </div>
  )
}

function StatusPill({ status }: { status: CdkStatus }) {
  const className = status === 'unused'
    ? 'bg-success/10 text-success'
    : status === 'frozen'
      ? 'bg-warning/10 text-warning'
      : status === 'revoked'
        ? 'bg-error/10 text-error'
        : 'bg-surface-3 text-ink-secondary'
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${className}`}>{statusLabels[status]}</span>
}

function UserStatusPill({ status }: { status: AppUserStatus }) {
  const className = status === 'active'
    ? 'bg-success/10 text-success'
    : status === 'frozen'
      ? 'bg-warning/10 text-warning'
      : 'bg-error/10 text-error'
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${className}`}>{appUserStatusLabels[status]}</span>
}

function SmallButton({ children, onClick, loading, tone = 'default', autoFocus = false }: { children: string; onClick: () => void; loading?: boolean; tone?: 'default' | 'success' | 'danger'; autoFocus?: boolean }) {
  const className = tone === 'danger'
    ? 'bg-error/10 text-error hover:bg-error/20'
    : tone === 'success'
      ? 'bg-success/10 text-success hover:bg-success/20'
      : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'
  return <button type="button" onClick={onClick} disabled={loading} autoFocus={autoFocus} data-dialog-initial-focus={autoFocus ? '' : undefined} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:bg-surface-3 disabled:text-ink-muted ${className}`}>{loading ? '处理中' : children}</button>
}

function buildSummary(records: AdminCdkRecord[], usage?: UsageTotals, adminUsers = 0) {
const totalCdks = records.length
const usedCdks = records.filter((record) => record.status === 'used').length
const frozenCdks = records.filter((record) => record.status === 'frozen').length
const riskEvents = records.reduce((sum, record) => sum + (record.risk_event_count ?? 0), 0)
const boundDevices = records.filter((record) => record.activation_bound).length
const scheduleGenerates = usage?.schedule_generates ?? 0
const scheduleFailures = usage?.schedule_failures ?? 0
const scheduleAttempts = scheduleGenerates + scheduleFailures
  return {
    totalCdks,
    usedCdks,
    frozenCdks,
    riskEvents,
    boundDevices,
    adminUsers,
    uniqueVisitors: usage?.unique_visitors ?? 0,
    visits: usage?.visits ?? 0,
    freePreviews: usage?.free_previews ?? 0,
    registers: usage?.registers ?? 0,
    scheduleGenerates,
    scheduleFailures,
    scheduleAttempts,
    scheduleSuccessRate: scheduleAttempts ? Math.round((scheduleGenerates / scheduleAttempts) * 1000) / 10 : 0,
    cdkRedeems: usage?.cdk_redeems ?? 0,
    redeemRate: usage?.visits ? Math.round(((usage?.cdk_redeems ?? 0) / usage.visits) * 1000) / 10 : 0,
  }
}

function recordMatchesCdkFilters(record: AdminCdkRecord, filters: CdkTableFilters): boolean {
  if (filters.status !== 'all' && record.status !== filters.status) return false
  if (filters.permission !== 'all' && normalizeProductPermission(record.permission) !== filters.permission) return false
  if (filters.bound !== 'all' && Boolean(record.activation_bound) !== (filters.bound === 'yes')) return false
  if (filters.risk !== 'all' && ((record.risk_event_count ?? 0) > 0) !== (filters.risk === 'yes')) return false
  if (filters.generated !== 'all' && ((record.schedule_generate_count ?? 0) > 0) !== (filters.generated === 'yes')) return false
  return true
}

function buildCdkOpsSummary(records: AdminCdkRecord[]): CdkOpsSummary {
  const permissionMap = new Map<Permission, CdkPermissionDistribution>()
  for (const permission of cdkProductPermissions) {
    permissionMap.set(permission, { permission, total: 0, unused: 0, used: 0, frozen: 0, revoked: 0 })
  }
  const statusMap = new Map<CdkStatus, CdkStatusDistribution>(
    (['unused', 'used', 'frozen', 'revoked'] as CdkStatus[]).map((status) => [status, { status, total: 0 }]),
  )
  const reasonMap = new Map<string, RiskReasonStats>()
  const trendMap = new Map<string, RiskTrendDay>()
  let softBlocks = 0
  let escalations = 0

  for (const record of records) {
    const permission = normalizeProductPermission(record.permission) ?? record.permission
    const distribution = permissionMap.get(permission) ?? { permission, total: 0, unused: 0, used: 0, frozen: 0, revoked: 0 }
    distribution.total += 1
    distribution[record.status] += 1
    permissionMap.set(permission, distribution)

    const statusDistribution = statusMap.get(record.status)
    if (statusDistribution) statusDistribution.total += 1

    for (const event of record.risk_events ?? []) {
      const date = event.at.slice(0, 10)
      const trend = trendMap.get(date) ?? { date, soft_blocks: 0, freezes: 0, escalations: 0, total: 0 }
      trend.total += 1
      if (event.soft_block) {
        trend.soft_blocks += 1
        softBlocks += 1
      }
      if (event.escalation) {
        trend.escalations += 1
        escalations += 1
      }
      if (record.status === 'frozen' && record.latest_risk_event?.at === event.at) {
        trend.freezes += 1
      }
      trendMap.set(date, trend)

      const key = `${event.type}:${event.reason}`
      const current = reasonMap.get(key) ?? {
        type: event.type,
        reason: event.reason,
        count: 0,
        last_seen_at: null,
        latest_record: null,
      }
      current.count += 1
      if (!current.last_seen_at || Date.parse(event.at) > Date.parse(current.last_seen_at)) {
        current.last_seen_at = event.at
        current.latest_record = record
      }
      reasonMap.set(key, current)
    }
  }

  return {
    permission_distribution: [...permissionMap.values()].filter((item) => item.total > 0),
    status_distribution: [...statusMap.values()],
    risk_reasons: [...reasonMap.values()].sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count
      return (Date.parse(right.last_seen_at ?? '') || 0) - (Date.parse(left.last_seen_at ?? '') || 0)
    }),
    risk_trend: buildRiskTrendDays(trendMap),
    soft_blocks: softBlocks,
    freezes: records.filter((record) => record.status === 'frozen').length,
    escalations,
    risk_records: records.filter((record) => (record.risk_event_count ?? 0) > 0 || record.status === 'frozen').length,
    generated_records: records.filter((record) => (record.schedule_generate_count ?? 0) > 0).length,
    bound_records: records.filter((record) => record.activation_bound).length,
  }
}

function buildRiskTrendDays(trendMap: Map<string, RiskTrendDay>): RiskTrendDay[] {
  const dates: string[] = []
  const now = new Date()
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)).toISOString().slice(0, 10)
    dates.push(date)
  }
  return dates.map((date) => trendMap.get(date) ?? { date, soft_blocks: 0, freezes: 0, escalations: 0, total: 0 })
}

function buildUsageStatsQuery(range: UsageRangeMode, from: string, to: string): string | null {
  if (range !== 'custom') return `range=${range}`
  if (!isDateInputString(from) || !isDateInputString(to) || from > to) return null
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
}

function getDateOffsetString(offset: number): string {
  const now = new Date()
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - offset))
  return date.toISOString().slice(0, 10)
}

function isDateInputString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeUsageTotals(value: Partial<UsageTotals> | undefined): UsageTotals {
  return {
    unique_visitors: normalizeCount(value?.unique_visitors),
    visits: normalizeCount(value?.visits),
    free_previews: normalizeCount(value?.free_previews),
    registers: normalizeCount(value?.registers),
    schedule_generates: normalizeCount(value?.schedule_generates),
    cdk_redeems: normalizeCount(value?.cdk_redeems),
    failures: normalizeCount(value?.failures),
    schedule_failures: normalizeCount(value?.schedule_failures),
    cdk_redeem_failures: normalizeCount(value?.cdk_redeem_failures),
    skland_imports: normalizeCount(value?.skland_imports),
    skland_import_failures: normalizeCount(value?.skland_import_failures),
    announcement_impressions: normalizeCount(value?.announcement_impressions),
    announcement_reads: normalizeCount(value?.announcement_reads),
  }
}

function normalizeUsageDay(day: Partial<UsageDay>): UsageDay {
  return { date: typeof day.date === 'string' ? day.date : '', ...normalizeUsageTotals(day) }
}

function normalizeUsageStats(value: Partial<UsageStatsResponse>): UsageStatsResponse {
  const totals = normalizeUsageTotals(value.totals)
  const days = Array.isArray(value.days) ? value.days.map(normalizeUsageDay) : []
  return {
    totals,
    days,
    range: normalizeUsageRange(value.range, days),
    funnel: Array.isArray(value.funnel) ? value.funnel.map(normalizeFunnelStep) : [],
    failure_reasons: Array.isArray(value.failure_reasons) ? value.failure_reasons.map(normalizeFailureReason) : [],
    recent_failures: Array.isArray(value.recent_failures) ? value.recent_failures.map(normalizeFailureSample) : [],
    latency: {
      schedule_generate: normalizeLatencyStats(value.latency?.schedule_generate),
    },
    skland: normalizeSklandStats(value.skland),
    announcement: normalizeAnnouncementStats(value.announcement),
    cdk_distribution: Array.isArray(value.cdk_distribution) ? value.cdk_distribution.map(normalizeCdkDistributionItem) : [],
  }
}

function normalizeUsageRange(value: Partial<UsageRange> | undefined, days: UsageDay[]): UsageRange {
  return {
    from: typeof value?.from === 'string' ? value.from : days[0]?.date ?? '',
    to: typeof value?.to === 'string' ? value.to : days[days.length - 1]?.date ?? '',
    days: normalizeCount(value?.days) || days.length,
  }
}

function normalizeFunnelStep(value: Partial<UsageFunnelStep>): UsageFunnelStep {
  return {
    key: typeof value.key === 'string' ? value.key : '',
    label: typeof value.label === 'string' ? value.label : '',
    count: normalizeCount(value.count),
    conversion_rate: normalizeNumber(value.conversion_rate),
    dropoff: normalizeCount(value.dropoff),
  }
}

function normalizeFailureReason(value: Partial<UsageFailureReason>): UsageFailureReason {
  return {
    reason_code: typeof value.reason_code === 'string' ? value.reason_code : 'unknown_failure',
    count: normalizeCount(value.count),
    percentage: normalizeNumber(value.percentage),
    last_seen_at: typeof value.last_seen_at === 'string' ? value.last_seen_at : null,
    events: value.events && typeof value.events === 'object' ? value.events : {},
  }
}

function normalizeFailureSample(value: Partial<UsageFailureSample>): UsageFailureSample {
  return {
    created_at: typeof value.created_at === 'string' ? value.created_at : '',
    event: typeof value.event === 'string' ? value.event : '',
    reason_code: typeof value.reason_code === 'string' ? value.reason_code : 'unknown_failure',
    duration_ms: typeof value.duration_ms === 'number' && Number.isFinite(value.duration_ms) ? value.duration_ms : null,
    permission: typeof value.permission === 'string' ? value.permission : null,
    cdk_status: typeof value.cdk_status === 'string' ? value.cdk_status : null,
    source: typeof value.source === 'string' ? value.source : null,
    has_profile: value.has_profile === true,
  }
}

function normalizeLatencyStats(value: Partial<UsageLatencyStats> | undefined): UsageLatencyStats {
  return {
    average_ms: normalizeCount(value?.average_ms),
    p50_ms: normalizeCount(value?.p50_ms),
    p95_ms: normalizeCount(value?.p95_ms),
    max_ms: normalizeCount(value?.max_ms),
    sample_count: normalizeCount(value?.sample_count),
    days: Array.isArray(value?.days)
      ? value.days.map((day) => ({
        date: typeof day.date === 'string' ? day.date : '',
        average_ms: normalizeCount(day.average_ms),
        p95_ms: normalizeCount(day.p95_ms),
        sample_count: normalizeCount(day.sample_count),
      }))
      : [],
  }
}

function normalizeSklandStats(value: Partial<UsageSklandStats> | undefined): UsageSklandStats {
  return {
    attempts: normalizeCount(value?.attempts),
    success: normalizeCount(value?.success),
    failed: normalizeCount(value?.failed),
    success_rate: normalizeNumber(value?.success_rate),
    credential_invalid: normalizeCount(value?.credential_invalid),
    refresh_forbidden: normalizeCount(value?.refresh_forbidden),
    not_bound: normalizeCount(value?.not_bound),
    request_failed: normalizeCount(value?.request_failed),
    days: Array.isArray(value?.days)
      ? value.days.map((day) => ({
        date: typeof day.date === 'string' ? day.date : '',
        attempts: normalizeCount(day.attempts),
        success: normalizeCount(day.success),
        failed: normalizeCount(day.failed),
        success_rate: normalizeNumber(day.success_rate),
      }))
      : [],
  }
}

function normalizeAnnouncementStats(value: Partial<UsageAnnouncementStats> | undefined): UsageAnnouncementStats {
  return {
    impressions: normalizeCount(value?.impressions),
    reads: normalizeCount(value?.reads),
    unread: normalizeCount(value?.unread),
    read_rate: normalizeNumber(value?.read_rate),
  }
}

function normalizeCdkDistributionItem(value: Partial<UsageCdkDistributionItem>): UsageCdkDistributionItem {
  return {
    permission: typeof value.permission === 'string' ? value.permission : 'unknown',
    total: normalizeCount(value.total),
    success: normalizeCount(value.success),
    failure: normalizeCount(value.failure),
    statuses: value.statuses && typeof value.statuses === 'object' ? value.statuses : {},
  }
}

function normalizeRiskSettings(value: Partial<RiskControlSettings> | null | undefined): RiskControlSettings {
  return {
    operator_data_risk_enabled: value?.operator_data_risk_enabled !== false,
    device_risk_enabled: value?.device_risk_enabled === true,
    updated_at: typeof value?.updated_at === 'string' ? value.updated_at : null,
  }
}

function normalizeCount(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function normalizeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 10) / 10 : 0
}

function normalizeAnnouncementList(value: Announcement[] | null | undefined): Announcement[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Announcement => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' && item.id ? item.id : createDraftId(),
      kind: item.kind === 'banner' || item.kind === 'popup' ? item.kind : 'popup',
      active: item.active === true,
      title: typeof item.title === 'string' ? item.title : '',
      body: typeof item.body === 'string' ? item.body : '',
      created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString(),
      updated_at: typeof item.updated_at === 'string' ? item.updated_at : new Date().toISOString(),
    }))
}

function normalizeAnnouncementStatsMap(
  value: Partial<Record<string, Partial<AnnouncementReachStats>>> | null | undefined,
  announcements: Announcement[],
): Record<string, AnnouncementReachStats> {
  const source = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(
    announcements.map((announcement) => [announcement.id, normalizeAnnouncementReachStats(source[announcement.id])]),
  )
}

function normalizeAnnouncementReachStats(value: Partial<AnnouncementReachStats> | undefined): AnnouncementReachStats {
  return {
    impressions: normalizeCount(value?.impressions),
    reads: normalizeCount(value?.reads),
    server_reads: normalizeCount(value?.server_reads),
    local_reads: normalizeCount(value?.local_reads),
    unread: normalizeCount(value?.unread),
    read_rate: normalizeNumber(value?.read_rate),
  }
}

function sortAnnouncements(items: Announcement[], sort: AnnouncementSortKey): Announcement[] {
  const next = [...items]
  return next.sort((left, right) => {
    if (sort === 'updated_asc') return compareAnnouncementUpdatedAt(left, right)
    if (sort === 'kind') {
      const kindCompare = announcementKindRank(left.kind) - announcementKindRank(right.kind)
      return kindCompare || compareAnnouncementUpdatedAtDesc(left, right)
    }
    if (sort === 'active') {
      const activeCompare = Number(right.active) - Number(left.active)
      return activeCompare || compareAnnouncementUpdatedAtDesc(left, right)
    }
    return compareAnnouncementUpdatedAtDesc(left, right)
  })
}

function compareAnnouncementUpdatedAt(left: Announcement, right: Announcement): number {
  return (Date.parse(left.updated_at) || 0) - (Date.parse(right.updated_at) || 0)
}

function compareAnnouncementUpdatedAtDesc(left: Announcement, right: Announcement): number {
  return compareAnnouncementUpdatedAt(right, left)
}

function announcementKindRank(kind: AnnouncementKind): number {
  return kind === 'banner' ? 0 : 1
}

function createDraftAnnouncement(kind: AnnouncementKind): Announcement {
  const now = new Date().toISOString()
  return {
    id: createDraftId(),
    kind,
    active: false,
    title: '',
    body: '',
    created_at: now,
    updated_at: now,
  }
}

function createDraftId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `draft_${crypto.randomUUID()}`
  return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${Math.round(value / 100) / 10}s`
}

function validateEmailInput(value: string): string | null {
  const email = value.trim()
  if (!email) return '请输入邮箱'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '请输入正确的邮箱地址'
  return null
}

function validatePasswordInput(value: string): string | null {
  if (!value) return '请输入密码'
  if (value.length < 8) return '密码至少需要 8 位'
  return null
}

function omitFieldError(errors: FieldErrors, field: string): FieldErrors {
  if (!errors[field]) return errors
  const next = { ...errors }
  delete next[field]
  return next
}

function inputClassName(hasError: boolean): string {
  const base = 'w-full rounded-lg border px-3 py-2 text-sm text-ink-primary outline-none transition-colors duration-150 focus:ring-2'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : 'border-surface-4 bg-surface-0 focus:border-brand-500 focus:ring-brand-500/20'
  return `${base} ${state}`
}

function getNextProductPermission(permission: Permission): GeneratedPermission | null {
  const current = permission === 'basic' ? 'growth' : permission === 'premium' ? 'advanced' : cdkProductPermissions.includes(permission as GeneratedPermission) ? permission as GeneratedPermission : null
  if (!current) return null
  return cdkProductPermissions.find((item) => cdkProductPermissionRank[item] === cdkProductPermissionRank[current] + 1) ?? null
}

function getAdminProfileAccessLabel(profile: AdminProfileAccessSummary): string {
  if (profile.kind === 'free_preview') return '免费预览'
  if (profile.kind === 'depot_value') return '仓库分析'
  return permissionLabels[profile.permission] ?? profile.permission
}

function formatAdminProfileAccess(profileAccess: AdminProfileAccessSummary[]): string {
  const labels = [...new Set(profileAccess.map(getAdminProfileAccessLabel))]
  return labels.length > 0 ? labels.join(' / ') : '-'
}

function normalizeGeneratedCdks(data: AdminCdkCreateResponse): GeneratedCdk[] {
  const cdks = Array.isArray(data.cdks)
    ? data.cdks
      .map((item) => {
        const permission = typeof item.permission === 'string' ? normalizeProductPermission(item.permission) : null
        if (typeof item.code !== 'string' || !item.code.trim() || !permission || typeof item.created_at !== 'string') return null
        return { code: item.code, permission, created_at: item.created_at }
      })
      .filter((item): item is GeneratedCdk => Boolean(item))
    : []

  if (cdks.length > 0) return cdks

  const permission = typeof data.permission === 'string' ? normalizeProductPermission(data.permission) : null
  if (typeof data.code === 'string' && data.code.trim() && permission && typeof data.created_at === 'string') {
    return [{ code: data.code, permission, created_at: data.created_at }]
  }
  return []
}

function normalizeProductPermission(permission: string): GeneratedPermission | null {
  if (permission === 'basic') return 'growth'
  if (permission === 'premium') return 'advanced'
  return cdkProductPermissions.includes(permission as GeneratedPermission) ? permission as GeneratedPermission : null
}

function isAppUserStatus(status: string): status is AppUserStatus {
  return status === 'active' || status === 'frozen' || status === 'revoked'
}

function formatNullableNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-'
}

function buildCurrentOpsReport(
  usage: UsageStatsResponse,
  cdk: CdkOpsSummary,
  announcements: Announcement[],
  announcementStats: Record<string, AnnouncementReachStats>,
) {
  return {
    generated_at: new Date().toISOString(),
    range: usage.range,
    totals: usage.totals,
    days: usage.days,
    funnel: usage.funnel,
    failure_reasons: usage.failure_reasons,
    latency: usage.latency,
    skland: usage.skland,
    announcement: usage.announcement,
    announcement_items: announcements.map((announcement) => ({
      id: announcement.id,
      kind: announcement.kind,
      title: announcement.title,
      active: announcement.active,
      updated_at: announcement.updated_at,
      stats: announcementStats[announcement.id] ?? EMPTY_ANNOUNCEMENT_REACH_STATS,
    })),
    cdk_permission_distribution: cdk.permission_distribution,
    cdk_status_distribution: cdk.status_distribution,
    risk_trend: cdk.risk_trend,
    risk_reasons: cdk.risk_reasons.map((item) => ({
      type: item.type,
      reason: item.reason,
      count: item.count,
      last_seen_at: item.last_seen_at,
      latest_cdk_id: item.latest_record?.cdk_id ?? null,
    })),
  }
}

function buildCurrentOpsReportCsv(report: ReturnType<typeof buildCurrentOpsReport>): string {
  const rows: string[][] = [
    ['section', 'key', 'label', 'date', 'value', 'extra'],
    ['range', 'from', 'From', '', report.range.from, ''],
    ['range', 'to', 'To', '', report.range.to, ''],
    ['range', 'days', 'Days', '', String(report.range.days), ''],
  ]
  for (const [key, value] of Object.entries(report.totals)) {
    rows.push(['totals', key, key, '', String(value), ''])
  }
  for (const day of report.days) {
    for (const [key, value] of Object.entries(day)) {
      if (key === 'date') continue
      rows.push(['days', key, key, day.date, String(value), ''])
    }
  }
  for (const item of report.funnel) {
    rows.push(['funnel', item.key, item.label, '', String(item.count), `conversion=${item.conversion_rate};dropoff=${item.dropoff}`])
  }
  for (const item of report.failure_reasons) {
    rows.push(['failure_reasons', item.reason_code, item.reason_code, item.last_seen_at ?? '', String(item.count), `percentage=${item.percentage}`])
  }
  for (const item of report.cdk_permission_distribution) {
    rows.push(['cdk_permission_distribution', String(item.permission), permissionLabels[item.permission] ?? String(item.permission), '', String(item.total), `unused=${item.unused};used=${item.used};frozen=${item.frozen};revoked=${item.revoked}`])
  }
  for (const item of report.cdk_status_distribution) {
    rows.push(['cdk_status_distribution', item.status, statusLabels[item.status], '', String(item.total), ''])
  }
  for (const day of report.risk_trend) {
    rows.push(['risk_trend', 'risk_events', 'Risk events', day.date, String(day.total), `soft=${day.soft_blocks};freeze=${day.freezes};escalation=${day.escalations}`])
  }
  for (const item of report.risk_reasons) {
    rows.push(['risk_reasons', item.type, item.reason, item.last_seen_at ?? '', String(item.count), `latest_cdk=${item.latest_cdk_id ?? ''}`])
  }
  const latency = report.latency.schedule_generate
  rows.push(['latency', 'average_ms', 'Average', '', String(latency.average_ms), ''])
  rows.push(['latency', 'p50_ms', 'P50', '', String(latency.p50_ms), ''])
  rows.push(['latency', 'p95_ms', 'P95', '', String(latency.p95_ms), ''])
  rows.push(['latency', 'max_ms', 'Max', '', String(latency.max_ms), ''])
  rows.push(['skland', 'success_rate', 'Success rate', '', String(report.skland.success_rate), `attempts=${report.skland.attempts};failed=${report.skland.failed}`])
  rows.push(['announcement', 'read_rate', 'Read rate', '', String(report.announcement.read_rate), `impressions=${report.announcement.impressions};reads=${report.announcement.reads}`])
  for (const item of report.announcement_items) {
    const extra = `id=${item.id};kind=${item.kind};active=${item.active};server_reads=${item.stats.server_reads};local_reads=${item.stats.local_reads}`
    rows.push(['announcement_item', 'impressions', item.title, item.updated_at, String(item.stats.impressions), extra])
    rows.push(['announcement_item', 'reads', item.title, item.updated_at, String(item.stats.reads), extra])
    rows.push(['announcement_item', 'read_rate', item.title, item.updated_at, String(item.stats.read_rate), extra])
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function buildGeneratedCdkCsv(cdks: GeneratedCdk[]): string {
  const rows = [
    ['code', 'permission', 'permission_label', 'created_at'],
    ...cdks.map((item) => [item.code, item.permission, permissionLabels[item.permission], item.created_at]),
  ]
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function downloadOperatorsJson(data: AdminProfileOperatorData): void {
  const blob = new Blob([JSON.stringify(data.operators, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `skland-operators-${formatFileSegment(data.profile.id)}-${formatDownloadTimestamp()}.json`)
}

function formatFileSegment(value: string): string {
  return value.slice(0, 8).replace(/[^A-Za-z0-9_-]/g, '') || 'profile'
}

function formatDownloadTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function formatOperatorValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value
  return '-'
}

function omitProfileOperatorData(
  current: Record<string, AdminProfileOperatorData>,
  profileId: string,
): Record<string, AdminProfileOperatorData> {
  if (!(profileId in current)) return current
  const next = { ...current }
  delete next[profileId]
  return next
}

function formatRiskDetail(detail: Record<string, unknown>): string {
  const visible = Object.entries(detail)
    .filter(([key]) => !/(hash|token|secret|credential|encrypted|salt|password)/i.test(key))
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${formatRiskValue(value)}`)
  return visible.length > 0 ? visible.join(' / ') : '已隐藏敏感详情'
}

function formatRiskValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length} 项`
  return '对象摘要'
}

function readStoredCredentials(): { user: string; password: string } | null {
  try {
    const raw = window.sessionStorage.getItem('maa-admin-credentials')
    return raw ? JSON.parse(raw) as { user: string; password: string } : null
  } catch {
    return null
  }
}

function storeCredentials(credentials: { user: string; password: string }): void {
  window.sessionStorage.setItem('maa-admin-credentials', JSON.stringify(credentials))
}

function clearStoredCredentials(): void {
  window.sessionStorage.removeItem('maa-admin-credentials')
}

