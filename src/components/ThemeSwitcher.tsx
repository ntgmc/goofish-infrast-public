import { Check, ChevronDown, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { copy } from '../copy'
import { ThemeProvider, useOptionalTheme, useTheme, type ThemePreference } from '../lib/theme'

const options: Array<{ value: ThemePreference; label: string; Icon: LucideIcon }> = [
  { value: 'system', label: copy.common.components_ThemeSwitcher_003, Icon: Monitor },
  { value: 'light', label: copy.common.components_ThemeSwitcher_004, Icon: Sun },
  { value: 'dark', label: copy.common.components_ThemeSwitcher_005, Icon: Moon },
]

export default function ThemeSwitcher() {
  const theme = useOptionalTheme()
  if (!theme) {
    return (
      <ThemeProvider>
        <ThemeSwitcherContent />
      </ThemeProvider>
    )
  }
  return <ThemeSwitcherContent />
}

function ThemeSwitcherContent() {
  const { preference, setPreference } = useTheme()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedOption = options.find((option) => option.value === preference) ?? options[0]
  const SelectedIcon = selectedOption.Icon

  useEffect(() => {
    if (!open) return
    itemRefs.current[options.findIndex((option) => option.value === preference)]?.focus()
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open, preference])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentIndex = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex: number | undefined
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = options.length - 1
    if (event.key === 'Escape') {
      setOpen(false)
      triggerRef.current?.focus()
    }
    if (nextIndex !== undefined) {
      event.preventDefault()
      itemRefs.current[nextIndex]?.focus()
    }
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
        {open && (
          <div role="menu" aria-label={copy.common.components_ThemeSwitcher_002} onKeyDown={handleMenuKeyDown} className="absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-40 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
          {options.map(({ value, label, Icon }, index) => (
            <button
              key={value}
              ref={(element) => { itemRefs.current[index] = element }}
              type="button"
              role="menuitemradio"
              aria-checked={preference === value}
              onClick={() => { setPreference(value); setOpen(false) }}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink-primary"
            >
              <Icon aria-hidden="true" className="size-4" />
              <span className="flex-1">{label}</span>
              {preference === value && <Check aria-hidden="true" className="size-4 text-brand-500" />}
            </button>
          ))}
          </div>
        )}
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${copy.common.components_ThemeSwitcher_001}：${selectedOption.label}`}
          onClick={() => setOpen((current) => !current)}
          className="tool-secondary-action h-11 whitespace-nowrap px-3 py-0"
        >
          <SelectedIcon aria-hidden="true" className="size-4" />
        <span className="hidden sm:inline">{selectedOption.label}</span>
          <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
    </div>
  )
}
