import { useState } from 'react'
import { copy } from '../../copy/index'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'

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
          <li>{guide.dormitory}</li>
          <li>{guide.drones}</li>
          <li>{guide.fiammetta}</li>
        </ol>
        {!isRotationMode && <p>{guide.autofill}</p>}
      </div>
    </details>
  )
}

export function MaaImportGuide({ compact = false }: { compact?: boolean }) {
  const [screenshotOpen, setScreenshotOpen] = useState(false)
  const screenshot = (
    <picture>
      <source srcSet="/assets/maa-import-schedule-json-dark.png" media="(prefers-color-scheme: dark)" />
      <img
        src="/assets/maa-import-schedule-json-bright.png"
        alt={copy.domain.components_result_panel_Guides_018}
        className="block h-auto w-full"
        width={801}
        height={600}
        loading="lazy"
      />
    </picture>
  )

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
        <button
          type="button"
          className="tool-inset block w-full cursor-zoom-in overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45"
          aria-label={copy.domain.maa_import_enlarge}
          aria-haspopup="dialog"
          aria-expanded={screenshotOpen}
          onClick={() => setScreenshotOpen(true)}
        >
          {screenshot}
          <span className="block px-4 py-3 text-sm font-medium text-ink-secondary">{copy.domain.maa_import_enlarge}</span>
        </button>
        <Dialog open={screenshotOpen} onOpenChange={setScreenshotOpen}>
          <DialogContent className="max-w-5xl [&_img]:max-h-[calc(85dvh-8rem)] [&_img]:object-contain" aria-describedby={undefined} showCloseButton closeLabel={copy.domain.maa_import_close}>
            <DialogTitle className="pr-8 text-sm">{copy.domain.components_result_panel_Guides_018}</DialogTitle>
            {screenshot}
          </DialogContent>
        </Dialog>
      </div>
    </details>
  )
}
