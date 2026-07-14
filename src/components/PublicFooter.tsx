import { Link } from 'react-router-dom'

export const SUPPORT_QQ_GROUP_URL = 'http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=Hx_aCfNq_KOuGJ2w0KiRdvzIo33PlkQ6'

const footerLinks = [
  { to: '/faq', label: '常见问题' },
  { to: '/terms', label: '用户服务协议' },
  { to: '/privacy', label: '隐私政策' },
  { to: '/disclaimer', label: '免责声明' },
]

interface PublicFooterProps {
  className?: string
  variant?: 'landing' | 'tool'
}

export default function PublicFooter({ className = '', variant = 'landing' }: PublicFooterProps) {
  const tool = variant === 'tool'
  const linkClassName = tool
    ? 'tool-nav-link inline-flex items-center px-2 text-sm'
    : 'rounded-sm transition hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-100'
  return (
    <footer className={`border-t px-5 py-8 sm:px-8 lg:px-10 ${tool ? 'border-surface-3 bg-surface-1 text-ink-secondary' : 'border-white/10 text-brand-50/64'} ${className}`} aria-label="网站页脚">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className={`font-medium ${tool ? 'text-ink-primary' : 'text-white/82'}`}>MaaTool 官方</p>
          <p className={`mt-1 text-xs leading-5 ${tool ? 'text-ink-muted' : 'text-brand-50/52'}`}>排班建议仅供参考，请以实际游戏与工具运行结果为准。</p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-3" aria-label="网站信息">
          <Link className={linkClassName} to="/faq">常见问题</Link>
          <a
            className={linkClassName}
            href={SUPPORT_QQ_GROUP_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            加入 QQ 群
          </a>
          {footerLinks.slice(1).map((link) => (
            <Link key={link.to} className={linkClassName} to={link.to}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}

export function SupportGroupLink({ className = '', children = '加入 MaaTool 交流群' }: { className?: string; children?: React.ReactNode }) {
  return (
    <a
      className={className}
      href={SUPPORT_QQ_GROUP_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  )
}
