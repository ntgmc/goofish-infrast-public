import type { ReactNode } from 'react'
import BrandLogo from '../../../components/BrandLogo'
import DeferredFeatureMenu from '../../../components/DeferredFeatureMenu'
import ThemeSwitcher from '../../../components/ThemeSwitcher'
import { OPTIMIZE_SECTIONS, type OptimizeSection } from './types'
import { copy } from '../../../copy/index'


export default function OptimizeShell({
  section,
  permissionLabel,
  badges,
  showScenarioLab,
  onSectionChange,
  onReset,
  children,
}: {
  section: OptimizeSection
  permissionLabel: string
  badges?: Partial<Record<OptimizeSection, string>>
  showScenarioLab: boolean
  onSectionChange: (section: OptimizeSection) => void
  onReset: () => void
  children: ReactNode
}) {
  const sections = OPTIMIZE_SECTIONS.filter((item) => item.id !== 'lab' || showScenarioLab)
  const current = sections.find((item) => item.id === section) ?? sections[0]

  return (
    <div className="tool-shell">
      <aside className="tool-sidebar fixed inset-y-0 left-0 hidden w-64 px-4 py-5 lg:block">
        <div className="border-b border-surface-3 px-2 pb-5">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-primary">{copy.optimize.pages_tool_optimize_OptimizeShell_001}</p>
              <p className="mt-1 truncate text-xs text-ink-muted">{permissionLabel}</p>
            </div>
          </div>
        </div>

        <nav className="mt-5 space-y-1" aria-label={copy.optimize.pages_tool_optimize_OptimizeShell_002}>
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
              className="tool-nav-link flex w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium"
            >
              <span>{item.label}</span>
              {badges?.[item.id] && <span className="text-xs font-medium text-ink-muted">{badges[item.id]}</span>}
            </button>
          ))}
        </nav>

        <div className="absolute inset-x-4 bottom-5 border-t border-surface-3 pt-4">
          <button type="button" onClick={onReset} className="tool-secondary-action w-full">{copy.optimize.pages_tool_optimize_OptimizeShell_003}</button>
        </div>
      </aside>

      <main className="lg:pl-64" tabIndex={-1} data-route-focus>
        <header className="tool-header sticky top-0 z-20 px-5 py-4 sm:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <BrandLogo size="sm" className="lg:hidden" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="tool-eyebrow">{copy.optimize.pages_tool_optimize_OptimizeShell_004}</p>
                  <span className="tool-status tool-status--current">{permissionLabel}</span>
                </div>
                <h1 className="mt-1 text-xl font-semibold text-ink-primary">{current.label}</h1>
                <p className="mt-1 text-sm text-ink-muted">{current.description}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
              <ThemeSwitcher />
              <DeferredFeatureMenu />
              <button type="button" onClick={onReset} className="tool-secondary-action lg:hidden">{copy.optimize.pages_tool_optimize_OptimizeShell_005}</button>
            </div>
          </div>

          <nav className="mx-auto mt-4 flex max-w-7xl gap-2 overflow-x-auto pb-1 lg:hidden" aria-label={copy.optimize.pages_tool_optimize_OptimizeShell_006}>
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSectionChange(item.id)}
                aria-current={section === item.id ? 'page' : undefined}
                className="tool-nav-link inline-flex shrink-0 items-center gap-2 px-3 text-sm font-medium"
              >
                <span>{item.label}</span>
                {badges?.[item.id] && <span className="text-xs text-ink-muted">{badges[item.id]}</span>}
              </button>
            ))}
          </nav>
        </header>
        <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8">{children}</div>
      </main>
    </div>
  )
}
