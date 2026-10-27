import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AnnouncementAdminResponse } from '../../lib/types'
import { ADMIN_SESSION_EXPIRED_EVENT, adminApiJson as apiJson, adminApiVoid as apiVoid } from '../../lib/admin-api-client'
import { ApiError } from '../../lib/api-client'
import { GeneratedPermission, CdkType, FieldErrors, GeneratedCdk, AdminCdkCreateResponse, AdminCdkRecord, AdminCdkDetail, RiskControlSettingsPatch, AdminSessionUser, AdminCapability, AppUserSummary, AdminProfileSummary, AdminUserDetail, AdminProfileOperatorData, cdkProductPermissions, MAX_CDK_BATCH_COUNT, buildCdkOpsSummary, validateEmailInput, validatePasswordInput, normalizeGeneratedCdks, normalizeProductPermission, buildGeneratedCdkCsv, downloadBlob, downloadOperatorsJson, formatDownloadTimestamp } from './modules'
import type { AdminSection } from './contracts'
import { useAdminCdkData } from './cdk/useAdminCdkData'
import { useAdminOverview } from './overview/useAdminOverview'
import { useAnnouncementDraft } from './announcements/useAnnouncementDraft'
import { useAdminUserBalance } from './users/balance-actions'
import { downloadAdminUserWorkspaces } from './users/workspace-export-actions'
import { mutateSelectedCdks, type BulkCdkAction } from './cdk/bulk-actions'
import { saveRiskControlSettings } from './risk/settings-actions'
import { cancelAdminOperation, requestAdminOperationEdit, requestAdminOperationReason } from '../../lib/admin-operation-reason'
import { createAdminProfileActions } from './users/profile-actions'
import { useAdminUserList } from './users/useAdminUserList'
import { useAdminDetailQuery } from './shared/useAdminDetailQuery'
import { useAdminOperatorQueries } from './users/useAdminOperatorQueries'
import { operationsOverviewCsv } from '../../lib/operations-overview'

function errorMessage(value: unknown): string {
  return value instanceof Error && value.message ? value.message : '未知错误'
}

export type AdminController = ReturnType<typeof useAdminController>

