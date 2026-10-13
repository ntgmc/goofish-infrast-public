import { useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { GameQueueGuide, MaaImportGuide } from '../../components/result-panel/Guides'
import type { PreparedResult } from '../../components/result-panel/formatters'
import { copy } from '../../copy'
import type { OptimizeResult } from '../../lib/types'
import { ApiError, getApiErrorMessage } from '../../lib/api-client'
import type { ResultExportFailure } from '../tool/optimize/useResultDownloads'

const text = copy.v2
const imageCopy = copy.domain.result_image

export default function ResultExportDrawer({ open, onOpenChange, result, prepared, shift, busy, failure, onRecover, onDownloadMaa, onDownloadFullResult, onDownloadSample }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  result: OptimizeResult
  prepared: PreparedResult
  shift: number
  busy: boolean
  failure?: ResultExportFailure | null
  onRecover: (action: 'inventory' | 'plans' | 'pricing' | 'generation' | 'login' | 'support') => void
  onDownloadMaa?: () => void
  onDownloadFullResult?: () => void
  onDownloadSample?: () => void | Promise<void>
}) {
  const [imageExporting, setImageExporting] = useState(false)
  const [imageError, setImageError] = useState<{ message: string; allPlans: boolean } | null>(null)
  const [sampleError, setSampleError] = useState<string | null>(null)
  const imageLock = useRef(false)
  const opener = useRef<HTMLElement | null>(null)
  const isRotationMode = result.schedule_mode === 'rotation'
  const selected = Math.min(shift, Math.max(prepared.plans.length - 1, 0))

  async function exportImage(allPlans: boolean) {
    if (imageLock.current) return
    imageLock.current = true
    setImageExporting(true)
    setImageError(null)
    try {
      const { downloadScheduleImage } = await import('../../components/result-panel/schedule-image')
      await downloadScheduleImage({ prepared, isRotationMode, version: 'v2', title: result.title,
        shiftHours: result.shift_hours, planIndex: allPlans ? undefined : selected })
    } catch (error) {
      const reasons: Record<string, string> = { 'Canvas unavailable': text.exportImageCanvasFailed, 'PNG encoding failed': text.exportImageEncodingFailed, 'No schedule to export': text.exportImageEmpty }
      const reason = error instanceof Error ? reasons[error.message] : undefined
      setImageError({ message: reason ?? imageCopy.failed, allPlans })
    } finally {
      imageLock.current = false
      setImageExporting(false)
    }
  }

  async function exportSample() {
    setSampleError(null)
    try { await onDownloadSample?.() }
    catch (error) { setSampleError(getApiErrorMessage(error, text.exportSampleFailed)) }
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
          {failure?.format === 'maa' && <ExportFailure failure={failure} busy={busy} onRetry={onDownloadMaa} onRecover={onRecover} />}
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
          {imageError && <div className="v2-export-failure" role="alert"><p className="v2-error">{imageError.message}</p><p>{text.exportImageHelp}</p>
            <button type="button" className="v2-button v2-button-secondary" disabled={busy || imageExporting} onClick={() => void exportImage(imageError.allPlans)}>{text.exportRetry}</button>
          </div>}
        </section>
        {onDownloadSample && <section>
          <h3>{text.sampleFile}</h3><p>{text.sampleNotice}</p>
          <button type="button" className="v2-button v2-button-secondary" disabled={busy} onClick={() => void exportSample()}><Download size={16} />{text.sampleExport}</button>
          {sampleError && <div className="v2-export-failure" role="alert"><p className="v2-error">{sampleError}</p><p>{text.exportRetryHelp}</p><button type="button" className="v2-button v2-button-secondary" disabled={busy} onClick={() => void exportSample()}>{text.exportRetry}</button></div>}
        </section>}
        {onDownloadFullResult && <section>
          <h3>{text.calculationFile}</h3><p>{copy.domain.components_result_panel_ResultPanel_041}</p>
          <button type="button" className="v2-button v2-button-secondary" disabled={busy} aria-busy={busy} onClick={onDownloadFullResult}>
            <Download size={16} />{busy ? copy.inventory.export_downloading : copy.domain.components_result_panel_ResultPanel_039}
          </button>
          {failure?.format === 'full' && <ExportFailure failure={failure} busy={busy} onRetry={onDownloadFullResult} onRecover={onRecover} />}
        </section>}
        {!result.preview_limit && <section className="v2-export-guides">
          {!isRotationMode && <MaaImportGuide compact />}
          <GameQueueGuide isRotationMode={isRotationMode} />
        </section>}
      </div>
    </DialogContent>
  </Dialog>
}

function ExportFailure({ failure, busy, onRetry, onRecover }: {
  failure: ResultExportFailure
  busy: boolean
  onRetry: () => void
  onRecover: (action: 'inventory' | 'plans' | 'pricing' | 'generation' | 'login' | 'support') => void
}) {
  const error = failure.error
  const apiError = error instanceof ApiError ? error : null
  const recovery = apiError?.code === 'maa_export_coupon_required' || apiError?.code === 'item_unavailable'
    ? { action: 'inventory' as const, help: text.exportInventoryHelp, label: text.exportInventoryAction }
    : apiError?.status === 401
      ? { action: 'login' as const, help: text.exportLoginHelp, label: text.exportLoginAction }
      : apiError?.status === 404
        ? { action: 'plans' as const, help: text.exportPlansHelp, label: text.exportPlansAction }
        : apiError?.status === 422
          ? { action: 'generation' as const, help: text.exportGenerateHelp, label: text.exportGenerateAction }
          : apiError?.code === 'full_result_export_forbidden'
            ? { action: 'pricing' as const, help: text.exportPricingHelp, label: text.comparePlans }
            : apiError?.status === 403
              ? { action: 'support' as const, help: text.exportSupportHelp, label: copy.public.pages_PublicInfoPage_061 }
              : null
  return <div className="v2-export-failure" role="alert">
    <p className="v2-error">{getApiErrorMessage(error, failure.format === 'maa' ? copy.inventory.maa_export_failed : copy.inventory.full_result_export_failed)}</p>
    <p>{recovery?.help ?? text.exportRetryHelp}</p>
    <button type="button" className="v2-button v2-button-secondary" disabled={busy} onClick={() => recovery ? onRecover(recovery.action) : onRetry()}>{recovery?.label ?? text.exportRetry}</button>
  </div>
}
