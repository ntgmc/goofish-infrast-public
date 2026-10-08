import { useState } from 'react'
import { AdminTabs } from '../shared/AdminTabs'
import type { AdminController } from '../useAdminController'
import BehaviorRiskPanel from './BehaviorRiskPanel'
import { CdkDetailDialog, RiskSettingsPanel, RiskTable } from '../cdk/components'
import { RiskConsoleSummary, RiskReasonPanel, RiskTrendPanel } from '../overview/components'

const tabs = [{ id: 'cases', label: '行为案件' }, { id: 'cdk', label: 'CDK 风险' }, { id: 'rules', label: '规则设置' }] as const
export default function RiskSection({ model: c, active }: { model: AdminController; active: boolean }) {
  const [view, setView] = useState<'cases' | 'cdk' | 'rules'>('cases')
  const [visited, setVisited] = useState(['cases'])
  return <section className="space-y-5"><AdminTabs label="风控任务" items={tabs} value={view} onChange={(next) => { setView(next); setVisited((current) => current.includes(next) ? current : [...current, next]) }} />
    {view !== 'cases' && <div className="admin-actions"><button type="button" className="tool-secondary-action" disabled={c.loading || c.riskLoading} onClick={() => void c.loadDashboard()}>{c.loading || c.riskLoading ? '刷新中…' : '刷新风控数据'}</button></div>}
    <div hidden={view !== 'cases'} role="tabpanel" aria-label="行为案件"><BehaviorRiskPanel active={active && view === 'cases'} /></div>
    <div hidden={view !== 'cdk'} role="tabpanel" aria-label="CDK 风险" className="space-y-5">
      <RiskConsoleSummary summary={c.cdkOpsSummary} /><RiskTable canManage={c.adminCapabilities.includes('admin_manage')} records={c.riskRecords} pagination={c.riskPagination} loading={c.riskLoading} busyAction={c.busyAction}
        onPageChange={c.setRiskPage} onPageSizeChange={(size) => { c.setRiskPageSize(size); c.setRiskPage(1) }} onPatch={c.patchCdk} onOpenDetail={c.loadCdkDetail} />
      <div className="grid gap-5 xl:grid-cols-2"><RiskTrendPanel days={c.cdkOpsSummary.risk_trend} /><RiskReasonPanel reasons={c.cdkOpsSummary.risk_reasons} onOpenDetail={c.loadCdkDetail} /></div>
    </div>
    <div hidden={view !== 'rules'} role="tabpanel" aria-label="规则设置">{visited.includes('rules') && <RiskSettingsPanel settings={c.riskSettings} saving={c.busyAction === 'risk-settings'} onChange={c.handleSaveRiskSettings} />}</div>
    {c.selectedCdkDetail && active && view === 'cdk' && <CdkDetailDialog canManage={c.adminCapabilities.includes('admin_manage')} detail={c.selectedCdkDetail} busyAction={c.busyAction} onClose={() => c.setSelectedCdkDetail(null)} onPatch={c.patchCdk} onUpdateNote={c.handleUpdateCdkNote} onSetPermission={c.handleSetCdkPermission} />}
  </section>
}
