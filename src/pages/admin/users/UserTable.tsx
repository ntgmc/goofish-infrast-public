import type { AdminUserFilters } from '../../../lib/admin-user-filters'
import { DEFAULT_ADMIN_USER_FILTERS } from '../../../lib/admin-user-filters'
import type { AdminCapability, AppUserSummary, PaginationMeta } from '../contracts'
import { appUserStatusLabels, cdkProductPermissions, permissionLabels } from '../contracts'
import { UserStatusPill, SmallButton, formatAdminProfileAccess, formatDate } from '../shared/helpers'
import { PaginationControls } from '../shared/PaginationControls'

interface Props {
  users: AppUserSummary[]
  selected: string[]
  filters: AdminUserFilters
  search: string
  pagination: PaginationMeta
  loading: boolean
  busyAction: string | null
  capabilities: AdminCapability[]
  onFilters: (filters: AdminUserFilters) => void
  onSearch: (value: string) => void
  onSelect: (ids: string[]) => void
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  onCopy: (field: 'id' | 'email') => Promise<void>
  onExport: () => void
  onBulk: (action: 'freeze' | 'unfreeze') => Promise<void>
  onDetail: (user: AppUserSummary) => Promise<void>
  onFreeze: (user: AppUserSummary) => Promise<void>
  onUnfreeze: (user: AppUserSummary) => Promise<void>
}

