import { Link } from 'react-router-dom'
import { copy } from '../copy/index'


export const SUPPORT_QQ_GROUP_URL = 'http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=Hx_aCfNq_KOuGJ2w0KiRdvzIo33PlkQ6'

const footerLinks = [
  { to: '/pricing', label: copy.public.components_PublicFooter_012 },
  { to: '/faq', label: copy.public.components_PublicFooter_001 },
  { to: '/terms', label: copy.public.components_PublicFooter_002 },
  { to: '/privacy', label: copy.public.components_PublicFooter_003 },
  { to: '/disclaimer', label: copy.public.components_PublicFooter_004 },
]

interface PublicFooterProps {
  className?: string
  variant?: 'landing' | 'tool'
}

export default function PublicFooter({ className = '', variant = 'landing' }: PublicFooterProps) {
  const linkClassName = 'inline-flex min-h-11 items-center text-sm text-ink-secondary underline-offset-4 transition-colors hover:text-ink-primary hover:underline'
  return (
    <footer className={`public-footer ${variant === 'tool' ? 'bg-surface-1/45' : ''} ${className}`} aria-label={copy.public.components_PublicFooter_005}>
      <div className="mx-auto flex max-w-7xl flex-col gap-5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-ink-primary">{copy.public.components_PublicFooter_006}</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{copy.public.components_PublicFooter_007}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-3" aria-label={copy.public.components_PublicFooter_008}>
          <Link className={linkClassName} to="/faq">{copy.public.components_PublicFooter_009}</Link>
          <a
            className={linkClassName}
            href={SUPPORT_QQ_GROUP_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.public.components_PublicFooter_010}</a>
          {footerLinks.filter((link) => link.to !== '/faq').map((link) => (
            <Link key={link.to} className={linkClassName} to={link.to}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}

export function SupportGroupLink({ className = '', children = copy.public.components_PublicFooter_011 }: { className?: string; children?: React.ReactNode }) {
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
