import { adminApiJson } from '../../../lib/admin-api-client'
import type { AdminCdkRecord } from '../contracts'

interface BulkRevokeOptions {
  records: AdminCdkRecord[]
  selectedDetailHash: string | null
  setBusyAction: (value: string | null) => void
  setNotice: (value: string | null) => void
  setError: (value: string | null) => void
  setSelectedHashes: (value: string[]) => void
  clearSelectedDetail: () => void
  refresh: () => Promise<void>
}

export async function revokeSelectedCdks(options: BulkRevokeOptions): Promise<void> {
  const targets = options.records.filter((record) => record.status === 'used' || record.status === 'frozen')
  if (targets.length === 0 || !window.confirm(`确认撤销 ${targets.length} 个授权？`)) return
  options.setBusyAction('cdk-bulk-revoke')
  options.setNotice(null)
  options.setError(null)
  try {
    const data = await adminApiJson<{
      succeeded: number
      failed: number
      results: Array<{ code_hash: string; ok: boolean; error?: string }>
    }>('/api/admin/cdk', {
      method: 'PATCH',
      json: { action: 'revoke', code_hashes: targets.map((record) => record.code_hash) },
      fallbackMessage: '批量撤销失败',
    })
    const failedItems = data.results.filter((result) => !result.ok)
    options.setNotice(data.succeeded > 0 ? `已撤销 ${data.succeeded} 个授权。` : null)
    options.setError(failedItems.length > 0
      ? `${data.failed} 个授权撤销失败：${failedItems.map((item) => item.error || item.code_hash.slice(0, 12)).join('；')}`
      : null)
    if (options.selectedDetailHash && targets.some((record) => record.code_hash === options.selectedDetailHash)) {
      options.clearSelectedDetail()
    }
    options.setSelectedHashes(failedItems.map((item) => item.code_hash))
    await options.refresh()
  } catch (caught) {
    options.setError((caught as Error).message)
  } finally {
    options.setBusyAction(null)
  }
}
