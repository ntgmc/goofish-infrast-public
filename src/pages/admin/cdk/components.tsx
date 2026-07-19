import { GeneratedPermission, StatusFilter, PermissionFilter, BinaryFilter, CdkTableFilters, AdminCdkRecord, AdminCdkDetail, RiskControlSettings, RiskControlSettingsPatch, PaginationMeta, permissionLabels, statusLabels, cdkProductPermissions } from '../contracts'
import { AdminDetailDialog } from '../shared/AdminDetailDialog'
import { DetailItem, StatusPill, SmallButton, formatDate, getNextProductPermission, formatNullableNumber, formatRiskDetail } from '../shared/helpers'
import { AnimatedValue, RevealItem } from '../../../components/MotionPrimitives'
import { PaginationControls } from '../shared/PaginationControls'

export function CdkTable({ records, selected, filters, search, pagination, loading, busyAction, onSearchChange, onPageChange, onPageSizeChange, onFilterChange, onSelect, onBulkRevoke, onPatch, onOpenDetail, onDelete }: {
  records: AdminCdkRecord[];
  selected: string[];
  filters: CdkTableFilters;
  search: string;
  pagination: PaginationMeta;
  loading: boolean;
  busyAction: string | null;
  onFilterChange: (patch: Partial<CdkTableFilters>) => void;
  onSearchChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSelect: (hashes: string[]) => void;
  onBulkRevoke: () => void;
  onPatch: (record: AdminCdkRecord, action: string, nextPermission?: GeneratedPermission, extraBody?: Record<string, unknown>) => Promise<void>;
  onOpenDetail: (record: AdminCdkRecord) => Promise<void>;
  onDelete: (record: AdminCdkRecord) => Promise<void>;
}) {
  const allSelected = records.length > 0 && records.every((record) => selected.includes(record.code_hash))
  return (
    <section className="tool-panel">
      <div className="tool-panel-header flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="CDK 状态筛选">
          {(['all', 'unused', 'used', 'frozen', 'revoked'] as StatusFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={filters.status === item}
              onClick={() => onFilterChange({ status: item })}
              className={`tool-secondary-action min-h-10 px-3 text-sm ${filters.status === item ? 'tool-option-selected' : ''}`}
            >
              {item === 'all' ? '全部' : statusLabels[item]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onBulkRevoke}
          disabled={selected.length === 0}
          aria-label={selected.length > 0 ? `批量撤销 ${selected.length} 个已选 CDK` : '请先选择要撤销的 CDK'}
          className="tool-danger-action text-sm"
        >
          批量撤销{selected.length > 0 ? ` (${selected.length})` : ''}
        </button>
      </div>
      <div className="grid gap-3 border-b border-surface-3 p-4 md:grid-cols-4">
        <label className="block md:col-span-4">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">搜索</span>
          <div className="flex gap-2">
            <input type="search" value={search} onChange={(event) => onSearchChange(event.currentTarget.value)} placeholder="搜索 CDK 标识、订单标识或备注" className="tool-field" />
            {search && <button type="button" onClick={() => onSearchChange('')} className="tool-secondary-action px-3 text-sm">清空</button>}
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">权限</span>
          <select value={filters.permission} onChange={(event) => onFilterChange({ permission: event.currentTarget.value as PermissionFilter })} className="tool-field">
            <option value="all">全部权限</option>
            {cdkProductPermissions.map((item) => <option key={item} value={item}>{permissionLabels[item]}</option>)}
          </select>
        </label>
        <BinaryFilterSelect label="风险事件" value={filters.risk} onChange={(value) => onFilterChange({ risk: value })} />
        <BinaryFilterSelect label="生成过排班" value={filters.generated} onChange={(value) => onFilterChange({ generated: value })} />
      </div>
        <div className="overflow-x-auto" aria-busy={loading}>
          {loading && <div className="border-b border-surface-3 px-4 py-2 text-sm text-ink-muted" role="status">正在加载…</div>}
          <table className="w-full min-w-[1120px] table-fixed text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="w-12 px-4 py-3"><input className="h-4 w-4 accent-brand-500" type="checkbox" aria-label="选择当前筛选中的全部 CDK" checked={allSelected} onChange={(event) => onSelect(event.currentTarget.checked ? records.map((record) => record.code_hash) : [])} /></th>
                <th className="w-36 px-4 py-3">CDK</th>
                <th className="w-32 px-4 py-3">状态</th>
                <th className="w-56 px-4 py-3">数据</th>
                <th className="w-44 px-4 py-3">时间</th>
                <th className="w-48 px-4 py-3">备注</th>
                <th className="w-64 px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
            {records.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-muted">{search ? '没有匹配的 CDK，请调整搜索条件。' : '当前筛选没有记录。'}</td></tr>
            ) : records.map((record) => {
              const nextPermission = getNextProductPermission(record.permission)
              return (
                <tr key={record.code_hash} className="hover:bg-surface-2/50">
                    <td className="px-4 py-4 align-top"><input className="h-4 w-4 accent-brand-500" type="checkbox" aria-label={`选择 CDK ${record.cdk_id}`} checked={selected.includes(record.code_hash)} onChange={(event) => onSelect(event.currentTarget.checked ? [...selected, record.code_hash] : selected.filter((hash) => hash !== record.code_hash))} /></td>
                    <td className="px-4 py-4 align-top font-mono text-ink-primary">{record.cdk_id}</td>
                    <td className="px-4 py-4 align-top"><StatusPill status={record.status} /><div className="mt-1 text-xs text-ink-muted">{permissionLabels[record.permission]}</div></td>
                    <td className="px-4 py-4 align-top text-ink-secondary">
                      <div>{record.operator_count ?? '-'} 干员 / 生成 {record.schedule_generate_count ?? 0}</div>
                      <div className="mt-1 text-xs text-ink-muted">风险 {record.risk_event_count ?? 0}</div>
                    </td>
                    <td className="px-4 py-4 align-top text-xs text-ink-secondary"><div>创建 {formatDate(record.created_at)}</div><div className="mt-1">使用 {formatDate(record.used_at)}</div></td>
                    <td className="px-4 py-4 align-top text-ink-secondary"><div className="truncate" title={record.order_note || undefined}>{record.order_note || '-'}</div></td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex min-w-0 flex-wrap gap-2">
                      <SmallButton onClick={() => void onOpenDetail(record)} loading={busyAction === `cdk-detail:${record.code_hash}`}>详情</SmallButton>
                      {nextPermission && record.status !== 'frozen' && record.status !== 'revoked' && <SmallButton onClick={() => onPatch(record, 'upgrade', nextPermission)} loading={busyAction === `upgrade:${record.code_hash}`}>升级</SmallButton>}
                      {record.status === 'frozen' && <SmallButton onClick={() => onPatch(record, 'unfreeze')} loading={busyAction === `unfreeze:${record.code_hash}`} tone="success">解冻</SmallButton>}
                      {(record.status === 'used' || record.status === 'frozen') && <SmallButton onClick={() => onPatch(record, 'revoke')} loading={busyAction === `revoke:${record.code_hash}`} tone="danger">撤销</SmallButton>}
                      {record.status === 'unused' && <SmallButton onClick={() => onDelete(record)} loading={busyAction === `delete:${record.code_hash}`} tone="danger">删除</SmallButton>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <PaginationControls pagination={pagination} loading={loading} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </section>
  )
}

function BinaryFilterSelect({ label, value, onChange }: { label: string; value: BinaryFilter; onChange: (value: BinaryFilter) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-muted">{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value as BinaryFilter)} className="tool-field">
        <option value="all">全部</option>
        <option value="yes">是</option>
        <option value="no">否</option>
      </select>
    </label>
  )
}

interface CdkDetailPanelProps {
  detail: AdminCdkDetail;
  busyAction: string | null;
  onClose: () => void;
  onPatch: (record: AdminCdkRecord, action: string, nextPermission?: GeneratedPermission, extraBody?: Record<string, unknown>) => Promise<void>;
  onUpdateNote: (record: AdminCdkDetail) => Promise<void>;
  onSetPermission: (record: AdminCdkDetail) => Promise<void>;
}

export function CdkDetailDialog(props: CdkDetailPanelProps) {
  return (
    <AdminDetailDialog labelledBy="admin-cdk-detail-title" onClose={props.onClose}>
      <CdkDetailPanel {...props} />
    </AdminDetailDialog>
  )
}

function CdkDetailPanel({
  detail,
  busyAction,
  onClose,
  onPatch,
  onUpdateNote,
  onSetPermission,
}: CdkDetailPanelProps) {
  const nextPermission = getNextProductPermission(detail.permission)
  const runReviewedAction = (action: 'accept_operator_baseline_and_unfreeze', prompt: string) => {
    const reason = window.prompt(prompt)
    if (!reason?.trim()) return
    void onPatch(detail, action, undefined, { reason: reason.trim() })
  }
  return (
    <section className="tool-panel overflow-hidden">
      <div className="tool-panel-header flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="admin-cdk-detail-title" className="font-mono text-base font-semibold text-ink-primary">{detail.cdk_id}</h2>
            <StatusPill status={detail.status} />
            <span className="tool-status tool-status--current">{permissionLabels[detail.permission]}</span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">订单备注：{detail.order_note || '-'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={() => void onUpdateNote(detail)} loading={busyAction === `update_note:${detail.code_hash}`}>改备注</SmallButton>
          {detail.status !== 'revoked' && <SmallButton onClick={() => void onSetPermission(detail)} loading={busyAction === `set_permission:${detail.code_hash}`}>改授权</SmallButton>}
          {nextPermission && detail.status !== 'frozen' && detail.status !== 'revoked' && <SmallButton onClick={() => void onPatch(detail, 'upgrade', nextPermission)} loading={busyAction === `upgrade:${detail.code_hash}`}>升级</SmallButton>}
          {detail.status === 'frozen' && <SmallButton onClick={() => void onPatch(detail, 'unfreeze')} loading={busyAction === `unfreeze:${detail.code_hash}`} tone="success">解冻</SmallButton>}
          {(detail.status === 'used' || detail.status === 'frozen') && <SmallButton onClick={() => runReviewedAction('accept_operator_baseline_and_unfreeze', '请输入干员数据误拦截核验备注。该操作会接受最新快照为新基线并解冻。')} loading={busyAction === `accept_operator_baseline_and_unfreeze:${detail.code_hash}`} tone="success">接受干员基线</SmallButton>}
          {(detail.status === 'used' || detail.status === 'frozen') && <SmallButton onClick={() => void onPatch(detail, 'revoke')} loading={busyAction === `revoke:${detail.code_hash}`} tone="danger">撤销</SmallButton>}
          <SmallButton onClick={onClose} autoFocus>关闭</SmallButton>
        </div>
      </div>

      <div className="grid gap-5 p-4 xl:grid-cols-[1fr_1fr]">
        <section className="tool-inset p-4">
          <h3 className="text-sm font-semibold text-ink-primary">授权摘要</h3>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <DetailItem label="订单标识" value={detail.license_order_hash || '-'} />
            <DetailItem label="工作区干员" value={formatNullableNumber(detail.operator_count)} />
            <DetailItem label="初始干员数" value={formatNullableNumber(detail.baseline_operator_count)} />
            <DetailItem label="最近干员数" value={formatNullableNumber(detail.latest_operator_count)} />
            <DetailItem label="排班生成" value={String(detail.schedule_generate_count ?? 0)} />
            <DetailItem label="配置摘要" value={detail.config_desc || '-'} />
            <DetailItem label="创建时间" value={formatDate(detail.created_at)} />
            <DetailItem label="使用时间" value={formatDate(detail.used_at)} />
            <DetailItem label="冻结时间" value={formatDate(detail.frozen_at ?? null)} />
            <DetailItem label="撤销时间" value={formatDate(detail.revoked_at)} />
          </dl>
        </section>

        <section className="tool-inset p-4">
          <h3 className="text-sm font-semibold text-ink-primary">账号关联</h3>
          {detail.linked_account && (
            <p className="tool-inset mt-4 break-all px-3 py-2 text-xs text-ink-secondary">
              关联用户：{detail.linked_account.account_id} / 档案 {detail.linked_account.profile_id}
            </p>
          )}
        </section>

        <section className="tool-inset p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink-primary">风控事件</h3>
            <span className="text-xs text-ink-muted">{detail.risk_events?.length ?? 0} 条</span>
          </div>
          <div className="mt-4 space-y-3">
            {(detail.risk_events ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">暂无风控事件。</p>
            ) : (detail.risk_events ?? []).slice().reverse().slice(0, 8).map((event, index) => (
              <article key={`${event.at}-${index}`} className="tool-inset px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-primary">{event.type}</span>
                  <span className="text-xs text-ink-muted">{formatDate(event.at)}</span>
                </div>
                <p className="mt-1 text-ink-secondary">{event.reason}</p>
                {event.detail && <p className="mt-1 break-all text-xs text-ink-muted">{formatRiskDetail(event.detail)}</p>}
              </article>
            ))}
          </div>
        </section>

      </div>
    </section>
  )
}

export function RiskSettingsPanel({
  settings,
  saving,
  onChange,
}: {
  settings: RiskControlSettings;
  saving: boolean;
  onChange: (patch: RiskControlSettingsPatch) => Promise<void>;
}) {
  return (
    <section className="tool-panel">
      <div className="tool-panel-header flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-base font-semibold text-ink-primary">风控开关</h2>
          <p className="mt-1 text-sm text-ink-muted">控制账号档案的干员数据异常检测。</p>
        </div>
        <span className="text-xs text-ink-muted" role="status" aria-live="polite">{saving ? '保存中...' : `更新 ${formatDate(settings.updated_at)}`}</span>
      </div>
      <div className="grid gap-3 p-4">
        <RiskToggle
          label="干员数据风控"
          description="校验干员消失、练度回退和拥有数异常下降。"
          checked={settings.operator_data_risk_enabled}
          disabled={saving}
          onChange={(checked) => onChange({ operator_data_risk_enabled: checked })}
        />
      </div>
    </section>
  )
}

function RiskToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => Promise<void>;
}) {
  return (
    <label className={`tool-inset flex min-h-28 items-start justify-between gap-4 p-4 transition-colors duration-150 focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:ring-offset-2 focus-within:ring-offset-surface-1 ${checked ? 'border-brand-500/50 bg-brand-500/10' : ''} ${disabled ? 'opacity-70' : 'cursor-pointer hover:border-brand-400/60'}`}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-primary">{label}</span>
        <span className="mt-2 block text-sm leading-6 text-ink-secondary">{description}</span>
        <span className={`tool-status mt-3 ${checked ? 'tool-status--success' : ''}`}>{checked ? '已启用' : '已关闭'}</span>
      </span>
      <span className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors duration-150 ${checked ? 'bg-brand-600' : 'bg-surface-4'}`}>
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => void onChange(event.currentTarget.checked)}
        />
        <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
    </label>
  )
}

export function RiskTable({ records, pagination, loading, busyAction, onPageChange, onPageSizeChange, onPatch, onOpenDetail }: { records: AdminCdkRecord[]; pagination: PaginationMeta; loading: boolean; busyAction: string | null; onPageChange: (page: number) => void; onPageSizeChange: (pageSize: number) => void; onPatch: (record: AdminCdkRecord, action: string) => Promise<void>; onOpenDetail: (record: AdminCdkRecord) => Promise<void> }) {
  return (
    <section className="tool-panel">
      <div className="tool-panel-header p-4">
        <h2 className="text-base font-semibold text-ink-primary">风险记录</h2>
      </div>
      <div className="divide-y divide-surface-3" aria-busy={loading}>
        {loading && <div className="p-3 text-sm text-ink-muted" role="status">正在加载…</div>}
        {records.length === 0 ? <div className="p-8 text-center text-sm text-ink-muted">暂无风险记录。</div> : records.map((record) => (
          <div key={record.code_hash} className="grid gap-3 p-4 lg:grid-cols-[180px_1fr_auto] lg:items-center">
            <div><div className="font-mono text-sm text-ink-primary">{record.cdk_id}</div><StatusPill status={record.status} /></div>
            <div className="text-sm text-ink-secondary">
              <div>{record.freeze_reason || record.latest_risk_event?.reason || '记录了风控事件'}</div>
              <div className="mt-1 text-xs text-ink-muted">风险 {record.risk_event_count ?? 0} / 冻结 {formatDate(record.frozen_at ?? null)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <SmallButton onClick={() => void onOpenDetail(record)} loading={busyAction === `cdk-detail:${record.code_hash}`}>详情</SmallButton>
              {record.status === 'frozen' && <SmallButton onClick={() => onPatch(record, 'unfreeze')} loading={busyAction === `unfreeze:${record.code_hash}`} tone="success">解冻</SmallButton>}
            </div>
          </div>
        ))}
      </div>
      <PaginationControls pagination={pagination} loading={loading} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </section>
  )
}

export function Metric({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'warning' }) {
return <RevealItem className={`tool-inset p-4 ${tone === 'warning' ? 'border-warning/30 bg-warning/10' : ''}`}>
<div className="text-2xl font-semibold tabular-nums text-ink-primary"><AnimatedValue value={String(value)} /></div>
<div className="mt-1 text-sm text-ink-muted">{label}</div>
</RevealItem>
}
