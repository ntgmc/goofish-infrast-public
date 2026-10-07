import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import { EMPTY_PAGINATION, type AdminCapability, type AdminCdkRecord, type AdminSection, type BinaryFilter, type CdkOpsSummary,
  type CdkTableFilters, type CdkTypeFilter, type PaginationMeta, type PermissionFilter, type StatusFilter } from '../contracts'
import { buildCdkOpsSummary } from '../shared/helpers'

export function useAdminCdkData({ authenticated, capabilities, section, setError }: {
  authenticated: boolean; capabilities: AdminCapability[]; section: AdminSection; setError: (error: string | null) => void
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [cdkTypeFilter, setCdkTypeFilter] = useState<CdkTypeFilter>('all')
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>('all')
  const [riskFilter, setRiskFilter] = useState<BinaryFilter>('all')
  const [generatedFilter, setGeneratedFilter] = useState<BinaryFilter>('all')
  const [records, setRecords] = useState<AdminCdkRecord[]>([])
  const [cdkSearchInput, setCdkSearchInput] = useState('')
  const [cdkSearch, setCdkSearch] = useState('')
  const [cdkPage, setCdkPage] = useState(1)
  const [cdkPageSize, setCdkPageSize] = useState(25)
  const [cdkPagination, setCdkPagination] = useState<PaginationMeta>(EMPTY_PAGINATION)
  const [cdkLoading, setCdkLoading] = useState(false)
  const [cdkLoaded, setCdkLoaded] = useState(false)
  const [riskRecords, setRiskRecords] = useState<AdminCdkRecord[]>([])
  const [riskPage, setRiskPage] = useState(1)
  const [riskPageSize, setRiskPageSize] = useState(25)
  const [riskPagination, setRiskPagination] = useState<PaginationMeta>(EMPTY_PAGINATION)
  const [riskLoading, setRiskLoading] = useState(false)
  const [summary, setSummary] = useState<CdkOpsSummary | null>(null)
  const cdkOpsSummary = useMemo(() => summary ?? buildCdkOpsSummary(records), [summary, records])
  const cdkFilters = useMemo<CdkTableFilters>(() => ({ status: statusFilter, cdk_type: cdkTypeFilter, permission: permissionFilter, risk: riskFilter, generated: generatedFilter }),
    [statusFilter, cdkTypeFilter, permissionFilter, riskFilter, generatedFilter])
  const loadCdkPage = useCallback(async (signal?: AbortSignal) => {
    setCdkLoading(true)
    try {
      const params = new URLSearchParams({ page: String(cdkPage), page_size: String(cdkPageSize), search: cdkSearch, ...cdkFilters })
      const data = await adminApiJson<{ cdks?: AdminCdkRecord[]; pagination?: PaginationMeta }>(`/api/admin/cdk?${params}`, { signal, fallbackMessage: '加载 CDK 失败' })
      if (signal?.aborted) return
      setRecords(data.cdks ?? [])
      setCdkPagination(data.pagination ?? { ...EMPTY_PAGINATION, page_size: cdkPageSize })
      if (data.pagination && data.pagination.page !== cdkPage) setCdkPage(data.pagination.page)
    } finally { if (!signal?.aborted) { setCdkLoading(false); setCdkLoaded(true) } }
  }, [cdkPage, cdkPageSize, cdkSearch, cdkFilters])
  const loadRiskPage = useCallback(async (signal?: AbortSignal) => {
    setRiskLoading(true)
    try {
      const params = new URLSearchParams({ view: 'risk', status: 'all', page: String(riskPage), page_size: String(riskPageSize) })
      const data = await adminApiJson<{ cdks?: AdminCdkRecord[]; pagination?: PaginationMeta }>(`/api/admin/cdk?${params}`, { signal, fallbackMessage: '加载风险记录失败' })
      if (signal?.aborted) return
      setRiskRecords(data.cdks ?? [])
      setRiskPagination(data.pagination ?? { ...EMPTY_PAGINATION, page_size: riskPageSize })
      if (data.pagination && data.pagination.page !== riskPage) setRiskPage(data.pagination.page)
    } finally { if (!signal?.aborted) setRiskLoading(false) }
  }, [riskPage, riskPageSize])
  const loadCdkSummary = useCallback(async (signal?: AbortSignal) => {
    const data = await adminApiJson<{ summary?: CdkOpsSummary }>('/api/admin/cdk?view=summary', { signal, fallbackMessage: '加载 CDK 汇总失败' })
    if (!signal?.aborted) setSummary(data.summary ?? null)
  }, [])
  const resetCdkData = useCallback(() => { setRecords([]); setRiskRecords([]); setSummary(null); setCdkLoading(false); setCdkLoaded(false); setRiskLoading(false) }, [])
  useEffect(() => {
    const timeout = window.setTimeout(() => { setCdkSearch(cdkSearchInput.trim()); setCdkPage(1) }, 300)
    return () => window.clearTimeout(timeout)
  }, [cdkSearchInput])
  useEffect(() => {
    if (!authenticated || section !== 'cdk' || !capabilities.includes('admin_manage')) return
    const controller = new AbortController()
    void loadCdkPage(controller.signal).catch((caught) => { if (!controller.signal.aborted) setError((caught as Error).message) })
    return () => controller.abort()
  }, [authenticated, capabilities, section, loadCdkPage, setError])
  useEffect(() => {
    if (!authenticated || section !== 'risk' || !capabilities.includes('risk_view')) return
    const controller = new AbortController()
    void loadRiskPage(controller.signal).catch((caught) => { if (!controller.signal.aborted) setError((caught as Error).message) })
    return () => controller.abort()
  }, [authenticated, capabilities, section, loadRiskPage, setError])
  return { records, cdkSearchInput, setCdkSearchInput, cdkPage, setCdkPage, cdkPageSize, setCdkPageSize, cdkPagination, cdkLoading, cdkLoaded,
    riskRecords, riskPage, setRiskPage, riskPageSize, setRiskPageSize, riskPagination, riskLoading, cdkOpsSummary,
    cdkFilters, cdkSearch, cdkTypeFilter, setCdkTypeFilter, statusFilter, setStatusFilter, permissionFilter, setPermissionFilter,
    riskFilter, setRiskFilter, generatedFilter, setGeneratedFilter, loadCdkPage, loadRiskPage, loadCdkSummary, resetCdkData }
}
