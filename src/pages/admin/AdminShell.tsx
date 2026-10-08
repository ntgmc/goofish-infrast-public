import type { ReactNode } from 'react'
import { Activity, Bell, Boxes, CreditCard, FileText, Gauge, Gift, Settings2, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { Link } from 'react-router'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import CompactHeaderMenu from '../../components/CompactHeaderMenu'
import { DialogSurfaceProvider } from '../../components/ui/dialog'
import { adminPath } from '../../lib/app-routes'
import { sectionLabels, type AdminCapability, type AdminSection } from './contracts'

const groups: Array<{ label: string; sections: AdminSection[] }> = [
  { label: '运营', sections: ['overview', 'users'] },
  { label: '权益与发放', sections: ['cdk', 'items', 'invitation'] },
  { label: '服务与安全', sections: ['queue', 'risk'] },
  { label: '站点管理', sections: ['features', 'registration', 'announcement', 'content'] },
]
const icons = { overview: Gauge, users: Users, cdk: CreditCard, items: Boxes, invitation: Gift, queue: Activity,
  risk: ShieldCheck, features: Settings2, registration: UserPlus, announcement: Bell, content: FileText }

export function canAccessAdminSection(section: AdminSection, capabilities: AdminCapability[]): boolean {
  if (section === 'overview') return capabilities.includes('usage_view') || capabilities.includes('risk_view')
  if (section === 'risk') return capabilities.includes('risk_view')
  if (section === 'users') return capabilities.includes('user_view')
  if (section === 'queue') return capabilities.includes('optimization_view')
  return capabilities.includes('admin_manage')
}

export default function AdminShell({ section, username, capabilities, syncStatus, onRefresh, refreshing, onLogout, children }: {
  section: AdminSection
  username: string | null
  capabilities: AdminCapability[]
  syncStatus: string
  onRefresh?: () => void
  refreshing: boolean
  onLogout: () => void
  children: ReactNode
}) {
  const visibleGroups = groups.map((group) => ({ ...group, sections: group.sections.filter((item) => canAccessAdminSection(item, capabilities)) }))
    .filter((group) => group.sections.length)
  const canManage = capabilities.includes('admin_manage')
  return <DialogSurfaceProvider value="admin-dialog"><div className="admin-app tool-shell">
    <aside className="admin-sidebar tool-sidebar">
      <Link to={adminPath('overview')} className="admin-brand"><ShieldCheck size={26} aria-hidden="true" /><span><strong>MAA 管理后台</strong><small>管理工作台</small></span></Link>
      <nav aria-label="后台导航">{visibleGroups.map((group) => <div className="admin-nav-group" key={group.label}>
        <p>{group.label}</p>{group.sections.map((item) => {
          const Icon = icons[item]
          return <Link key={item} to={adminPath(item)} className="admin-nav-link" aria-current={section === item ? 'page' : undefined}>
            <Icon size={18} aria-hidden="true" /><span>{sectionLabels[item]}</span>
          </Link>
        })}
      </div>)}</nav>
      <div className="admin-sidebar-bottom"><span>{username}</span>{canManage && <Link to="/admin/setup">管理员账号</Link>}
        <button type="button" onClick={onLogout}>退出登录</button></div>
    </aside>
    <main className="admin-workspace tool-workspace" tabIndex={-1} data-route-focus>
      <header className="admin-topbar tool-header">
        <div className="admin-breadcrumb"><span>管理工作台</span><span aria-hidden="true">/</span><strong>{sectionLabels[section]}</strong></div>
        <div className="admin-mobile-menu"><CompactHeaderMenu ariaLabel="打开栏目菜单" triggerLabel={sectionLabels[section]} align="start"
          metadata={{ title: username ?? '', description: syncStatus }} items={[
            ...visibleGroups.flatMap((group) => group.sections.map((item) => ({ type: 'link' as const, id: item, label: sectionLabels[item], to: adminPath(item), current: section === item }))),
            ...(canManage ? [{ type: 'link' as const, id: 'setup', label: '管理员账号', to: '/admin/setup' }] : []),
            { type: 'button' as const, id: 'logout', label: '退出登录', intent: 'danger' as const, onSelect: onLogout },
          ]} /></div>
        <div className="admin-header-actions"><ThemeSwitcher iconOnly /><span className="admin-header-user">{username}</span></div>
      </header>
      <div className="admin-main">
        <div className="admin-page-heading"><div><h1>{sectionLabels[section]}</h1><p role="status">{syncStatus}</p></div>
          {onRefresh && <button type="button" className="tool-secondary-action" disabled={refreshing} onClick={onRefresh}>{refreshing ? '刷新中…' : '刷新当前页'}</button>}</div>
        {children}
      </div>
    </main>
  </div></DialogSurfaceProvider>
}
