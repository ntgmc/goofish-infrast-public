import { adminApiJson } from '../../../lib/admin-api-client'
import type { AdminCdkRecord, GeneratedPermission } from '../contracts'
import { getPermissionRank } from '../../../lib/product-catalog'

export type BulkCdkAction = 'revoke' | 'delete' | 'upgrade' | 'unfreeze' | 'update_note'

interface BulkCdkOptions {
  records: AdminCdkRecord[]
  action: BulkCdkAction
  permission?: GeneratedPermission
  orderNote?: string
  selectedDetailHash: string | null
  setBusyAction: (value: string | null) => void
  setNotice: (value: string | null) => void
  setError: (value: string | null) => void
  setSelectedHashes: (value: string[]) => void
  clearSelectedDetail: () => void
  refresh: () => Promise<void>
}

export async function mutateSelectedCdks(options: BulkCdkOptions): Promise<void> {
  const { action } = options
  if (action === 'upgrade' && !options.permission) {
    options.setError('请选择升级目标等级。')
    return
  }
  const targets = options.records.filter((record) => {
    if (action === 'delete') return record.status === 'unused'
    if (action === 'revoke') return record.status === 'used' || record.status === 'frozen'
    if (action === 'unfreeze') return record.cdk_type === 'profile' && record.status === 'frozen'
    if (action === 'upgrade') return record.cdk_type === 'profile'
      && (record.status === 'unused' || record.status === 'used')
      && getPermissionRank(options.permission) > getPermissionRank(record.permission)
    return record.status !== 'revoked' && record.status !== 'claiming'
  })
  const label = { revoke: '撤销授权', delete: '删除未使用 CDK', upgrade: '升级授权', unfreeze: '解冻授权', update_note: '修改备注' }[action]
  const skipped = options.records.length - targets.length
  if (!targets.length) {
    options.setError('所选 CDK 均不适用于该操作，请调整选择。')
    return
  }
  if (!window.confirm(`确认${label}，共 ${targets.length} 个 CDK？${skipped ? `另有 ${skipped} 个不适用的 CDK 将跳过。` : ''}${action === 'delete' ? '删除后无法恢复。' : ''}`)) return
  options.setBusyAction(`cdk-bulk-${action}`)
  options.setNotice(null)
  options.setError(null)
  try {
    const data = await adminApiJson<{
      succeeded: number
      failed: number
      results: Array<{ code_hash: string; ok: boolean; error?: string }>
    }>('/api/admin/cdk', {
      method: action === 'delete' ? 'DELETE' : 'PATCH',
      json: {
        ...(action !== 'delete' ? { action } : {}),
        code_hashes: targets.map((record) => record.code_hash),
        ...(action === 'upgrade' ? { permission: options.permission } : {}),
        ...(action === 'update_note' ? { order_note: options.orderNote ?? '' } : {}),
      },
      fallbackMessage: `批量${label}失败`,
    })
    const failedItems = data.results.filter((result) => !result.ok)
    options.setNotice(`${label}成功 ${data.succeeded} 个，跳过 ${skipped} 个。`)
    if (options.selectedDetailHash && targets.some((record) => record.code_hash === options.selectedDetailHash)) {
      options.clearSelectedDetail()
    }
    options.setSelectedHashes(failedItems.map((item) => item.code_hash))
    await options.refresh()
    if (failedItems.length > 0) {
      options.setError(`${data.failed} 个 CDK 操作失败：${failedItems.map((item) => `${item.code_hash.slice(0, 12)}：${item.error ?? '操作失败'}`).join('；')}`)
    }
  } catch (caught) {
    options.setError((caught as Error).message)
  } finally {
    options.setBusyAction(null)
  }
}