export function useAdminController(section: AdminSection = 'overview', search = '') {
  const queryClient = useQueryClient()
  const [adminUsername, setAdminUsername] = useState<string | null>(null)
  const [adminCapabilities, setAdminCapabilities] = useState<AdminCapability[]>([])
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<string | null>(null)

  const [loginUser, setLoginUser] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [authenticated, setAuthenticated] = useState(false)

  const [sessionChecking, setSessionChecking] = useState(true)

  const {
    banner,
    announcements,
    stats: announcementStats,
    status: announcementDraftStatus,
    savedAt: announcementDraftSavedAt,
    restored: announcementDraftRestored,
    conflict: announcementDraftConflict,
    error: announcementDraftError,
    dirty: announcementDraftDirty,
    persist: persistAnnouncementDraft,
    reconcileServerData: reconcileLoadedAnnouncementData,
    acceptServerData: acceptServerAnnouncementData,
    discardAndAcceptServerData,
    prepareForAuthenticationReset,
    currentSnapshot: currentAnnouncementSnapshot,
    updateBanner,
    addAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    reorderAnnouncements,
  } = useAnnouncementDraft()

  const [permission, setPermission] = useState<GeneratedPermission>('advanced')
  const [cdkType, setCdkType] = useState<CdkType>('profile')
  const [balanceAmount, setBalanceAmount] = useState('100.00')

  const [orderNote, setOrderNote] = useState('')

  const [cdkCount, setCdkCount] = useState('1')

  const [generatedCodes, setGeneratedCodes] = useState<GeneratedCdk[]>([])

  const [selectedCdkHashes, setSelectedCdkHashes] = useState<string[]>([])

  const cdkDetailQuery = useAdminDetailQuery({ username: adminUsername, capabilities: adminCapabilities,
    active: authenticated && (section === 'cdk' || section === 'risk'), name: 'cdk',
    identify: (detail: AdminCdkDetail) => detail.code_hash,
    read: async (hash: string, signal: AbortSignal) => {
      const data = await apiJson<{ cdk?: AdminCdkDetail }>(`/api/admin/cdk?code_hash=${encodeURIComponent(hash)}${adminCapabilities.includes('admin_manage') ? '' : '&view=risk'}`, { signal, fallbackMessage: '加载 CDK 详情失败' })
      if (!data.cdk) throw new Error('加载 CDK 详情失败')
      return data.cdk
    },
  })
  const { data: selectedCdkDetail, setData: setSelectedCdkDetail } = cdkDetailQuery
  const userDetailQuery = useAdminDetailQuery({ username: adminUsername, capabilities: adminCapabilities,
    active: authenticated && section === 'users', name: 'user',
    identify: (detail: AdminUserDetail) => ({ id: detail.user.id, page: detail.profile_pagination?.page ?? 1, size: detail.profile_pagination?.page_size ?? 100, profileId: undefined as string | undefined }),
    read: async (target: { id: string; page: number; size: number; profileId: string | undefined }, signal: AbortSignal) => {
      const data = await apiJson<{ detail?: AdminUserDetail }>(`/api/admin/users?user_id=${encodeURIComponent(target.id)}&profile_page=${target.page}&profile_page_size=${target.size}${target.profileId ? `&profile_id=${encodeURIComponent(target.profileId)}` : ''}`, { signal, fallbackMessage: '加载用户详情失败' })
      if (!data.detail) throw new Error('加载用户详情失败')
      return data.detail
    },
  })
  const { data: selectedUserDetail, setData: setSelectedUserDetail } = userDetailQuery

  const operatorQueries = useAdminOperatorQueries(adminUsername, adminCapabilities, selectedUserDetail?.user.id ?? null, authenticated && section === 'users')
  const { data: operatorDataByProfileId, setData: setOperatorDataByProfileId } = operatorQueries

  const [expandedOperatorProfileId, setExpandedOperatorProfileId] = useState<string | null>(null)

  const [resetUserEmail, setResetUserEmail] = useState('')

  const [resetPassword, setResetPassword] = useState('')

  const [loginFieldErrors, setLoginFieldErrors] = useState<FieldErrors>({})

  const [resetFieldErrors, setResetFieldErrors] = useState<FieldErrors>({})

  const [loginLoading, setLoginLoading] = useState(false)

  const [mutationBusyAction, setBusyAction] = useState<string | null>(null)
  const busyAction = mutationBusyAction ?? (cdkDetailQuery.loading ? `cdk-detail:${cdkDetailQuery.selection}` : userDetailQuery.loading ? `${userDetailQuery.selection?.page === 1 ? 'user-detail' : 'user-profile-page'}:${userDetailQuery.selection?.id}` : operatorQueries.loadingId ? `profile-operators:${operatorQueries.loadingId}` : null)

  const [error, setError] = useState<string | null>(null)

  const [notice, setNotice] = useState<string | null>(null)
  const clearNotice = useCallback(() => setNotice(null), [])

  const userList = useAdminUserList({
    adminUsername, capabilities: adminCapabilities,
    enabled: authenticated && section === 'users' && adminCapabilities.includes('user_view'),
    setBusyAction, setError, setNotice,
    closeDetail: () => setSelectedUserDetail(null),
  }, section === 'users' ? search : '')
  const { loadUsersPage, setSelectedUserIds, usersUpdatedAt } = userList

  const cdkData = useAdminCdkData({ adminUsername, authenticated, capabilities: adminCapabilities, section, setError })
  const { records, cdkSearchInput, cdkPage, cdkPageSize, cdkSearch, statusFilter, permissionFilter, riskFilter, generatedFilter,
    cdkTypeFilter, cdkFilters } = cdkData
  const overview = useAdminOverview({ adminUsername, authenticated, capabilities: adminCapabilities, section })
  const { businessOverview, announcementData, announcementUpdatedAt, updateAnnouncementSnapshot, riskSettings, setRiskSettings,
    cdkSummary, overviewLoading, overviewError, overviewUpdatedAt, overviewPartialFailure } = overview
  const loading = loginLoading || overviewLoading
  const cdkOpsSummary = useMemo(() => cdkSummary ?? buildCdkOpsSummary(records), [cdkSummary, records])
  const visibleRecords = records

  const selectedRecords = useMemo(() => {
      const selected = new Set(selectedCdkHashes)
      return records.filter((record) => selected.has(record.code_hash))
    }, [records, selectedCdkHashes])

  const resetAdminState = useCallback(() => {
      queryClient.removeQueries({ queryKey: ['admin'] })
      setAdminUsername(null)
      setAdminCapabilities([])
      setLastSuccessfulSyncAt(null)
      setBusyAction(null)
      cancelAdminOperation()
      setAuthenticated(false)
      setSelectedUserIds([])
      setSelectedCdkHashes([])
      setSelectedCdkDetail(null)
      setSelectedUserDetail(null)
      setOperatorDataByProfileId({})
      setExpandedOperatorProfileId(null)
    }, [])

  const { balance: selectedUserBalance, loading: userBalanceLoading, error: balanceReadError, handleLoadMoreUserBalance, handleAdjustUserBalance } = useAdminUserBalance({
    username: adminUsername, capabilities: adminCapabilities, userId: selectedUserDetail?.user.id ?? null, active: authenticated && section === 'users',
    setBusyAction,
    setError,
    setNotice,
    refreshUsers: () => loadUsersPage(),
  })

  const refreshAdminData = useCallback(async () => {
    if (!authenticated || !adminUsername) return
    setError(null)
    const families = section === 'overview' ? ['overview'] : section === 'announcement' ? ['announcement']
      : section === 'cdk' ? ['cdks'] : section === 'risk' ? ['cdks', 'risk-settings'] : section === 'users' ? ['users'] : []
    const results = await Promise.allSettled(families.map((family) => queryClient.invalidateQueries({
      queryKey: ['admin', adminUsername, family],
    }, { throwOnError: true })))
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length > 0) {
      setError(`部分数据刷新失败：${failures.map((result) => errorMessage(result.reason)).join('；')}`)
      setNotice((current) => current ? `${current}；操作已成功，但部分数据刷新失败，请手动重试。` : current)
    }
    if (!failures.length && families.length) setLastSuccessfulSyncAt(new Date().toISOString())
  }, [authenticated, adminUsername, queryClient, section])

  const loadDashboard = refreshAdminData

  useEffect(() => {
      let active = true
      apiJson<{ user?: AdminSessionUser }>('/api/admin/session', { fallbackMessage: '管理员会话检查失败' })
        .then((data) => {
          if (!active || !data.user?.username) return
          setAdminUsername(data.user.username)
          setAdminCapabilities(data.user.capabilities ?? [])
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
    setError(null)
    setNotice(null)
    setLastSuccessfulSyncAt(null)
    return cancelAdminOperation
  }, [section])

  useEffect(() => {
    if (adminUsername && announcementData) reconcileLoadedAnnouncementData(adminUsername, announcementData)
  }, [adminUsername, announcementData, announcementUpdatedAt, reconcileLoadedAnnouncementData])

  useEffect(() => {
    if (['overview', 'announcement', 'cdk', 'risk'].includes(section)) {
      setLastSuccessfulSyncAt(overviewUpdatedAt ? new Date(overviewUpdatedAt).toISOString() : null)
    }
  }, [overviewUpdatedAt, section])

  useEffect(() => { setSelectedCdkHashes([]) }, [cdkPage, cdkPageSize, cdkSearchInput, statusFilter, cdkTypeFilter, permissionFilter, riskFilter, generatedFilter])

  useEffect(() => {
    if (authenticated && section === 'users' && usersUpdatedAt) setLastSuccessfulSyncAt(new Date(usersUpdatedAt).toISOString())
  }, [authenticated, section, usersUpdatedAt])

  useEffect(() => {
      const handleSessionExpired = () => {
        prepareForAuthenticationReset()
        resetAdminState()
      }
      window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleSessionExpired)
      return () => window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, handleSessionExpired)
    }, [prepareForAuthenticationReset, resetAdminState])

  useEffect(() => {
      const available = new Set(records.map((record) => record.code_hash))
      setSelectedCdkHashes((current) => current.filter((hash) => available.has(hash)))
    }, [records])

  useEffect(() => {
    setSelectedCdkHashes([])
  }, [cdkPage, cdkPageSize, cdkSearch, cdkFilters])

  const handleLogin = async (event: FormEvent) => {
      event.preventDefault()
      const nextErrors: FieldErrors = {}
      if (!loginUser.trim()) nextErrors.loginUser = '请输入账号'
      if (!loginPassword) nextErrors.loginPassword = '请输入密码'
      setLoginFieldErrors(nextErrors)
      if (Object.keys(nextErrors).length > 0) return
      setLoginLoading(true)
      setError(null)
      try {
        const data = await apiJson<{ user?: AdminSessionUser }>('/api/admin/session', {
          method: 'POST',
          json: { username: loginUser.trim(), password: loginPassword },
          fallbackMessage: '管理账号或密码错误',
        })
        if (!data.user?.username) throw new Error('管理员登录响应无效')
        setAdminUsername(data.user.username)
        setAdminCapabilities(data.user.capabilities ?? [])
        setLoginUser(data.user.username)
        setLoginPassword('')
        setAuthenticated(true)
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setLoginLoading(false)
      }
    }

  const handleLogout = () => {
      prepareForAuthenticationReset()
      resetAdminState()
      setSessionChecking(true)
      void apiVoid('/api/admin/session', { method: 'DELETE' })
        .catch(() => undefined)
        .finally(() => setSessionChecking(false))
    }

  const handleExportUsageReport = async (format: 'csv' | 'json') => {
      if (!authenticated) return
      if (!businessOverview || loading) {
        setError('请等待当前报表加载完成后再导出。')
        return
      }
      setBusyAction(`report:${format}`)
      setError(null)
      setNotice(null)
      try {
        const filenameRange = `${businessOverview.current.from}_${businessOverview.current.to}`
        const blob = format === 'json'
          ? new Blob([JSON.stringify(businessOverview, null, 2)], { type: 'application/json;charset=utf-8' })
          : new Blob([`\uFEFF${operationsOverviewCsv(businessOverview)}`], { type: 'text/csv;charset=utf-8' })
        downloadBlob(blob, `admin-business-report-${filenameRange}.${format}`)
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
        const formData = new FormData(event.currentTarget as HTMLFormElement)
        const selectedItemCode = formData.get('item_code')
        const validityMode = formData.get('item_validity_mode')
        const data = await apiJson<AdminCdkCreateResponse>('/api/admin/cdk', {
          method: 'POST',
          json: {
            cdk_type: cdkType,
            ...(cdkType === 'profile'
              ? { permission, profile_duration: formData.get('profile_duration') }
              : cdkType === 'balance'
                ? { amount: balanceAmount }
                : {
                    item_code: selectedItemCode,
                    ...(selectedItemCode === 'limited_profile_voucher'
                      ? {
                          item_validity_mode: validityMode,
                          ...(validityMode === 'days'
                            ? { item_validity_days: Number(formData.get('item_validity_days')) }
                            : { item_expires_at: formData.get('item_expires_at') }),
                        }
                      : {}),
                  }),
            order_note: orderNote,
            count: batchCount,
          },
          fallbackMessage: '生成失败',
        })
        const nextGeneratedCodes = normalizeGeneratedCdks(data)
        if (nextGeneratedCodes.length === 0) {
          throw new Error('生成失败')
        }
        setGeneratedCodes(nextGeneratedCodes)
        setOrderNote('')
        setNotice(`已生成 ${nextGeneratedCodes.length} 个 CDK`)
        await refreshAdminData()
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
      if (announcementDraftConflict && !window.confirm('线上公告已在此草稿保存后发生变化。确认用当前本机草稿覆盖线上版本？')) return
      persistAnnouncementDraft()
      setBusyAction('announcement')
      setError(null)
      setNotice(null)
      try {
        const data = await apiJson<Partial<AnnouncementAdminResponse>>('/api/admin/announcement', {
          method: 'PUT',
          json: currentAnnouncementSnapshot(),
          fallbackMessage: '保存公告失败',
        })
        await updateAnnouncementSnapshot(data)
        if (adminUsername) acceptServerAnnouncementData(adminUsername, data, true)
        setNotice('横幅和公告已发布')
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 409 && adminUsername && caught.data && typeof caught.data === 'object') {
          const data = caught.data as Partial<AnnouncementAdminResponse>
          await updateAnnouncementSnapshot(data)
          reconcileLoadedAnnouncementData(adminUsername, data)
        }
        setError((caught as Error).message)
      } finally {
        setBusyAction(null)
      }
    }

  const handleDiscardAnnouncementDraft = async () => {
      if (!announcementDraftDirty || !window.confirm('确认丢弃当前本机草稿并重新载入线上公告？此操作无法撤销。')) return
      setBusyAction('announcement-discard')
      setError(null)
      setNotice(null)
      try {
        const data = await apiJson<Partial<AnnouncementAdminResponse>>('/api/admin/announcement', {
          fallbackMessage: '重新加载线上公告失败',
        })
        if (!adminUsername) throw new Error('无法确认当前管理员身份')
        await updateAnnouncementSnapshot(data)
        const discardError = discardAndAcceptServerData(adminUsername, data)
        if (discardError) throw new Error(discardError)
        setNotice('本机草稿已丢弃，已重新载入线上公告')
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setBusyAction(null)
      }
    }

  const handleSaveRiskSettings = async (
      patch: RiskControlSettingsPatch,
      reason: string,
      rootPassword: string,
    ): Promise<boolean> => saveRiskControlSettings({
      patch, reason, rootPassword, currentRevision: riskSettings.revision,
      setSettings: setRiskSettings, setBusyAction, setError, setNotice,
    })

  const mutateCdk = async (
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
          if (selectedUserDetail && selectedUserDetail.user.id === data.cdk.linked_account?.account_id) await loadUserDetail(selectedUserDetail.user)
        } else if (selectedCdkDetail?.code_hash === record.code_hash) {
          await cdkDetailQuery.load(record.code_hash)
        }
        setNotice('CDK 已更新')
        await refreshAdminData()
        return null
      } catch (caught) {
        const message = (caught as Error).message
        setError(message)
        return message
      } finally {
        setBusyAction(null)
      }
    }
  const patchCdk = async (...args: Parameters<typeof mutateCdk>): Promise<void> => { await mutateCdk(...args) }
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
        await refreshAdminData()
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setBusyAction(null)
      }
    }

  const loadCdkDetail = async (record: AdminCdkRecord) => { setError(null); await cdkDetailQuery.load(record.code_hash) }

  const handleUpdateCdkNote = (record: AdminCdkDetail) => requestAdminOperationEdit({
    title: '修改 CDK 备注', description: `CDK ${record.cdk_id}。留空可清除订单备注。`, confirmLabel: '保存备注',
    fields: [{ name: 'order_note', label: '订单备注', value: record.order_note ?? '', maxLength: 500 }],
    onSubmit: (values) => mutateCdk(record, 'update_note', undefined, values),
  })

  const handleSetCdkPermission = (record: AdminCdkDetail) => requestAdminOperationEdit({
    title: '修改 CDK 授权', description: `CDK ${record.cdk_id}，当前授权 ${record.permission ?? '-'}。`, confirmLabel: '确认修改授权',
    fields: [{ name: 'permission', label: '新授权', value: normalizeProductPermission(record.permission ?? '') ?? 'growth', required: true,
      options: cdkProductPermissions.map((value) => ({ value, label: value })) }],
    onSubmit: (values) => {
      const permissionValue = normalizeProductPermission(values.permission)
      return permissionValue ? mutateCdk(record, 'set_permission', permissionValue) : Promise.resolve('请选择有效的授权类型。')
    },
  })

  const handleBulkCdk = (action: BulkCdkAction, targetPermission?: GeneratedPermission, note?: string) => mutateSelectedCdks({
      action, permission: targetPermission, orderNote: note, records: selectedRecords, selectedDetailHash: selectedCdkDetail?.code_hash ?? null,
      setBusyAction, setNotice, setError, setSelectedHashes: setSelectedCdkHashes,
      clearSelectedDetail: () => setSelectedCdkDetail(null), refresh: refreshAdminData,
    })

  const loadUserDetail = async (user: Pick<AppUserSummary, 'id'>, profilePage = 1, profileId?: string) => {
    setError(null)
    setExpandedOperatorProfileId(null)
    return userDetailQuery.load({ id: user.id, page: profilePage, size: selectedUserDetail?.user.id === user.id ? selectedUserDetail.profile_pagination?.page_size ?? 100 : 100, profileId })
  }

  const loadProfileOperatorData = async (
      profile: AdminProfileSummary,
      options: { expand?: boolean; busyKey?: string } = {},
    ): Promise<AdminProfileOperatorData | null> => {
      if (!selectedUserDetail) return null
      setError(null); setNotice(null)
      const data = await operatorQueries.load(profile.id)
      if (data && options.expand !== false) setExpandedOperatorProfileId(profile.id)
      return data
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
  const handleDownloadUserWorkspaces = (profileIds?: string[]) => selectedUserDetail ? downloadAdminUserWorkspaces({ userId: selectedUserDetail.user.id, profileIds, setBusyAction, setError, setNotice }) : Promise.resolve(false)
  const requestOperationReason = (message: string) => requestAdminOperationReason({
      title: '确认管理员操作',
      description: message,
    })
  const {
    handleUpdateProfile,
    handleSetProfileStatus,
    handleSetProfilePermission,
    handleUpgradePreviewProfile,
    handleClearProfileSklandBinding,
    handleClearProfileWorkspace,
  } = createAdminProfileActions({
    selectedUserDetail,
    loadUserDetail,
    expandedOperatorProfileId,
    setSelectedUserDetail,
    setOperatorDataByProfileId,
    setExpandedOperatorProfileId,
    setBusyAction,
    setError,
    setNotice,
    refreshAdminData,
  })

  const handleResetUserPassword = async (event: FormEvent) => {
      event.preventDefault()
      const nextErrors: FieldErrors = {}
      const emailError = validateEmailInput(resetUserEmail)
      const passwordError = validatePasswordInput(resetPassword)
      if (emailError) nextErrors.resetUserEmail = emailError
      if (passwordError) nextErrors.resetPassword = passwordError
      setResetFieldErrors(nextErrors)
      if (Object.keys(nextErrors).length > 0) return
      if (!window.confirm(`确认重置 ${resetUserEmail} 的密码并撤销其全部现有会话？`)) return
      const reason = await requestOperationReason(`用户 ${resetUserEmail} 的密码将被重置，全部现有会话将撤销。请输入操作原因。`)
      if (!reason) return
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
            reason,
          },
          fallbackMessage: '重置密码失败',
        })
        setNotice(`已重置 ${data.user?.email ?? resetUserEmail} 的密码`)
        setResetUserEmail('')
        setResetPassword('')
        await refreshAdminData()
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
      reason: string,
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
            reason,
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
        await refreshAdminData()
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setBusyAction(null)
      }
    }

  const handleFreezeAppUser = async (user: AppUserSummary) => {
      if (!window.confirm(`确认冻结账号 ${user.email}？`)) return
      const reason = await requestOperationReason(`用户 ${user.email}：${user.status} → frozen。请输入操作原因。`)
      if (!reason) return
      await patchAppUser(user, 'freeze_account', '已冻结账号', reason)
    }

  const handleUnfreezeAppUser = async (user: AppUserSummary) => {
      if (!window.confirm(`确认解冻账号 ${user.email}？`)) return
      const reason = await requestOperationReason(`用户 ${user.email}：${user.status} → active。请输入操作原因。`)
      if (!reason) return
      await patchAppUser(user, 'unfreeze_account', '已解冻账号', reason)
    }

  const handleDeleteAppUser = async (user: AppUserSummary) => {
      const confirmedEmail = window.prompt(`立即永久擦除 ${user.email} 的全部个人数据（含档案、工作区、任务、样本与使用记录）。请输入该邮箱确认。`)
      if (confirmedEmail === null) return
      if (confirmedEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
        setNotice(null)
        setError('确认邮箱不匹配，已取消删除。')
        return
      }
      const reason = await requestOperationReason(`用户 ${user.email} 的个人数据将被永久擦除。请输入业务原因或工单号。`)
      if (!reason) return
      await patchAppUser(user, 'delete_account', '已删除账号', reason, { confirm_email: confirmedEmail.trim() })
    }

  return {
    ...userList, ...cdkData, ...overview, cdkOpsSummary, adminCapabilities, lastSuccessfulSyncAt, overviewPartialFailure,
    permission, cdkType, setCdkType, balanceAmount, setBalanceAmount,
    adminUsername, loginUser, setLoginUser, loginPassword, setLoginPassword, authenticated, sessionChecking,
    setPermission,
    banner, announcements, announcementStats, announcementDraftStatus, announcementDraftSavedAt,
    announcementDraftRestored, announcementDraftConflict, announcementDraftError, announcementDraftDirty,
    riskSettings, orderNote, setOrderNote, cdkCount, setCdkCount, generatedCodes,
    selectedCdkHashes, setSelectedCdkHashes, selectedCdkDetail, setSelectedCdkDetail, selectedUserDetail, setSelectedUserDetail,
    selectedUserBalance, userBalanceLoading, operatorDataByProfileId, setOperatorDataByProfileId,
    expandedOperatorProfileId, setExpandedOperatorProfileId, resetUserEmail, setResetUserEmail, resetPassword, setResetPassword,
    loginFieldErrors, setLoginFieldErrors, resetFieldErrors, setResetFieldErrors, loading, busyAction, error: error ?? cdkDetailQuery.error?.message ?? userDetailQuery.error?.message ?? operatorQueries.error?.message ?? balanceReadError?.message ?? overviewError, notice, clearNotice,
    visibleRecords, loadDashboard, handleLogin, handleLogout,
    handleExportUsageReport, handleGenerateCdk, handleCopyGeneratedCdks, handleDownloadGeneratedCdks,
    handleSaveAnnouncement, handleDiscardAnnouncementDraft, handleSaveRiskSettings,
    updateBanner, addAnnouncement, updateAnnouncement, deleteAnnouncement, reorderAnnouncements,
    patchCdk, deleteCdk, loadCdkDetail, handleUpdateCdkNote, handleSetCdkPermission, handleBulkCdk, loadUserDetail,
    handleLoadMoreUserBalance, handleAdjustUserBalance, handleViewProfileOperators, handleDownloadProfileOperators,
    handleDownloadUserWorkspaces, handleUpdateProfile, handleSetProfileStatus, handleSetProfilePermission,
    handleUpgradePreviewProfile, handleClearProfileSklandBinding, handleClearProfileWorkspace,
    handleResetUserPassword, handleFreezeAppUser, handleUnfreezeAppUser, handleDeleteAppUser,
  }
}
