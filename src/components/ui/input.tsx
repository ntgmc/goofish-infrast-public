import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-11 w-full min-w-0 rounded-[var(--radius-input)] border border-input bg-surface-0 px-3 py-2 text-base text-ink-primary outline-none transition-[background-color,border-color,box-shadow,color,opacity] duration-[var(--motion-instant)] placeholder:text-ink-muted file:mr-3 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground hover:not-disabled:border-surface-4 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted disabled:opacity-[0.55] aria-invalid:border-destructive/70 aria-invalid:bg-destructive/5 aria-invalid:ring-2 aria-invalid:ring-destructive/20 sm:text-sm dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
