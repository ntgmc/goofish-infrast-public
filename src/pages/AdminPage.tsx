import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Announcement, AnnouncementAdminResponse, AnnouncementKind, LicenseOperator, ProductPermissionMode, RawPermissionMode, UserGameAccountKind } from '../lib/types'
import { apiJson, apiVoid } from '../lib/api-client'

type Permission = RawPermissionMode
type GeneratedPermission = ProductPermissionMode
type CdkStatus = 'unused' | 'used' | 'frozen' | 'revoked'
type AppUserStatus = 'active' | 'frozen' | 'revoked'
type StatusFilter = CdkStatus | 'all'
type AdminSection = 'overview' | 'cdk' | 'risk' | 'announcement' | 'users'
type FieldErrors = Record<string, string>

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
  latest_risk_event?: { at: string; type: string; reason: string } | null;
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
  schedule_generates: number;
  cdk_redeems: number;
}

interface UsageDay extends UsageTotals {
  date: string;
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
  created_at: string;
  updated_at: string;
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
  kind?: string;
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

const cdkProductPermissions: GeneratedPermission[] = ['recommended', 'growth', 'advanced', 'ultimate']
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
  const [records, setRecords] = useState<AdminCdkRecord[]>([])
  const [users, setUsers] = useState<AdminUserSummary[]>([])
  const [appUsers, setAppUsers] = useState<AppUserSummary[]>([])
  const [usageStats, setUsageStats] = useState<{ totals: UsageTotals; days: UsageDay[] } | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>(EMPTY_ANNOUNCEMENTS)
  const [riskSettings, setRiskSettings] = useState<RiskControlSettings>(DEFAULT_RISK_SETTINGS)
  const [permission, setPermission] = useState<GeneratedPermission>('growth')
  const [orderNote, setOrderNote] = useState('')
  const [generatedCode, setGeneratedCode] = useState<{ code: string; permission: GeneratedPermission; created_at: string } | null>(null)
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

const summary = useMemo(
() => buildSummary(records, usageStats?.totals, users.length),
[records, usageStats, users.length],
)
  const visibleRecords = useMemo(
    () => records.filter((record) => statusFilter === 'all' || record.status === statusFilter),
    [records, statusFilter],
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
    setLoading(true)
    setError(null)
    try {
      const headers = {
        'X-Admin-User': nextCredentials.user,
        'X-Admin-Password': nextCredentials.password,
      }
      const [cdkData, usageData, announcementData, usersData, riskSettingsData] = await Promise.all([
        apiJson<{ cdks?: AdminCdkRecord[] }>('/api/admin/cdk?status=all', { headers, fallbackMessage: '加载 CDK 失败' }),
        apiJson<{ totals?: UsageTotals; days?: UsageDay[] }>('/api/admin/usage-stats', { headers, fallbackMessage: '加载统计失败' }),
        apiJson<Partial<AnnouncementAdminResponse>>('/api/admin/announcement', { headers, fallbackMessage: '加载公告失败' }),
        apiJson<{ users?: AdminUserSummary[]; app_users?: AppUserSummary[] }>('/api/admin/users', { headers, fallbackMessage: '加载账号失败' }),
        apiJson<{ settings?: Partial<RiskControlSettings> }>('/api/admin/risk-settings', { headers, fallbackMessage: '加载风控设置失败' }),
      ])
      setRecords(cdkData.cdks ?? [])
      setUsageStats({
        totals: normalizeUsageTotals(usageData.totals),
        days: Array.isArray(usageData.days) ? usageData.days.map(normalizeUsageDay) : [],
      })
      setAnnouncements(normalizeAnnouncementList(announcementData.announcements))
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
  }, [credentials])

