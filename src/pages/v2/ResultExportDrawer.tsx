import { useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { GameQueueGuide, MaaImportGuide } from '../../components/result-panel/Guides'
import type { PreparedResult } from '../../components/result-panel/formatters'
import { copy } from '../../copy'
import type { OptimizeResult } from '../../lib/types'

const text = copy.v2
const imageCopy = copy.domain.result_image

export default function ResultExportDrawer({ open, onOpenChange, result, prepared, shift, busy, onDownloadMaa, onDownloadFullResult, onDownloadSample }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  result: OptimizeResult
  prepared: PreparedResult
  shift: number
  busy: boolean
  onDownloadMaa?: () => void
  onDownloadFullResult?: () => void
  onDownloadSample?: () => void
}) {
  const [imageExporting, setImageExporting] = useState(false)
  const [imageError, setImageError] = useState(false)
  const imageLock = useRef(false)
  const opener = useRef<HTMLElement | null>(null)
  const isRotationMode = result.schedule_mode === 'rotation'
  const selected = Math.min(shift, Math.max(prepared.plans.length - 1, 0))

  async function exportImage(allPlans: boolean) {
    if (imageLock.current) return
    imageLock.current = true
    setImageExporting(true)
    setImageError(false)
    try {
      const { downloadScheduleImage } = await import('../../components/result-panel/schedule-image')
      await downloadScheduleImage({ prepared, isRotationMode, version: 'v2', title: result.title,
        shiftHours: result.shift_hours, planIndex: allPlans ? undefined : selected })
    } catch {
      setImageError(true)
    } finally {
      imageLock.current = false
      setImageExporting(false)
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="v2-drawer" showCloseButton closeLabel={text.close}
      onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={(event) => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }}>
      <div className="v2-drawer-heading">
        <DialogTitle>{text.exportTitle}</DialogTitle>
        <DialogDescription>{text.exportDescription}</DialogDescription>
      </div>
      <div className="v2-drawer-body v2-options-content v2-feature-content v2-export-content">
        {onDownloadMaa && <section>
          <h3>{text.maaFile}</h3><p>{text.maaFileDescription}</p>
          <button type="button" className="v2-button v2-button-primary" disabled={busy || isRotationMode} aria-busy={busy} onClick={onDownloadMaa}>
            <Download size={16} />{busy ? copy.inventory.export_downloading : text.exportMaa}
          </button>
          {isRotationMode && <p className="v2-muted">{text.exportUnavailable}</p>}
        </section>}
        <section>
          <h3>{text.scheduleImages}</h3><p>{text.scheduleImagesDescription}</p>
          <p className="v2-muted">{text.imageShift(prepared.plans[selected]?.name || text.shift(selected + 1))}</p>
          <div className="v2-export-actions" aria-busy={imageExporting}>
            <button type="button" className="v2-button v2-button-secondary" disabled={busy || imageExporting || !prepared.plans.length} onClick={() => void exportImage(false)}>
              <Download size={16} />{imageCopy.current}
            </button>
            <button type="button" className="v2-button v2-button-secondary" disabled={busy || imageExporting || !prepared.plans.length} onClick={() => void exportImage(true)}>
              <Download size={16} />{imageCopy.all}
            </button>
          </div>
          {imageExporting && <p role="status">{imageCopy.busy}</p>}
          {imageError && <p role="alert" className="v2-error">{imageCopy.failed}</p>}
        </section>
        {onDownloadSample && <section>
          <h3>{text.sampleFile}</h3><p>{text.sampleNotice}</p>
          <button type="button" className="v2-button v2-button-secondary" disabled={busy} onClick={onDownloadSample}><Download size={16} />{text.sampleExport}</button>
        </section>}
        {onDownloadFullResult && <section>
          <h3>{text.calculationFile}</h3><p>{copy.domain.components_result_panel_ResultPanel_041}</p>
          <button type="button" className="v2-button v2-button-secondary" disabled={busy} aria-busy={busy} onClick={onDownloadFullResult}>
            <Download size={16} />{busy ? copy.inventory.export_downloading : copy.domain.components_result_panel_ResultPanel_039}
          </button>
        </section>}
        {!result.preview_limit && <section className="v2-export-guides">
          {!isRotationMode && <MaaImportGuide compact />}
          <GameQueueGuide isRotationMode={isRotationMode} />
        </section>}
      </div>
    </DialogContent>
  </Dialog>
}
