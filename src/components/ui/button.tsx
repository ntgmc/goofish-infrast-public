import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "group/button inline-flex h-11 shrink-0 touch-manipulation select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-input)] border border-transparent px-4 text-sm font-semibold outline-none transition-[background-color,border-color,color,opacity,transform,box-shadow] duration-[var(--motion-instant)] ease-out focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.985] motion-reduce:transform-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:active:scale-100 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-[var(--color-accent-hover)] disabled:bg-surface-3 disabled:text-ink-muted',
        outline:
          'border-border bg-background text-ink-secondary hover:border-surface-4 hover:bg-surface-2 hover:text-ink-primary aria-expanded:bg-surface-2 aria-expanded:text-ink-primary',
        secondary:
          'border-border bg-secondary text-secondary-foreground hover:border-surface-4 hover:bg-surface-3 hover:text-foreground aria-expanded:bg-surface-3 aria-expanded:text-foreground',
        ghost:
          'bg-transparent text-ink-secondary hover:bg-surface-2 hover:text-ink-primary aria-expanded:bg-surface-2 aria-expanded:text-ink-primary',
        destructive:
          'bg-destructive text-primary-foreground hover:bg-[color-mix(in_oklch,var(--destructive)_88%,white)] disabled:bg-surface-3 disabled:text-ink-muted',
        link: 'bg-transparent px-2 text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-11 px-3 text-xs',
        lg: 'h-12 px-5 text-base',
        icon: 'size-11 px-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  type,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      type={asChild ? undefined : (type ?? 'button')}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
