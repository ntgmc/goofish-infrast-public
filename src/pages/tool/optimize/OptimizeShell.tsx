import type { ReactNode } from 'react'
import BrandLogo from '../../../components/BrandLogo'
import DeferredFeatureMenu from '../../../components/DeferredFeatureMenu'
import { OPTIMIZE_SECTIONS, type OptimizeSection } from './types'

export default function OptimizeShell({
  section,
  permissionLabel,
  badges,
  showScenarioLab,
  onSectionChange,
  onReset,
  children,
}: {
  section: OptimizeSection;
  permissionLabel: string;
  badges?: Partial<Record<OptimizeSection, string>>;
  showScenarioLab: boolean;
  onSectionChange: (section: OptimizeSection) => void;
  onReset: () => void;
  children: ReactNode;
}) {
  const sections = OPTIMIZE_SECTIONS.filter((item) => item.id !== 'lab' || showScenarioLab)
  const current = sections.find((item) => item.id === section) ?? sections[0]

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-surface-3 bg-surface-1 px-4 py-5 lg:block">
        <div className="flex items-center gap-3 px-2">
          <BrandLogo size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-500">排班工作台</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{permissionLabel}</p>
          </div>
        </div>
        <nav className="mt-8 space-y-1" aria-label="排班工作台分区">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${
                section === item.id ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'
              }`}
            >
              <span>{item.label}</span>
              {badges?.[item.id] && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${section === item.id ? 'bg-white/15 text-white' : 'bg-surface-2 text-ink-muted'}`}>
                  {badges[item.id]}
                </span>
              )}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={onReset}
          className="absolute bottom-5 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary"
        >
          返回数据空间
        </button>
      </aside>

      <main className="lg:pl-64" tabIndex={-1} data-route-focus>
        <header className="sticky top-0 z-20 border-b border-surface-3 bg-surface-0/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <BrandLogo size="sm" className="lg:hidden" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-ink-primary">{current.label}</h1>
                  <span className="inline-flex w-max shrink-0 whitespace-nowrap rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-brand-300">
                    {permissionLabel}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-muted">{current.description}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
              <DeferredFeatureMenu />
              <button
                type="button"
                onClick={onReset}
                className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary lg:hidden"
              >
                返回数据空间
              </button>
            </div>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden" role="tablist" aria-label="排班工作台分区">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={section === item.id}
                onClick={() => onSectionChange(item.id)}
                className={`inline-flex min-h-10 w-max shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                  section === item.id ? 'bg-brand-600 text-white' : 'bg-surface-1 text-ink-secondary'
                }`}
              >
                <span>{item.label}</span>
                {badges?.[item.id] && (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${section === item.id ? 'bg-white/15 text-white' : 'bg-surface-2 text-ink-muted'}`}>
                    {badges[item.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </header>
        <div className="px-5 py-6 sm:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}
