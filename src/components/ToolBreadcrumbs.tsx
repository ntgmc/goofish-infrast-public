import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { copy } from '../copy/index'

export interface ToolBreadcrumbItem {
  id: string
  label: string
  to?: string
}

export default function ToolBreadcrumbs({
  items,
  className = '',
}: {
  items: readonly ToolBreadcrumbItem[]
  className?: string
}) {
  return (
    <nav aria-label={copy.common.components_ToolBreadcrumbs_001} className={['min-w-0 max-w-full', className].filter(Boolean).join(' ')}>
      <ol className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
        {items.map((item, index) => {
          const current = index === items.length - 1
          const itemClassName = current
            ? 'block min-w-0 max-w-[16rem] truncate text-xs font-semibold text-ink-secondary'
            : 'block min-w-0 max-w-[16rem] truncate text-xs font-medium text-ink-muted'
          return (
            <li key={item.id} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />}
              {current || !item.to ? (
                <span
                  aria-current={current ? 'page' : undefined}
                  className={itemClassName}
                  title={item.label}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="block min-w-0 max-w-[16rem] truncate text-xs font-medium text-ink-muted transition-colors hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
                  title={item.label}
                >
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
