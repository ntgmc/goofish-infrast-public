import { Link } from 'react-router'
import { copy } from '../copy/index'
import { DEFAULT_PUBLIC_CONTENT_SETTINGS } from '../lib/public-content'
import { usePublicContent } from '../lib/public-content-context'


export const SUPPORT_QQ_GROUP_URL = DEFAULT_PUBLIC_CONTENT_SETTINGS.qq_group.join_url

const footerLinks = [
  { to: '/pricing', label: copy.public.components_PublicFooter_012 },
  { to: '/faq', label: copy.public.components_PublicFooter_001 },
  { to: '/changelog', label: copy.public.components_PublicFooter_014 },
  { to: '/thanks', label: copy.public.components_PublicFooter_013 },
  { to: '/terms', label: copy.public.components_PublicFooter_002 },
  { to: '/privacy', label: copy.public.components_PublicFooter_003 },
  { to: '/disclaimer', label: copy.public.components_PublicFooter_004 },
]

interface PublicFooterProps {
  className?: string
  variant?: 'landing' | 'tool'
}

export default function PublicFooter({ className = '', variant = 'landing' }: PublicFooterProps) {
  const { content } = usePublicContent()
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
            href={content.qq_group.join_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {content.qq_group.link_label} · {content.qq_group.number}</a>
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

export function SupportGroupLink({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  const { content } = usePublicContent()
  return (
    <a
      className={className}
      href={content.qq_group.join_url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children ?? <>{content.qq_group.link_label} · {content.qq_group.number}</>}
    </a>
  )
}