export function UserTable(props: Props) {
  const { users, filters, selected, loading, busyAction, capabilities } = props
  const busy = loading || Boolean(busyAction)
  const selectedUsers = users.filter((user) => selected.includes(user.id))
  const allSelected = users.length > 0 && selectedUsers.length === users.length
  const canManage = capabilities.includes('user_manage')
  const filter = (key: keyof AdminUserFilters, value: string) => props.onFilters({ ...filters, [key]: value })
  return <section className="tool-panel overflow-hidden">
    <div className="border-b border-surface-3 p-4">
      <h2 className="text-lg font-semibold text-ink-primary">注册用户</h2>
      <fieldset disabled={Boolean(busyAction)} className="admin-user-filters mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <label className="col-span-2 xl:col-span-4">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">搜索</span>
          <input type="search" value={props.search} onChange={(event) => props.onSearch(event.currentTarget.value)} placeholder="搜索邮箱、用户 ID、档案或订单标识" className="tool-field" />
        </label>
        <label><span className="mb-1.5 block text-xs font-medium text-ink-muted">用户状态</span>
          <select className="tool-field" value={filters.status} onChange={(event) => filter('status', event.currentTarget.value)}>
            <option value="all">全部状态</option>
            {Object.entries(appUserStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label><span className="mb-1.5 block text-xs font-medium text-ink-muted">持有有效卡等级</span>
          <select className="tool-field" value={filters.permission} onChange={(event) => filter('permission', event.currentTarget.value)}>
            <option value="all">全部等级</option>
            {cdkProductPermissions.map((permission) => <option key={permission} value={permission}>{permissionLabels[permission]}</option>)}
          </select>
        </label>
        <details className="self-end"><summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-secondary">高级筛选</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label><span className="mb-1.5 block text-xs font-medium text-ink-muted">档案类型</span>
          <select className="tool-field" value={filters.profile_kind} onChange={(event) => filter('profile_kind', event.currentTarget.value)}>
            <option value="all">全部类型</option><option value="cdk">卡授权档案</option><option value="free_preview">免费预览</option>
            <option value="metered_personal">个人按次</option><option value="metered_commercial">商用按次</option><option value="depot_value">仓库估值</option><option value="none">无档案</option>
          </select>
        </label>
        <label><span className="mb-1.5 block text-xs font-medium text-ink-muted">邮箱验证</span>
          <select className="tool-field" value={filters.email_verified} onChange={(event) => filter('email_verified', event.currentTarget.value)}>
            <option value="all">全部</option><option value="yes">已验证</option><option value="no">未验证</option>
          </select>
        </label>
        {([
          ['registered_from', '注册开始日期'], ['registered_to', '注册结束日期'],
          ['last_seen_from', '上线开始日期'], ['last_seen_to', '上线结束日期'],
        ] as const).map(([key, label]) => <label key={key}><span className="mb-1.5 block text-xs font-medium text-ink-muted">{label}（北京时间）</span>
          <input className="tool-field" type="date" value={filters[key]} disabled={key.startsWith('last_seen') && filters.activity === 'never'} onChange={(event) => filter(key, event.currentTarget.value)} />
        </label>)}
        <label><span className="mb-1.5 block text-xs font-medium text-ink-muted">上线记录</span>
          <select className="tool-field" value={filters.activity} onChange={(event) => props.onFilters({
            ...filters, activity: event.currentTarget.value as AdminUserFilters['activity'],
            ...(event.currentTarget.value === 'never' ? { last_seen_from: '', last_seen_to: '' } : {}),
          })}>
            <option value="all">全部</option><option value="seen">有上线记录</option><option value="never">无上线记录</option>
          </select>
        </label>
        <label><span className="mb-1.5 block text-xs font-medium text-ink-muted">排序</span>
          <select className="tool-field" value={filters.sort} onChange={(event) => filter('sort', event.currentTarget.value)}>
            <option value="registered_desc">注册时间：新到旧</option><option value="registered_asc">注册时间：旧到新</option>
            <option value="last_seen_desc">最近上线：新到旧</option><option value="last_seen_asc">最近上线：旧到新</option>
          </select>
        </label>
        </div><p className="mt-3 text-xs text-ink-muted">卡等级筛选匹配仍有效且未冻结、未归档的卡授权档案。最近上线约每 10 分钟更新；历史会话已清理的用户可能没有记录。</p></details>
        <button type="button" className="tool-secondary-action self-end text-sm" onClick={() => { props.onSearch(''); props.onFilters(DEFAULT_ADMIN_USER_FILTERS) }}>重置筛选</button>
      </fieldset>
    </div>
    <div hidden={!selectedUsers.length} className="flex flex-wrap items-center gap-2 border-b border-surface-3 p-4">
      <span className="text-sm text-ink-secondary">当前页已选 {selectedUsers.length} 个用户</span>
      <button type="button" className="tool-secondary-action text-sm" disabled={busy || !selectedUsers.length} onClick={() => void props.onCopy('id')}>复制用户 ID</button>
      <button type="button" className="tool-secondary-action text-sm" disabled={busy || !selectedUsers.length} onClick={() => void props.onCopy('email')}>复制邮箱</button>
      <button type="button" className="tool-secondary-action text-sm" disabled={busy || !selectedUsers.length} onClick={props.onExport}>导出所选 CSV</button>
      {canManage && <>
        <button type="button" className="tool-danger-action text-sm" disabled={busy || !selectedUsers.some((user) => user.status === 'active')} onClick={() => void props.onBulk('freeze')}>批量冻结</button>
        <button type="button" className="tool-secondary-action text-sm" disabled={busy || !selectedUsers.some((user) => user.status === 'frozen')} onClick={() => void props.onBulk('unfreeze')}>批量解冻</button>
      </>}
      <button type="button" className="tool-secondary-action text-sm" disabled={busy || !selected.length} onClick={() => props.onSelect([])}>取消选择</button>
    </div>
    <div className="overflow-x-auto" aria-busy={loading}>
      {loading && <div className="border-b border-surface-3 px-4 py-2 text-sm text-ink-muted" role="status">正在加载…</div>}
      <table className="w-full min-w-[56rem] text-left text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted"><tr>
          <th className="px-4 py-3"><input className="h-4 w-4 accent-brand-500" type="checkbox" aria-label="选择当前页全部用户" disabled={busy} checked={allSelected} onChange={(event) => props.onSelect(event.currentTarget.checked ? users.map((user) => user.id) : [])} /></th>
          <th className="px-4 py-3">邮箱／用户 ID</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">权限</th><th className="px-4 py-3">档案</th><th className="px-4 py-3">时间</th><th className="px-4 py-3">操作</th>
        </tr></thead>
        <tbody className="divide-y divide-surface-3">
          {!users.length ? <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-muted">没有匹配的用户，请调整筛选条件。</td></tr> : users.map((user) => <tr key={user.id} className="hover:bg-surface-2/50">
            <td className="px-4 py-4"><input className="h-4 w-4 accent-brand-500" type="checkbox" aria-label={`选择用户 ${user.email}`} disabled={busy} checked={selected.includes(user.id)} onChange={(event) => props.onSelect(event.currentTarget.checked ? [...selected, user.id] : selected.filter((id) => id !== user.id))} /></td>
            <td className="px-4 py-4 font-medium text-ink-primary">{user.email}<div className="mt-1 break-all font-mono text-xs text-ink-muted">{user.id}</div></td>
            <td className="px-4 py-4"><UserStatusPill status={user.status} emailVerifiedAt={user.email_verified_at} /></td>
            <td className="px-4 py-4 text-ink-secondary">{formatAdminProfileAccess(user.profile_access)}</td>
            <td className="px-4 py-4 text-ink-secondary">{user.profile_count}</td>
            <td className="whitespace-nowrap px-4 py-4 text-xs text-ink-muted"><div>注册 {formatDate(user.created_at)}</div><div className="mt-1">上线 {user.last_seen_at ? formatDate(user.last_seen_at) : '暂无记录'}</div></td>
            <td className="px-4 py-4"><div className="flex flex-wrap gap-2">
              {capabilities.includes('sensitive_data_view') && <SmallButton onClick={() => void props.onDetail(user)} loading={busy}>详情</SmallButton>}
              {canManage && user.status === 'active' && <SmallButton onClick={() => void props.onFreeze(user)} loading={busy}>冻结</SmallButton>}
              {canManage && user.status === 'frozen' && <SmallButton onClick={() => void props.onUnfreeze(user)} loading={busy} tone="success">解冻</SmallButton>}
            </div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <PaginationControls pagination={props.pagination} loading={busy} onPageChange={props.onPage} onPageSizeChange={props.onPageSize} />
  </section>
}
