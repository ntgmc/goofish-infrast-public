import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Announcement, AnnouncementAdminResponse, AnnouncementKind, AnnouncementStats as AnnouncementReachStats } from '../../lib/types'
import { ADMIN_SESSION_EXPIRED_EVENT, adminApiJson as apiJson, adminApiVoid as apiVoid, clearLegacyAdminCredentials } from '../../lib/admin-api-client'
import { GeneratedPermission, StatusFilter, PermissionFilter, BinaryFilter, FieldErrors, CdkTableFilters, GeneratedCdk, AdminCdkCreateResponse, AdminCdkRecord, AdminCdkDetail, UsageRangeMode, AnnouncementSortKey, UsageStatsResponse, RiskControlSettings, RiskControlSettingsPatch, AdminUserSummary, AppUserSummary, AdminProfileSummary, AdminUserDetail, AdminProfileOperatorData, EMPTY_ANNOUNCEMENTS, DEFAULT_RISK_SETTINGS, permissionLabels, cdkProductPermissions, MAX_CDK_BATCH_COUNT, buildSummary, recordMatchesCdkFilters, buildCdkOpsSummary, buildUsageStatsQuery, getDateOffsetString, normalizeUsageStats, normalizeRiskSettings, normalizeAnnouncementList, normalizeAnnouncementStatsMap, sortAnnouncements, createDraftAnnouncement, validateEmailInput, validatePasswordInput, normalizeGeneratedCdks, normalizeProductPermission, isAppUserStatus, buildCurrentOpsReport, buildCurrentOpsReportCsv, buildGeneratedCdkCsv, downloadBlob, downloadOperatorsJson, formatDownloadTimestamp, omitProfileOperatorData } from './modules'

