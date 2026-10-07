import { useCallback, useMemo, useState } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import type { AdminCdkRecord, CdkOpsSummary, UsageRangeMode, UsageStatsResponse } from '../contracts'
import { buildSummary, buildUsageStatsQuery, getDateOffsetString, normalizeUsageStats } from '../shared/helpers'

export function useAdminOverview(records: AdminCdkRecord[], adminUsers: number, cdkOpsSummary: CdkOpsSummary) {
  const [usageRange, setUsageRange] = useState<UsageRangeMode>('7d')
  const [usageRangeFrom, setUsageRangeFrom] = useState(() => getDateOffsetString(6))
  const [usageRangeTo, setUsageRangeTo] = useState(() => getDateOffsetString(0))
  const [usageStats, setUsageStats] = useState<UsageStatsResponse | null>(null)
  const usageStatsQuery = useMemo(() => buildUsageStatsQuery(usageRange, usageRangeFrom, usageRangeTo), [usageRange, usageRangeFrom, usageRangeTo])
  const summary = useMemo(() => buildSummary(records, usageStats?.totals, adminUsers, cdkOpsSummary), [records, usageStats, adminUsers, cdkOpsSummary])
  const loadUsageStats = useCallback(async (signal?: AbortSignal) => {
    if (!usageStatsQuery) throw new Error('自定义时间范围无效，请选择开始和结束日期')
    const data = await adminApiJson<Partial<UsageStatsResponse>>(`/api/admin/usage-stats?${usageStatsQuery}`, { signal, fallbackMessage: '加载统计失败' })
    if (!signal?.aborted) setUsageStats(normalizeUsageStats(data))
  }, [usageStatsQuery])
  return { usageRange, setUsageRange, usageRangeFrom, setUsageRangeFrom, usageRangeTo, setUsageRangeTo, usageStats, setUsageStats, summary, loadUsageStats }
}
