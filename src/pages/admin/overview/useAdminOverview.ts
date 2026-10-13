import { useCallback, useMemo, useState } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import { isOperationsDate, operationsDate, shiftOperationsDate, type OperationsOverview, type OperationsRangeMode } from '../../../lib/operations-overview'

export function useAdminOverview() {
  const [usageRange, setUsageRange] = useState<OperationsRangeMode>('30d')
  const [usageRangeFrom, setUsageRangeFrom] = useState(() => shiftOperationsDate(operationsDate(), -29))
  const [usageRangeTo, setUsageRangeTo] = useState(() => operationsDate())
  const [customRange, setCustomRange] = useState({ from: usageRangeFrom, to: usageRangeTo })
  const [customRangeError, setCustomRangeError] = useState<string | null>(null)
  const [businessOverview, setBusinessOverview] = useState<OperationsOverview | null>(null)
  const query = useMemo(() => usageRange === 'custom'
    ? new URLSearchParams({ view: 'business', from: customRange.from, to: customRange.to }).toString()
    : new URLSearchParams({ view: 'business', range: usageRange }).toString(), [usageRange, customRange])

  const applyCustomRange = () => {
    if (!isOperationsDate(usageRangeFrom) || !isOperationsDate(usageRangeTo) || usageRangeFrom > usageRangeTo
      || usageRangeTo > operationsDate() || Date.parse(usageRangeTo) - Date.parse(usageRangeFrom) >= 90 * 86_400_000) {
      setCustomRangeError('请选择不晚于今天的 1 至 90 天日期范围。')
      return
    }
    setCustomRangeError(null)
    setCustomRange({ from: usageRangeFrom, to: usageRangeTo })
  }

  const loadUsageStats = useCallback(async (signal?: AbortSignal) => {
    const data = await adminApiJson<OperationsOverview>(`/api/admin/usage-stats?${query}`, { signal, fallbackMessage: '运营看板加载失败，请重新刷新。' })
    if (data.metrics_version !== 'business.v1' || !data.current || !data.previous || !Array.isArray(data.days)) {
      throw new Error('运营报表版本不兼容，请刷新页面后重试。')
    }
    if (!signal?.aborted) setBusinessOverview(data)
  }, [query])

  return {
    usageRange, setUsageRange, usageRangeFrom, setUsageRangeFrom, usageRangeTo, setUsageRangeTo,
    customRangeError, applyCustomRange, businessOverview, setBusinessOverview, loadUsageStats,
  }
}
