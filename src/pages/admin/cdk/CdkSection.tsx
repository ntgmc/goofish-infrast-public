import { useState } from 'react'
import type { AdminController } from '../useAdminController'
import { CdkDetailDialog, CdkTable } from './components'
import { CdkRecordDistributionPanel } from '../overview/components'
import { AdminTabs } from '../shared/AdminTabs'
import { MAX_CDK_BATCH_COUNT, cdkProductPermissions, permissionLabels, type GeneratedPermission } from '../contracts'
import { formatDate } from '../shared/helpers'
import { METERED_BILLING_AVAILABLE } from '../../../lib/site-features'
import { copy } from '../../../copy'

const tabs = [{ id: 'records', label: '记录检索' }, { id: 'generate', label: '生成 CDK' }, { id: 'analysis', label: '分布分析' }] as const
export default function CdkSection({ model: c, active }: { model: AdminController; active: boolean }) {
  const [view, setView] = useState<'records' | 'generate' | 'analysis'>('records')
  const [validity, setValidity] = useState('days')
  const [itemCode, setItemCode] = useState('lifetime_profile_voucher')
  return <section className="space-y-5">
    <AdminTabs label="CDK 管理任务" items={tabs} value={view} onChange={setView} />
    <div hidden={view !== 'records'} role="tabpanel" aria-label="记录检索"><CdkTable records={c.visibleRecords} selected={c.selectedCdkHashes} filters={c.cdkFilters}
      search={c.cdkSearchInput} pagination={c.cdkPagination} loading={c.cdkLoading} busyAction={c.busyAction}
      onSearchChange={c.setCdkSearchInput} onPageChange={c.setCdkPage} onPageSizeChange={(size) => { c.setCdkPageSize(size); c.setCdkPage(1) }}
      onFilterChange={(patch) => { if (patch.status) c.setStatusFilter(patch.status); if (patch.cdk_type) c.setCdkTypeFilter(patch.cdk_type);
        if (patch.permission) c.setPermissionFilter(patch.permission); if (patch.risk) c.setRiskFilter(patch.risk); if (patch.generated) c.setGeneratedFilter(patch.generated); c.setCdkPage(1) }}
      onSelect={c.setSelectedCdkHashes} onBulk={c.handleBulkCdk} onPatch={c.patchCdk} onOpenDetail={c.loadCdkDetail} onDelete={c.deleteCdk} /></div>
    <div hidden={view !== 'generate'} role="tabpanel" aria-label="生成 CDK"><form onSubmit={c.handleGenerateCdk} className="tool-panel p-5">
      <h2 className="text-lg font-semibold">生成 CDK</h2><p className="mt-2 text-sm text-ink-muted">选择权益、有效期和数量，生成后可复制或下载。</p>
      <fieldset disabled={c.busyAction === 'generate'} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label><span className="mb-2 block text-sm">CDK 类型</span><select value={c.cdkType} onChange={(e) => c.setCdkType(e.currentTarget.value as 'profile' | 'balance' | 'item')} className="tool-field">
          <option value="profile">档案兑换</option>{METERED_BILLING_AVAILABLE && <option value="balance">余额兑换</option>}<option value="item">道具兑换</option></select></label>
        {c.cdkType === 'profile' ? <><label><span className="mb-2 block text-sm">授权类型</span><select value={c.permission} onChange={(e) => c.setPermission(e.currentTarget.value as GeneratedPermission)} className="tool-field">
          {cdkProductPermissions.map((item) => <option key={item} value={item}>{permissionLabels[item]}</option>)}</select></label>
          <label><span className="mb-2 block text-sm">档案有效期</span><select name="profile_duration" className="tool-field" defaultValue="lifetime">
            <option value="lifetime">终身卡</option><option value="month">月卡（30 天）</option><option value="half_year">90 天版本维护卡（90 天）</option><option value="year">年卡（365 天）</option></select></label></>
          : c.cdkType === 'balance' ? <label><span className="mb-2 block text-sm">积分面额</span><input value={c.balanceAmount} onChange={(e) => c.setBalanceAmount(e.currentTarget.value)} inputMode="decimal" pattern="\d+(\.\d{1,2})?" className="tool-field" required /></label>
            : <><label><span className="mb-2 block text-sm">道具类型</span><select name="item_code" className="tool-field" value={itemCode} onChange={(e) => setItemCode(e.currentTarget.value)}><option value="lifetime_profile_voucher">终身版兑换 CDK</option><option value="limited_profile_voucher">限时 CDK</option></select></label>
              {itemCode === 'limited_profile_voucher' && <><label><span className="mb-2 block text-sm">限时方式</span><select name="item_validity_mode" className="tool-field" value={validity} onChange={(e) => setValidity(e.currentTarget.value)}><option value="days">指定天数</option><option value="date">指定到期日</option></select></label>
              {validity === 'days' && <label><span className="mb-2 block text-sm">有效天数</span><input name="item_validity_days" type="number" min={1} max={3650} step={1} defaultValue={30} className="tool-field" required /></label>}
              {validity === 'date' && <label><span className="mb-2 block text-sm">到期日（北京时间）</span><input name="item_expires_at" type="date" className="tool-field" required /></label>}</>}</>}
        <label><span className="mb-2 block text-sm">生成数量</span><input type="number" min={1} max={MAX_CDK_BATCH_COUNT} step={1} value={c.cdkCount} onChange={(e) => c.setCdkCount(e.currentTarget.value)} className="tool-field" required /></label>
        <label><span className="mb-2 block text-sm">订单备注</span><input value={c.orderNote} maxLength={120} onChange={(e) => c.setOrderNote(e.currentTarget.value)} className="tool-field" placeholder="闲鱼订单号、用户昵称或售后备注" /></label>
      </fieldset><button type="submit" disabled={c.busyAction === 'generate'} className="tool-primary-action mt-5">{c.busyAction === 'generate' ? '生成中…' : '生成 CDK'}</button>
      {c.generatedCodes.length > 0 && <div className="mt-5 border-t border-surface-3 pt-5"><div className="admin-actions"><div><h3 className="font-semibold">已生成 {c.generatedCodes.length} 个 CDK</h3>
        <p className="mt-1 text-xs text-ink-muted">{c.generatedCodes[0].cdk_type === 'balance' ? METERED_BILLING_AVAILABLE ? `余额 ${c.generatedCodes[0].amount} 积分` : copy.admin.retired_cdk
          : c.generatedCodes[0].cdk_type === 'item' ? c.generatedCodes[0].item_name ?? c.generatedCodes[0].item_code : permissionLabels[c.generatedCodes[0].permission!]}</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={c.handleCopyGeneratedCdks} className="tool-secondary-action">复制全部</button><button type="button" onClick={c.handleDownloadGeneratedCdks} className="tool-secondary-action">下载 CSV</button></div></div>
        <ul className="max-h-64 overflow-auto">{c.generatedCodes.map((item) => <li key={item.code} className="flex flex-wrap justify-between gap-2 border-b border-surface-3 py-3"><span className="break-all font-mono text-sm">{item.code}</span><span className="text-xs text-ink-muted">{formatDate(item.created_at)}</span></li>)}</ul>
      </div>}
    </form></div>
    <div hidden={view !== 'analysis'} role="tabpanel" aria-label="分布分析"><CdkRecordDistributionPanel summary={c.cdkOpsSummary} /></div>
    {c.selectedCdkDetail && active && view === 'records' && <CdkDetailDialog detail={c.selectedCdkDetail} busyAction={c.busyAction} onClose={() => c.setSelectedCdkDetail(null)} onPatch={c.patchCdk} onUpdateNote={c.handleUpdateCdkNote} onSetPermission={c.handleSetCdkPermission} />}
  </section>
}
