import { Check, ChevronDown, MoreHorizontal } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { Link } from 'react-router'

type CompactHeaderMenuItem =
  | {
      type: 'button'
      id: string
      label: string
      onSelect: () => void
      current?: boolean
      badge?: string
      badgeLabel?: string
      disabled?: boolean
      intent?: 'default' | 'danger'
      tourTarget?: string
    }
  | {
      type: 'link'
      id: string
      label: string
      to: string
      current?: boolean
      badge?: string
      badgeLabel?: string
      disabled?: boolean
      intent?: 'default' | 'danger'
    }
  | {
      type: 'separator'
      id: string
    }

interface CompactHeaderMenuProps {
  ariaLabel: string
  triggerLabel?: string
  triggerBadge?: string
  triggerBadgeLabel?: string
  triggerVariant?: 'label' | 'icon'
  items: CompactHeaderMenuItem[]
  metadata?: {
    title: string
    description?: string
  }
  align?: 'start' | 'center' | 'end'
  tourTargets?: string[]
  className?: string
}

const itemClassName = 'relative flex min-h-11 w-full cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-secondary outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink-primary'

export default function CompactHeaderMenu({
  ariaLabel,
  triggerLabel,
  triggerBadge,
  triggerBadgeLabel,
  triggerVariant = 'label',
  items,
  metadata,
  align = 'end',
  tourTargets,
  className = '',
}: CompactHeaderMenuProps) {
  const iconTrigger = triggerVariant === 'icon'

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          data-tour-fallback-targets={tourTargets?.join(' ')}
          className={`tool-secondary-action h-11 py-0 ${iconTrigger ? 'w-11 shrink-0 justify-center px-0' : 'min-w-0 max-w-full gap-1.5 px-3'} ${className}`}
        >
          {iconTrigger ? (
            <MoreHorizontal aria-hidden="true" className="size-5" />
          ) : (
            <>
              <span className="truncate">{triggerLabel}</span>
              {triggerBadge && (
                <span aria-label={triggerBadgeLabel} className="tool-status shrink-0 px-1.5 py-0.5 text-[11px]">
                  {triggerBadge}
                </span>
              )}
              <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
            </>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align={align}
          sideOffset={8}
          collisionPadding={16}
          sticky="always"
          updatePositionStrategy="always"
          style={{ maxHeight: 'min(32rem, calc(100dvh - 5rem), var(--radix-dropdown-menu-content-available-height))' }}
          className="z-50 w-[min(18rem,calc(100vw-2rem))] overscroll-contain overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          {metadata && (
            <DropdownMenu.Label className="border-b border-surface-3 px-3 py-2.5">
              <span className="block truncate text-sm font-semibold text-ink-primary">{metadata.title}</span>
              {metadata.description && <span className="mt-1 block text-xs leading-5 text-ink-muted">{metadata.description}</span>}
            </DropdownMenu.Label>
          )}
          {items.map((item) => {
            if (item.type === 'separator') {
              return <DropdownMenu.Separator key={item.id} className="my-1 h-px bg-surface-3" />
            }

            const content = (
              <>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badge && (
                  <span aria-label={item.badgeLabel} className="tool-status shrink-0 px-1.5 py-0.5 text-[11px]">
                    {item.badge}
                  </span>
                )}
                {item.current && <Check aria-hidden="true" className="size-4 shrink-0 text-brand-500" />}
              </>
            )
            const className = `${itemClassName} ${item.intent === 'danger' ? 'text-error data-[highlighted]:text-error' : ''}`
            const ariaLabel = item.badgeLabel ? `${item.label} ${item.badgeLabel}` : undefined

            if (item.type === 'link' && !item.disabled) {
              return (
                <DropdownMenu.Item key={item.id} asChild className={className}>
                  <Link
                    to={item.to}
                    aria-label={ariaLabel}
                    aria-current={item.current ? 'page' : undefined}
                  >
                    {content}
                  </Link>
                </DropdownMenu.Item>
              )
            }

            return (
              <DropdownMenu.Item
                key={item.id}
                disabled={item.disabled}
                aria-label={ariaLabel}
                aria-current={item.current ? 'page' : undefined}
                data-tour-target={item.type === 'button' ? item.tourTarget : undefined}
                onSelect={item.type === 'button' ? item.onSelect : undefined}
                className={className}
              >
                {content}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