  useEffect(() => {
    if (credentials) void loadDashboard(credentials)
  }, [])

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
    setRiskSettings(DEFAULT_RISK_SETTINGS)
    setSelectedCdkHashes([])
    setSelectedCdkDetail(null)
    setSelectedUserDetail(null)
    setOperatorDataByProfileId({})
    setExpandedOperatorProfileId(null)
  }

  const handleGenerateCdk = async (event: FormEvent) => {
    event.preventDefault()
    setBusyAction('generate')
    setError(null)
    setNotice(null)
    try {
      const data = await apiJson<{ code?: string; permission?: GeneratedPermission; created_at?: string }>('/api/admin/cdk', {
        method: 'POST',
        headers: authHeaders,
        json: { admin_user: credentials?.user, admin_password: credentials?.password, permission, order_note: orderNote },
        fallbackMessage: '生成失败',
      })
      if (!data.code || !data.permission || !data.created_at) {
        throw new Error('生成失败')
      }
      setGeneratedCode({ code: data.code, permission: data.permission, created_at: data.created_at })
      setOrderNote('')
      await loadDashboard()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusyAction(null)
    }
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
      setAnnouncements(normalizeAnnouncementList(data.announcements))
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
    action: 'update_profile' | 'set_profile_status' | 'set_profile_permission' | 'clear_profile_skland_binding' | 'clear_profile_workspace',
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
              <p className="text-sm font-semibold text-brand-500">MAA Infrast Admin</p>
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
          <p className="text-sm font-semibold text-brand-500">MAA Admin</p>
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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="CDK 总量" value={summary.totalCdks} />
                <Metric label="已兑换" value={summary.usedCdks} />
                <Metric label="冻结授权" value={summary.frozenCdks} tone={summary.frozenCdks > 0 ? 'warning' : 'default'} />
                <Metric label="7 日生成" value={summary.scheduleGenerates} />
              </div>
              <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-ink-primary">7 日趋势</h2>
                    <span className="text-xs text-ink-muted">访问 / 生成 / 兑换</span>
                  </div>
                  <UsageTrendChart days={usageStats?.days ?? []} />
                </section>
                <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                  <h2 className="text-base font-semibold text-ink-primary">运营摘要</h2>
                  <dl className="mt-4 space-y-3 text-sm">
                    <InfoRow label="独立访客" value={String(summary.uniqueVisitors)} />
                    <InfoRow label="访问次数" value={String(summary.visits)} />
                    <InfoRow label="兑换次数" value={String(summary.cdkRedeems)} />
                    <InfoRow label="管理账号" value={String(summary.adminUsers)} />
                    <InfoRow label="转化率" value={`${summary.redeemRate}%`} />
                  </dl>
                </section>
              </div>
            </section>
          )}

          {activeSection === 'cdk' && (
            <section className="space-y-5">
              <form onSubmit={handleGenerateCdk} className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                <div className="grid gap-4 lg:grid-cols-[220px_1fr_auto] lg:items-end">
                  <label>
                    <span className="mb-2 block text-sm font-medium text-ink-secondary">授权类型</span>
                    <select value={permission} onChange={(event) => setPermission(event.currentTarget.value as GeneratedPermission)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary">
                      {cdkProductPermissions.map((item) => <option key={item} value={item}>{permissionLabels[item]}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="mb-2 block text-sm font-medium text-ink-secondary">订单备注</span>
                    <input value={orderNote} maxLength={120} onChange={(event) => setOrderNote(event.currentTarget.value)} className="w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="闲鱼订单号、用户昵称或售后备注" />
                  </label>
                  <button type="submit" disabled={busyAction === 'generate'} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">{busyAction === 'generate' ? '生成中...' : '生成 CDK'}</button>
                </div>
                {generatedCode && (
                  <div className="mt-4 flex flex-col gap-3 rounded-lg bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-mono text-base font-semibold text-ink-primary">{generatedCode.code}</div>
                      <div className="mt-1 text-xs text-ink-muted">{permissionLabels[generatedCode.permission]} · {formatDate(generatedCode.created_at)}</div>
                    </div>
                    <button type="button" onClick={() => navigator.clipboard.writeText(generatedCode.code)} className="rounded-lg bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">复制 CDK</button>
                  </div>
                )}
              </form>
              <CdkTable
                records={visibleRecords}
                selected={selectedCdkHashes}
                filter={statusFilter}
                busyAction={busyAction}
                onFilter={setStatusFilter}
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
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="冻结授权" value={summary.frozenCdks} tone="warning" />
                <Metric label="风险记录" value={summary.riskEvents} />
                <Metric label="设备绑定" value={summary.boundDevices} />
              </div>
              <RiskTable records={riskRecords} busyAction={busyAction} onPatch={patchCdk} />
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
                <div className="flex flex-wrap gap-2">
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
                {announcements.map((item) => (
                  <article key={item.id} className="rounded-lg border border-surface-3 bg-surface-0 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={item.kind}
                          onChange={(event) => updateAnnouncement(item.id, { kind: event.currentTarget.value as AnnouncementKind })}
                          className="rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary"
                        >
                          <option value="banner">横幅</option>
                          <option value="popup">弹出式公告</option>
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
                ))}
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
                          <td className="px-4 py-4 text-ink-secondary">{item.permission ? permissionLabels[item.permission] : '-'}</td>
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
                <UserDetailPanel
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

function UserDetailPanel({
  detail,
  busyAction,
  operatorDataByProfileId,
  expandedOperatorProfileId,
  onClose,
  onUpdateProfile,
  onSetProfileStatus,
  onSetProfilePermission,
  onClearSklandBinding,
  onClearWorkspace,
  onViewOperators,
  onDownloadOperators,
  onFreezeUser,
  onUnfreezeUser,
  onDeleteUser,
}: {
  detail: AdminUserDetail;
  busyAction: string | null;
  operatorDataByProfileId: Record<string, AdminProfileOperatorData>;
  expandedOperatorProfileId: string | null;
  onClose: () => void;
  onUpdateProfile: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfileStatus: (profile: AdminProfileSummary) => Promise<void>;
  onSetProfilePermission: (profile: AdminProfileSummary) => Promise<void>;
  onClearSklandBinding: (profile: AdminProfileSummary) => Promise<void>;
  onClearWorkspace: (profile: AdminProfileSummary) => Promise<void>;
  onViewOperators: (profile: AdminProfileSummary) => Promise<void>;
  onDownloadOperators: (profile: AdminProfileSummary) => Promise<void>;
  onFreezeUser: (user: AppUserSummary) => Promise<void>;
  onUnfreezeUser: (user: AppUserSummary) => Promise<void>;
  onDeleteUser: (user: AppUserSummary) => Promise<void>;
}) {
  const user = detail.user
  return (
    <section className="rounded-xl border border-surface-3 bg-surface-1">
      <div className="flex flex-col gap-3 border-b border-surface-3 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-all text-lg font-semibold text-ink-primary">{user.email}</h2>
            <UserStatusPill status={user.status} />
            {user.permission && <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold text-ink-secondary">{permissionLabels[user.permission]}</span>}
          </div>
          <p className="mt-2 break-all text-sm text-ink-muted">用户 ID：{user.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {user.status === 'active' && <SmallButton onClick={() => void onFreezeUser(user)} loading={busyAction === `app-user:freeze_account:${user.id}`}>冻结用户</SmallButton>}
          {user.status === 'frozen' && <SmallButton onClick={() => void onUnfreezeUser(user)} loading={busyAction === `app-user:unfreeze_account:${user.id}`} tone="success">解冻用户</SmallButton>}
          <SmallButton onClick={() => void onDeleteUser(user)} loading={busyAction === `app-user:delete_account:${user.id}`} tone="danger">删除用户</SmallButton>
          <SmallButton onClick={onClose}>关闭</SmallButton>
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
            <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold text-ink-secondary">{permissionLabels[profile.permission]}</span>
          </div>
          <p className="mt-2 break-all text-xs text-ink-muted">档案 ID：{profile.id}</p>
          {profile.note && <p className="mt-2 text-sm text-ink-secondary">{profile.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={() => void onUpdateProfile(profile)} loading={busyAction === `profile:update_profile:${profile.id}`}>改名称</SmallButton>
          <SmallButton onClick={() => void onSetProfileStatus(profile)} loading={busyAction === `profile:set_profile_status:${profile.id}`}>改状态</SmallButton>
          <SmallButton onClick={() => void onSetProfilePermission(profile)} loading={busyAction === `profile:set_profile_permission:${profile.id}`}>改权限</SmallButton>
          <SmallButton onClick={() => void onViewOperators(profile)} loading={busyAction === `profile-operators:${profile.id}`}>{operatorsExpanded ? '收起干员' : '查看干员'}</SmallButton>
          <SmallButton onClick={() => void onDownloadOperators(profile)} loading={busyAction === `profile-operators-download:${profile.id}`}>下载 JSON</SmallButton>
          <SmallButton onClick={() => void onClearSklandBinding(profile)} loading={busyAction === `profile:clear_profile_skland_binding:${profile.id}`} tone="danger">清绑定</SmallButton>
          <SmallButton onClick={() => void onClearWorkspace(profile)} loading={busyAction === `profile:clear_profile_workspace:${profile.id}`} tone="danger">清工作区</SmallButton>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <DetailItem label="档案类型" value={profile.kind || '-'} />
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

function CdkTable({ records, selected, filter, busyAction, onFilter, onSelect, onBulkRevoke, onPatch, onOpenDetail, onDelete }: {
  records: AdminCdkRecord[];
  selected: string[];
  filter: StatusFilter;
  busyAction: string | null;
  onFilter: (filter: StatusFilter) => void;
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
            <button key={item} type="button" onClick={() => onFilter(item)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === item ? 'bg-brand-600 text-white' : 'bg-surface-2 text-ink-secondary hover:bg-surface-3'}`}>
              {item === 'all' ? '全部' : statusLabels[item]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onBulkRevoke} disabled={selected.length === 0} className="rounded-lg bg-error/10 px-3 py-2 text-sm font-semibold text-error hover:bg-error/20 disabled:bg-surface-2 disabled:text-ink-muted">批量撤销</button>
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

function RiskTable({ records, busyAction, onPatch }: { records: AdminCdkRecord[]; busyAction: string | null; onPatch: (record: AdminCdkRecord, action: string) => Promise<void> }) {
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
            {record.status === 'frozen' && <SmallButton onClick={() => onPatch(record, 'unfreeze')} loading={busyAction === `unfreeze:${record.code_hash}`} tone="success">解冻</SmallButton>}
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

function SmallButton({ children, onClick, loading, tone = 'default' }: { children: string; onClick: () => void; loading?: boolean; tone?: 'default' | 'success' | 'danger' }) {
  const className = tone === 'danger'
    ? 'bg-error/10 text-error hover:bg-error/20'
    : tone === 'success'
      ? 'bg-success/10 text-success hover:bg-success/20'
      : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary'
  return <button type="button" onClick={onClick} disabled={loading} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 disabled:bg-surface-3 disabled:text-ink-muted ${className}`}>{loading ? '处理中' : children}</button>
}

function buildSummary(records: AdminCdkRecord[], usage?: UsageTotals, adminUsers = 0) {
const totalCdks = records.length
const usedCdks = records.filter((record) => record.status === 'used').length
const frozenCdks = records.filter((record) => record.status === 'frozen').length
const riskEvents = records.reduce((sum, record) => sum + (record.risk_event_count ?? 0), 0)
const boundDevices = records.filter((record) => record.activation_bound).length
  return {
    totalCdks,
    usedCdks,
    frozenCdks,
    riskEvents,
    boundDevices,
    adminUsers,
    uniqueVisitors: usage?.unique_visitors ?? 0,
    visits: usage?.visits ?? 0,
    scheduleGenerates: usage?.schedule_generates ?? 0,
    cdkRedeems: usage?.cdk_redeems ?? 0,
    redeemRate: usage?.visits ? Math.round(((usage?.cdk_redeems ?? 0) / usage.visits) * 1000) / 10 : 0,
  }
}

function normalizeUsageTotals(value: Partial<UsageTotals> | undefined): UsageTotals {
  return {
    unique_visitors: normalizeCount(value?.unique_visitors),
    visits: normalizeCount(value?.visits),
    schedule_generates: normalizeCount(value?.schedule_generates),
    cdk_redeems: normalizeCount(value?.cdk_redeems),
  }
}

function normalizeUsageDay(day: Partial<UsageDay>): UsageDay {
  return { date: typeof day.date === 'string' ? day.date : '', ...normalizeUsageTotals(day) }
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

function downloadOperatorsJson(data: AdminProfileOperatorData): void {
  const blob = new Blob([JSON.stringify(data.operators, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `skland-operators-${formatFileSegment(data.profile.id)}-${formatDownloadTimestamp()}.json`
  anchor.click()
  URL.revokeObjectURL(url)
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

