import { Link } from 'react-router'
import { copy } from '../copy/index'
import { DEFAULT_PUBLIC_CONTENT_SETTINGS } from '../lib/public-content'
import { usePublicContent } from '../lib/public-content-context'


export const GITHUB_REPOSITORY_URL = 'https://github.com/ntgmc/goofish-infrast-public'
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
  const iconLinkClassName = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink-primary'
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
          <a
            className={iconLinkClassName}
            href={GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={copy.public.components_PublicFooter_015}
            title={copy.public.components_PublicFooter_015}
          >
            <GitHubIcon className="size-5" />
          </a>
        </nav>
      </div>
    </footer>
  )
}

function GitHubIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.7 7.7 0 0 1 8 3.78c.68.003 1.36.092 2.01.26 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
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
