import type { ReactNode } from 'react'
import { LayoutGroup } from 'motion/react'
import BrandLogo from '../../../components/BrandLogo'
import CompactHeaderMenu from '../../../components/CompactHeaderMenu'
import DeferredFeatureMenu from '../../../components/DeferredFeatureMenu'
import { AnimatedPresenceRegion, MotionNavIndicator } from '../../../components/MotionPrimitives'
import ThemeSwitcher from '../../../components/ThemeSwitcher'
import { OPTIMIZE_SECTIONS, type OptimizeSection } from './types'
import { copy } from '../../../copy/index'


export default function OptimizeShell({
  section,
  permissionLabel,
  badges,
  headerActions,
  compactHeaderActions,
  showScenarioLab,
  onSectionChange,
  onOpenTour,
  onReset,
  children,
}: {
  section: OptimizeSection
  permissionLabel: string
  badges?: Partial<Record<OptimizeSection, string>>
  headerActions?: ReactNode
  compactHeaderActions?: ReactNode
  showScenarioLab: boolean
  onSectionChange: (section: OptimizeSection) => void
  onOpenTour: () => void
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

        <LayoutGroup id="optimize-desktop">
          <nav className="mt-5 space-y-1" aria-label={copy.optimize.pages_tool_optimize_OptimizeShell_002}>
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSectionChange(item.id)}
                data-tour-target={`optimize-nav-${item.id}`}
                aria-current={section === item.id ? 'page' : undefined}
                className="tool-nav-link flex w-full items-center justify-between gap-3 px-3 text-left text-sm font-medium"
              >
                {section === item.id && <MotionNavIndicator layoutId="optimize-active" />}
                <span className="relative z-10">{item.label}</span>
                {badges?.[item.id] && <span className="relative z-10 text-xs font-medium text-ink-muted">{badges[item.id]}</span>}
              </button>
            ))}
          </nav>
        </LayoutGroup>

        <div className="absolute inset-x-4 bottom-5 border-t border-surface-3 pt-4">
          <button type="button" onClick={onReset} className="tool-secondary-action w-full">{copy.optimize.pages_tool_optimize_OptimizeShell_003}</button>
        </div>
      </aside>

      <main className="lg:pl-64" tabIndex={-1} data-route-focus>
        <header className="tool-header sticky top-0 z-20 px-4 py-1.5 lg:px-8 lg:py-4">
          <div className="mx-auto flex h-11 max-w-7xl items-center justify-between gap-2 lg:hidden">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <BrandLogo size="sm" />
              <CompactHeaderMenu
                ariaLabel={copy.common.components_CompactHeaderMenu_001}
                triggerLabel={current.label}
                align="start"
                tourTargets={sections.map((item) => `optimize-nav-${item.id}`)}
                className="min-w-0 flex-1 justify-between"
                metadata={{ title: permissionLabel, description: current.description }}
                items={[
                  ...sections.map((item) => ({
                    type: 'button' as const,
                    id: item.id,
                    label: item.label,
                    current: section === item.id,
                    badge: badges?.[item.id],
                    tourTarget: `optimize-nav-${item.id}`,
                    onSelect: () => onSectionChange(item.id),
                  })),
                  { type: 'separator' as const, id: 'actions' },
                  { type: 'button' as const, id: 'tour', label: copy.optimize.pages_tool_optimize_tour_001, onSelect: onOpenTour },
                  { type: 'button' as const, id: 'reset', label: copy.optimize.pages_tool_optimize_OptimizeShell_005, intent: 'danger' as const, onSelect: onReset },
                ]}
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {compactHeaderActions}
              <ThemeSwitcher iconOnly />
              <DeferredFeatureMenu iconOnly />
            </div>
          </div>

          <div className="mx-auto hidden max-w-7xl items-start justify-between gap-4 lg:flex">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="section-index">{copy.optimize.pages_tool_optimize_OptimizeShell_004}</p>
                  <span className="tool-status tool-status--current">{permissionLabel}</span>
                </div>
                <h1 className="display-title mt-1 text-xl text-ink-primary">{current.label}</h1>
                <p className="mt-1 text-sm text-ink-muted">{current.description}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
              <button type="button" onClick={onOpenTour} className="tool-secondary-action">
                {copy.optimize.pages_tool_optimize_tour_001}
              </button>
              {headerActions}
              <ThemeSwitcher />
              <DeferredFeatureMenu />
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
          <AnimatedPresenceRegion motionKey={section}>{children}</AnimatedPresenceRegion>
        </div>
      </main>
    </div>
  )
}
