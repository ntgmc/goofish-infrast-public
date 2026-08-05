import { ChevronDown, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { copy } from '../copy'
import { ThemeProvider, useOptionalTheme, useTheme, type ThemePreference } from '../lib/theme'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

const options: Array<{ value: ThemePreference; label: string; Icon: LucideIcon }> = [
  { value: 'system', label: copy.common.components_ThemeSwitcher_003, Icon: Monitor },
  { value: 'light', label: copy.common.components_ThemeSwitcher_004, Icon: Sun },
  { value: 'dark', label: copy.common.components_ThemeSwitcher_005, Icon: Moon },
]

export default function ThemeSwitcher({ iconOnly = false }: { iconOnly?: boolean }) {
  const theme = useOptionalTheme()
  if (!theme) {
    return (
      <ThemeProvider>
        <ThemeSwitcherContent iconOnly={iconOnly} />
      </ThemeProvider>
    )
  }
  return <ThemeSwitcherContent iconOnly={iconOnly} />
}

function ThemeSwitcherContent({ iconOnly }: { iconOnly: boolean }) {
  const { preference, setPreference } = useTheme()
  const [open, setOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === preference) ?? options[0]
  const SelectedIcon = selectedOption.Icon

  const handlePreferenceChange = (value: string) => {
    const nextPreference = options.find((option) => option.value === value)?.value
    if (nextPreference) setPreference(nextPreference)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${copy.common.components_ThemeSwitcher_001}：${selectedOption.label}`}
          className={`tool-secondary-action h-11 whitespace-nowrap py-0 ${iconOnly ? 'w-11 justify-center px-0' : 'px-3'}`}
        >
          <SelectedIcon aria-hidden="true" className="size-4" />
          {!iconOnly && <span className="hidden sm:inline">{selectedOption.label}</span>}
          {!iconOnly && <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label={copy.common.components_ThemeSwitcher_002}
        aria-labelledby={undefined}
        className="min-w-40"
      >
        <DropdownMenuRadioGroup value={preference} onValueChange={handlePreferenceChange}>
          {options.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              <span className="flex-1">{label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
