import { copy } from '../../copy/index'
export function GameQueueGuide({ isRotationMode }: { isRotationMode: boolean }) {
  const guide = copy.domain.game_queue
  return (
    <details className="tool-inset overflow-hidden" open={isRotationMode}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-primary">
        {copy.domain.components_result_panel_Guides_001}
      </summary>
      <div className="space-y-3 border-t border-surface-3/60 p-4 text-sm leading-6 text-ink-secondary">
        <p>{isRotationMode ? copy.domain.components_result_panel_Guides_002 : guide.maa_hint}</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>{guide.open_overview}</li>
          <li>{guide.set_queues}</li>
          <li>{isRotationMode ? guide.switch_rotation : guide.switch_maa}</li>
          <li>{guide.support}</li>
        </ol>
        {!isRotationMode && <p>{guide.autofill}</p>}
      </div>
    </details>
  )
}

export function MaaImportGuide({ compact = false }: { compact?: boolean }) {
  return (
    <details className={`${compact ? '' : 'mt-6 '}tool-inset overflow-hidden`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2/80">
        <span>{copy.domain.components_result_panel_Guides_003}</span>
        <span className="text-xs font-medium text-ink-muted">{copy.domain.components_result_panel_Guides_004}</span>
      </summary>
      <div className="grid gap-5 border-t border-surface-3/60 p-4">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-secondary">
          <li>{copy.domain.components_result_panel_Guides_005}<span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_006}</span></li>
          <li>{copy.domain.components_result_panel_Guides_007}<span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_008}</span> {copy.domain.components_result_panel_Guides_009}<span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_010}</span></li>
          <li><span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_011}</span> {copy.domain.components_result_panel_Guides_012}<span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_013}</span></li>
          <li><span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_014}</span> {copy.domain.components_result_panel_Guides_015}<span className="font-medium text-ink-primary">{copy.domain.components_result_panel_Guides_016}</span></li>
          <li>{copy.domain.components_result_panel_Guides_017}</li>
        </ol>
        <details className="tool-inset overflow-hidden">
          <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/45">
            {copy.domain.maa_import_screenshot}
          </summary>
          <picture>
            <source srcSet="/assets/maa-import-schedule-json-dark.png" media="(prefers-color-scheme: dark)" />
            <img
              src="/assets/maa-import-schedule-json-bright.png"
              alt={copy.domain.components_result_panel_Guides_018}
              className="block h-auto w-full"
              loading="lazy"
            />
          </picture>
        </details>
      </div>
    </details>
  )
}
