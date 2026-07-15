import { copy } from '../../copy/index'
export function RotationManualGuide({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? '' : 'mt-6 border-t border-surface-3/60 pt-5'}>
      <div className={compact ? '' : 'tool-inset px-4 py-4'}>
        <h3 className="text-base font-semibold text-ink-primary">
          {copy.domain.components_result_panel_Guides_001}</h3>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          {copy.domain.components_result_panel_Guides_002}</p>
      </div>
    </div>
  )
}

export function MaaImportGuide({ compact = false }: { compact?: boolean }) {
  return (
    <details className={`${compact ? '' : 'mt-6 '}tool-inset overflow-hidden`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2/80">
        <span>{copy.domain.components_result_panel_Guides_003}</span>
        <span className="text-xs font-medium text-ink-muted">{copy.domain.components_result_panel_Guides_004}</span>
      </summary>
      <div className="grid gap-5 border-t border-surface-3/60 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.25fr)] lg:items-start">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-secondary">
          <li>{copy.domain.components_result_panel_Guides_005}<span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_006}</span></li>
          <li>{copy.domain.components_result_panel_Guides_007}<span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_008}</span> {copy.domain.components_result_panel_Guides_009}<span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_010}</span></li>
          <li><span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_011}</span> {copy.domain.components_result_panel_Guides_012}<span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_013}</span></li>
          <li><span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_014}</span> {copy.domain.components_result_panel_Guides_015}<span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_016}</span></li>
          <li>{copy.domain.components_result_panel_Guides_017}</li>
        </ol>
        <div className="tool-inset overflow-hidden">
          <picture>
            <source srcSet="/assets/maa-import-schedule-json-dark.png" media="(prefers-color-scheme: dark)" />
            <img
              src="/assets/maa-import-schedule-json-bright.png"
              alt={copy.domain.components_result_panel_Guides_018}
              className="block h-auto w-full"
              loading="lazy"
            />
          </picture>
        </div>
      </div>
    </details>
  )
}
