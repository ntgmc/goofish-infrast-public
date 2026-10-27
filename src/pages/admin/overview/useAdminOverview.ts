import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { AnnouncementAdminResponse } from '../../../lib/types'
import { isOperationsDate, operationsDate, shiftOperationsDate, type OperationsOverview, type OperationsRangeMode } from '../../../lib/operations-overview'
import { normalizeRiskSettings } from '../shared/helpers'
import type { AdminCapability, AdminSection, CdkOpsSummary, RiskControlSettings } from '../contracts'

export function useAdminOverview({ adminUsername, authenticated, capabilities, section }: {
  adminUsername: string | null; authenticated: boolean; capabilities: AdminCapability[]; section: AdminSection
}) {
  const queryClient = useQueryClient()
  const [usageRange, setUsageRange] = useState<OperationsRangeMode>('30d')
  const [usageRangeFrom, setUsageRangeFrom] = useState(() => shiftOperationsDate(operationsDate(), -29))
  const [usageRangeTo, setUsageRangeTo] = useState(() => operationsDate())
  const [customRange, setCustomRange] = useState({ from: usageRangeFrom, to: usageRangeTo })
  const [customRangeError, setCustomRangeError] = useState<string | null>(null)
  const query = useMemo(() => usageRange === 'custom'
    ? new URLSearchParams({ view: 'business', from: customRange.from, to: customRange.to }).toString()
    : new URLSearchParams({ view: 'business', range: usageRange }).toString(), [usageRange, customRange])
  const signedIn = authenticated && Boolean(adminUsername)
  const usageEnabled = signedIn && section === 'overview' && capabilities.includes('usage_view')
  const announcementEnabled = signedIn && section === 'announcement' && capabilities.includes('admin_manage')
  const riskEnabled = signedIn && section === 'risk' && capabilities.includes('risk_view')
  const cdkEnabled = signedIn && ['cdk', 'risk'].includes(section) && capabilities.includes('admin_manage')
  const usageQuery = useQuery({
    queryKey: ['admin', usageEnabled ? adminUsername : null, 'overview', capabilities, query],
    enabled: usageEnabled,
    queryFn: async ({ signal }) => {
      const data = await adminApiJson<OperationsOverview>(`/api/admin/usage-stats?${query}`, { signal, fallbackMessage: '运营看板加载失败，请重新刷新。' })
      if (data.metrics_version !== 'business.v1' || !data.current || !data.previous || !Array.isArray(data.days)) {
        throw new Error('运营报表版本不兼容，请刷新页面后重试。')
      }
      return data
    },
  })
  const announcementQuery = useQuery({
    queryKey: ['admin', announcementEnabled ? adminUsername : null, 'announcement', capabilities],
    enabled: announcementEnabled,
    queryFn: ({ signal }) => adminApiJson<Partial<AnnouncementAdminResponse>>('/api/admin/announcement', { signal, fallbackMessage: '加载公告失败' }),
  })
  const riskQuery = useQuery({
    queryKey: ['admin', riskEnabled ? adminUsername : null, 'risk-settings', capabilities],
    enabled: riskEnabled,
    queryFn: ({ signal }) => adminApiJson<{ settings?: Partial<RiskControlSettings> }>('/api/admin/risk-settings', { signal, fallbackMessage: '加载风控设置失败' }),
  })
  const cdkQuery = useQuery({
    queryKey: ['admin', cdkEnabled ? adminUsername : null, 'cdks', capabilities, 'summary'],
    enabled: cdkEnabled,
    queryFn: ({ signal }) => adminApiJson<{ summary?: CdkOpsSummary }>('/api/admin/cdk?view=summary', { signal, fallbackMessage: '加载 CDK 汇总失败' }),
  })
  const queries = [usageEnabled ? usageQuery : null, announcementEnabled ? announcementQuery : null,
    riskEnabled ? riskQuery : null, cdkEnabled ? cdkQuery : null].filter((query) => query !== null)
  const failures = queries.filter((query) => query.error)
  const overviewLoading = queries.some((query) => query.isFetching)
  const overviewError = failures.length ? `部分概览数据刷新失败：${failures.map((query) => query.error!.message).join('；')}` : null
  const overviewUpdatedAt = Math.max(0, ...queries.map((query) => query.dataUpdatedAt))

  const applyCustomRange = () => {
    if (!isOperationsDate(usageRangeFrom) || !isOperationsDate(usageRangeTo) || usageRangeFrom > usageRangeTo
      || usageRangeTo > operationsDate() || Date.parse(usageRangeTo) - Date.parse(usageRangeFrom) >= 90 * 86_400_000) {
      setCustomRangeError('请选择不晚于今天的 1 至 90 天日期范围。')
      return
    }
    setCustomRangeError(null)
    setCustomRange({ from: usageRangeFrom, to: usageRangeTo })
  }

  const updateAnnouncementSnapshot = useCallback(async (data: Partial<AnnouncementAdminResponse>) => {
    const filter = { queryKey: ['admin', adminUsername, 'announcement', capabilities], exact: true }
    await queryClient.cancelQueries(filter)
    queryClient.setQueriesData(filter, data)
  }, [adminUsername, capabilities, queryClient])
  const setRiskSettings = useCallback(async (settings: RiskControlSettings) => {
    const filter = { queryKey: ['admin', adminUsername, 'risk-settings', capabilities], exact: true }
    await queryClient.cancelQueries(filter)
    queryClient.setQueriesData(filter, { settings })
  }, [adminUsername, capabilities, queryClient])

  return {
    usageRange, setUsageRange, usageRangeFrom, setUsageRangeFrom, usageRangeTo, setUsageRangeTo, customRangeError, applyCustomRange,
    businessOverview: usageEnabled ? usageQuery.data ?? null : null,
    announcementData: announcementEnabled ? announcementQuery.data : undefined,
    announcementUpdatedAt: announcementEnabled ? announcementQuery.dataUpdatedAt : 0, updateAnnouncementSnapshot,
    riskSettings: normalizeRiskSettings(riskEnabled ? riskQuery.data?.settings : undefined), setRiskSettings,
    cdkSummary: cdkEnabled ? cdkQuery.data?.summary ?? null : null,
    overviewLoading, overviewError, overviewUpdatedAt, overviewPartialFailure: failures.length > 0,
  }
}
