import { useState, type ReactNode } from 'react'
import { Tooltip } from 'radix-ui'

export default function InfoTooltip({
  label,
  children,
  side = 'top',
}: {
  label: string
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const [open, setOpen] = useState(false)

  return (
    <Tooltip.Provider delayDuration={180} skipDelayDuration={80}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={() => setOpen(true)}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-surface-4 bg-surface-1 text-[11px] font-bold leading-none text-ink-muted transition-colors duration-150 hover:border-brand-500/60 hover:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
          >
            <span aria-hidden="true">?</span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={8}
            collisionPadding={16}
            className="z-[80] w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-surface-3 bg-surface-1 px-3.5 py-3 text-left text-xs leading-5 text-ink-secondary shadow-xl shadow-black/20 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in data-[state=delayed-open]:zoom-in-95 motion-reduce:animate-none"
          >
            {children}
            <Tooltip.Arrow className="fill-surface-3" width={10} height={5} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
