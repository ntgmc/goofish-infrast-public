import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content min-h-28 w-full resize-y rounded-[var(--radius-input)] border border-input bg-surface-0 px-3 py-2.5 text-base text-ink-primary outline-none transition-[background-color,border-color,box-shadow,color,opacity] duration-[var(--motion-instant)] placeholder:text-ink-muted hover:not-disabled:border-surface-4 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted disabled:opacity-[0.55] aria-invalid:border-destructive/70 aria-invalid:bg-destructive/5 aria-invalid:ring-2 aria-invalid:ring-destructive/20 sm:text-sm dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
