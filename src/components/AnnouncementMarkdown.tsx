import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router'
import remarkGfm from 'remark-gfm'
import { isAppRoutePath } from '../lib/app-routes'
import type { MouseEvent } from 'react'

interface Props {
  children: string;
  className?: string;
  id?: string;
  onInternalNavigate?: () => void;
}

const linkClassName = 'font-medium text-brand-600 underline underline-offset-4 hover:text-brand-500'

export default function AnnouncementMarkdown({ children, className = '', id, onInternalNavigate }: Props) {
  return (
    <div id={id} className={`min-w-0 max-w-full overflow-x-auto text-sm leading-6 text-ink-secondary ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node: _node, ...props }) => <h1 {...props} className="mb-3 text-xl font-semibold leading-7 text-ink-primary" />,
          h2: ({ node: _node, ...props }) => <h2 {...props} className="mb-2 mt-5 text-lg font-semibold leading-7 text-ink-primary" />,
          h3: ({ node: _node, ...props }) => <h3 {...props} className="mb-2 mt-4 text-base font-semibold text-ink-primary" />,
          p: ({ node: _node, ...props }) => <p {...props} className="mb-3 last:mb-0" />,
          a: ({ node: _node, href, ...props }) => isInternalAnnouncementHref(href)
            ? (
                <Link
                  {...props}
                  to={href}
                  className={linkClassName}
                  onClick={(event) => {
                    if (isPrimaryNavigation(event)) onInternalNavigate?.()
                  }}
                />
              )
            : <a {...props} href={href} className={linkClassName} target="_blank" rel="noreferrer" />,
          ul: ({ node: _node, ...props }) => <ul {...props} className="mb-3 list-disc space-y-1 pl-5 last:mb-0" />,
          ol: ({ node: _node, ...props }) => <ol {...props} className="mb-3 list-decimal space-y-1 pl-5 last:mb-0" />,
          blockquote: ({ node: _node, ...props }) => <blockquote {...props} className="mb-3 border-l-2 border-brand-500/50 pl-3 text-ink-muted last:mb-0" />,
          pre: ({ node: _node, ...props }) => <pre {...props} className="mb-3 overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs leading-5 text-ink-primary last:mb-0" />,
          code: ({ node: _node, className: codeClassName, ...props }) => <code {...props} className={`rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em] text-ink-primary ${codeClassName ?? ''}`} />,
          table: ({ node: _node, ...props }) => <table {...props} className="min-w-full border-collapse text-left text-xs" />,
          th: ({ node: _node, ...props }) => <th {...props} className="border border-surface-3 bg-surface-2 px-2 py-1.5 font-semibold text-ink-primary" />,
          td: ({ node: _node, ...props }) => <td {...props} className="border border-surface-3 px-2 py-1.5 align-top" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

function isInternalAnnouncementHref(href: string | undefined): href is string {
  if (!href) return false
  if (href.startsWith('#') || href.startsWith('?')) return true
  if (!href.startsWith('/') || href.startsWith('//')) return false

  try {
    return isAppRoutePath(new URL(href, 'https://announcement.internal').pathname)
  } catch {
    return false
  }
}

function isPrimaryNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
}
