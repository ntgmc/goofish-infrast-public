import { useState, type ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

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
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={() => setOpen(true)}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-surface-4 bg-surface-1 text-[11px] font-bold leading-none text-ink-muted transition-colors duration-150 hover:border-brand-500/60 hover:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
          >
            <span aria-hidden="true">?</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="block w-[min(20rem,calc(100vw-2rem))] shadow-black/20"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
