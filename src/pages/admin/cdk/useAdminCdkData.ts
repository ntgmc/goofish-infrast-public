import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApiJson } from '../../../lib/admin-api-client'
import { EMPTY_PAGINATION, type AdminCapability, type AdminCdkRecord, type AdminSection, type BinaryFilter,
  type CdkTableFilters, type CdkTypeFilter, type PaginationMeta, type PermissionFilter, type StatusFilter } from '../contracts'

const EMPTY_CDK_RECORDS: AdminCdkRecord[] = []

export function useAdminCdkData({ adminUsername, authenticated, capabilities, section, setError }: {
  adminUsername: string | null; authenticated: boolean; capabilities: AdminCapability[]; section: AdminSection; setError: (error: string | null) => void
}) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [cdkTypeFilter, setCdkTypeFilter] = useState<CdkTypeFilter>('all')
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>('all')
  const [riskFilter, setRiskFilter] = useState<BinaryFilter>('all')
  const [generatedFilter, setGeneratedFilter] = useState<BinaryFilter>('all')
  const [cdkSearchInput, setCdkSearchInput] = useState('')
  const [cdkSearch, setCdkSearch] = useState('')
  const [cdkPage, setCdkPage] = useState(1)
  const [cdkPageSize, setCdkPageSize] = useState(25)
  const [riskPage, setRiskPage] = useState(1)
  const [riskPageSize, setRiskPageSize] = useState(25)
  const cdkFilters = useMemo<CdkTableFilters>(() => ({ status: statusFilter, cdk_type: cdkTypeFilter, permission: permissionFilter, risk: riskFilter, generated: generatedFilter }),
    [statusFilter, cdkTypeFilter, permissionFilter, riskFilter, generatedFilter])
  const cdkEnabled = authenticated && Boolean(adminUsername) && section === 'cdk' && capabilities.includes('admin_manage')
  const riskEnabled = authenticated && Boolean(adminUsername) && section === 'risk' && capabilities.includes('risk_view')
  const cdkQuery = useQuery({
    queryKey: ['admin', cdkEnabled ? adminUsername : null, 'cdks', capabilities, 'list', cdkPage, cdkPageSize, cdkSearch, cdkFilters],
    enabled: cdkEnabled,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(cdkPage), page_size: String(cdkPageSize), search: cdkSearch, ...cdkFilters })
      return adminApiJson<{ cdks?: AdminCdkRecord[]; pagination?: PaginationMeta }>(`/api/admin/cdk?${params}`, { signal, fallbackMessage: '加载 CDK 失败' })
    },
  })
  const riskQuery = useQuery({
    queryKey: ['admin', riskEnabled ? adminUsername : null, 'cdks', capabilities, 'risk', riskPage, riskPageSize],
    enabled: riskEnabled,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ view: 'risk', status: 'all', page: String(riskPage), page_size: String(riskPageSize) })
      return adminApiJson<{ cdks?: AdminCdkRecord[]; pagination?: PaginationMeta }>(`/api/admin/cdk?${params}`, { signal, fallbackMessage: '加载风险记录失败' })
    },
  })
  const records = cdkEnabled ? cdkQuery.data?.cdks ?? EMPTY_CDK_RECORDS : EMPTY_CDK_RECORDS
  const riskRecords = riskEnabled ? riskQuery.data?.cdks ?? EMPTY_CDK_RECORDS : EMPTY_CDK_RECORDS
  const cdkPagination = cdkQuery.data?.pagination ?? { ...EMPTY_PAGINATION, page_size: cdkPageSize }
  const riskPagination = riskQuery.data?.pagination ?? { ...EMPTY_PAGINATION, page_size: riskPageSize }
  const refreshCdkLists = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', adminUsername, 'cdks'] }, { throwOnError: true })
  }, [adminUsername, queryClient])

  useEffect(() => {
    const timeout = window.setTimeout(() => { setCdkSearch(cdkSearchInput.trim()); setCdkPage(1) }, 300)
    return () => window.clearTimeout(timeout)
  }, [cdkSearchInput])
  useEffect(() => {
    const error = cdkEnabled ? cdkQuery.error : riskEnabled ? riskQuery.error : null
    if (error) setError(error.message)
  }, [cdkEnabled, cdkQuery.error, riskEnabled, riskQuery.error, setError])
  useEffect(() => {
    if (cdkEnabled && cdkQuery.data?.pagination && cdkQuery.data.pagination.page !== cdkPage) setCdkPage(cdkQuery.data.pagination.page)
  }, [cdkEnabled, cdkQuery.data, cdkPage])
  useEffect(() => {
    if (riskEnabled && riskQuery.data?.pagination && riskQuery.data.pagination.page !== riskPage) setRiskPage(riskQuery.data.pagination.page)
  }, [riskEnabled, riskQuery.data, riskPage])

  return { records, cdkSearchInput, setCdkSearchInput, cdkPage, setCdkPage, cdkPageSize, setCdkPageSize, cdkPagination,
    cdkLoading: cdkEnabled && cdkQuery.isFetching, cdkLoaded: cdkEnabled && cdkQuery.isFetched,
    riskRecords, riskPage, setRiskPage, riskPageSize, setRiskPageSize, riskPagination, riskLoading: riskEnabled && riskQuery.isFetching,
    cdkFilters, cdkSearch, cdkTypeFilter, setCdkTypeFilter, statusFilter, setStatusFilter, permissionFilter, setPermissionFilter,
    riskFilter, setRiskFilter, generatedFilter, setGeneratedFilter, loadCdkPage: refreshCdkLists, loadRiskPage: refreshCdkLists }
}