export function useAdminController() {
  const [adminUsername, setAdminUsername] = useState<string | null>(null)

  const [loginUser, setLoginUser] = useState('')

  const [loginPassword, setLoginPassword] = useState('')

  const [authenticated, setAuthenticated] = useState(false)

  const [sessionChecking, setSessionChecking] = useState(true)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>('all')

  const [boundFilter, setBoundFilter] = useState<BinaryFilter>('all')

  const [riskFilter, setRiskFilter] = useState<BinaryFilter>('all')

  const [generatedFilter, setGeneratedFilter] = useState<BinaryFilter>('all')

  const [records, setRecords] = useState<AdminCdkRecord[]>([])

  const [users, setUsers] = useState<AdminUserSummary[]>([])

  const [appUsers, setAppUsers] = useState<AppUserSummary[]>([])

  const deadLetters: never[] = []

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

  const resetAdminState = useCallback(() => {
      setAdminUsername(null)
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
    }, [])

  const loadDashboard = useCallback(async () => {
      if (!usageStatsQuery) {
        setError('自定义时间范围无效，请选择开始和结束日期')
        return
      }
      setLoading(true)
      setError(null)
      try {
        const [cdkData, usageData, announcementData, usersData, riskSettingsData] = await Promise.all([
          apiJson<{ cdks?: AdminCdkRecord[] }>('/api/admin/cdk?status=all', { fallbackMessage: '加载 CDK 失败' }),
          apiJson<Partial<UsageStatsResponse>>(`/api/admin/usage-stats?${usageStatsQuery}`, { fallbackMessage: '加载统计失败' }),
          apiJson<Partial<AnnouncementAdminResponse>>('/api/admin/announcement', { fallbackMessage: '加载公告失败' }),
          apiJson<{ users?: AdminUserSummary[]; app_users?: AppUserSummary[] }>('/api/admin/users', { fallbackMessage: '加载账号失败' }),
          apiJson<{ settings?: Partial<RiskControlSettings> }>('/api/admin/risk-settings', { fallbackMessage: '加载风控设置失败' }),
        ])
        const nextAnnouncements = normalizeAnnouncementList(announcementData.announcements)
        setRecords(cdkData.cdks ?? [])
        setUsageStats(normalizeUsageStats(usageData))
        setAnnouncements(nextAnnouncements)
        setAnnouncementStats(normalizeAnnouncementStatsMap(announcementData.stats, nextAnnouncements))
        setRiskSettings(normalizeRiskSettings(riskSettingsData.settings))
        setUsers(usersData.users ?? [])
        setAppUsers(usersData.app_users ?? [])
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setLoading(false)
      }
    }, [usageStatsQuery])

  useEffect(() => {
      clearLegacyAdminCredentials()
      let active = true
      apiJson<{ user?: { username?: string } }>('/api/admin/session', { fallbackMessage: '管理员会话检查失败' })
        .then((data) => {
          if (!active || !data.user?.username) return
          setAdminUsername(data.user.username)
          setLoginUser(data.user.username)
          setAuthenticated(true)
        })
        .catch(() => undefined)
        .finally(() => {
          if (active) setSessionChecking(false)
        })
      return () => {
        active = false
      }
    }, [])

  useEffect(() => {
      if (authenticated) void loadDashboard()
    }, [authenticated, loadDashboard])

  useEffect(() => {
      const handleSessionExpired = () => resetAdminState()
      window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleSessionExpired)
      return () => window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleSessionExpired)
    }, [resetAdminState])

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
      setLoading(true)
      setError(null)
      try {
        const data = await apiJson<{ user?: { username?: string } }>('/api/admin/session', {
          method: 'POST',
          json: { username: loginUser.trim(), password: loginPassword },
          fallbackMessage: '管理账号或密码错误',
        })
        if (!data.user?.username) throw new Error('管理员登录响应无效')
        setAdminUsername(data.user.username)
        setLoginUser(data.user.username)
        setLoginPassword('')
        setAuthenticated(true)
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setLoading(false)
      }
    }

  const handleLogout = () => {
      resetAdminState()
      setSessionChecking(true)
      void apiVoid('/api/admin/session', { method: 'DELETE' })
        .catch(() => undefined)
        .finally(() => setSessionChecking(false))
    }

  const handleExportUsageReport = async (format: 'csv' | 'json') => {
      if (!authenticated) return
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
          json: { permission, order_note: orderNote, count: batchCount },
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
          json: {
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
          json: {
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
          json: {
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
          json: { code_hash: record.code_hash },
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
          json: {
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
          json: {
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
          json: {
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
      const confirmedEmail = window.prompt(`立即永久擦除 ${user.email} 的全部个人数据（含档案、工作区、任务、样本与使用记录）。请输入该邮箱确认。`)
      if (confirmedEmail === null) return
      if (confirmedEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
        setNotice(null)
        setError('确认邮箱不匹配，已取消删除。')
        return
      }
      await patchAppUser(user, 'delete_account', '已删除账号', { confirm_email: confirmedEmail.trim() })
    }

  const handleOptimizationDeadLetter = async (id: string, action: 'replay' | 'discard') => {
      const reason = action === 'replay'
        ? window.prompt('管理员重放会绕过用户额度扣减。请输入本次重放原因。')
        : window.prompt('请输入丢弃原因。')
      if (!reason?.trim()) return
      setBusyAction(`dead-letter:${id}`)
      setError(null)
      setNotice(null)
      try {
        await apiJson('/api/admin/optimization', {
          method: 'POST',
          json: { action, id, reason: reason.trim() },
          fallbackMessage: action === 'replay' ? '重放死信任务失败' : '丢弃死信任务失败',
        })
        setNotice(action === 'replay' ? '已提交死信任务重放' : '已丢弃死信任务')
        await loadDashboard()
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setBusyAction(null)
      }
    }

  return { permission, announcementSort, adminUsername, loginUser, setLoginUser, loginPassword, setLoginPassword, authenticated, sessionChecking, setStatusFilter, setPermission, setPermissionFilter, setBoundFilter, setRiskFilter, setGeneratedFilter, records, appUsers, deadLetters, usageRange, setUsageRange, usageRangeFrom, setUsageRangeFrom, usageRangeTo, setUsageRangeTo, usageStats, announcements, announcementStats, setAnnouncementSort, riskSettings, orderNote, setOrderNote, cdkCount, setCdkCount, generatedCodes, selectedCdkHashes, setSelectedCdkHashes, selectedCdkDetail, setSelectedCdkDetail, selectedUserDetail, setSelectedUserDetail, operatorDataByProfileId, setOperatorDataByProfileId, expandedOperatorProfileId, setExpandedOperatorProfileId, resetUserEmail, setResetUserEmail, resetPassword, setResetPassword, loginFieldErrors, setLoginFieldErrors, resetFieldErrors, setResetFieldErrors, loading, busyAction, error, notice, summary, cdkOpsSummary, cdkFilters, visibleRecords, sortedAnnouncements, riskRecords, loadDashboard, handleLogin, handleLogout, handleExportUsageReport, handleGenerateCdk, handleCopyGeneratedCdks, handleDownloadGeneratedCdks, handleSaveAnnouncement, handleSaveRiskSettings, addAnnouncement, updateAnnouncement, deleteAnnouncement, patchCdk, deleteCdk, loadCdkDetail, handleUpdateCdkNote, handleSetCdkPermission, handleBulkRevoke, loadUserDetail, handleViewProfileOperators, handleDownloadProfileOperators, handleUpdateProfile, handleSetProfileStatus, handleSetProfilePermission, handleUpgradePreviewProfile, handleClearProfileSklandBinding, handleClearProfileWorkspace, handleResetUserPassword, handleFreezeAppUser, handleUnfreezeAppUser, handleDeleteAppUser, handleOptimizationDeadLetter }
}
