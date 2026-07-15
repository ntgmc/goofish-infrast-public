import { APP_BUILD_META } from '../lib/build-meta'
import type { AppBuildMeta } from '../lib/types'
import { copy } from '../copy/index'


interface Props {
  meta?: AppBuildMeta;
  className?: string;
  placement?: 'inline' | 'corner';
}

export default function BuildMetaStrip({ meta = APP_BUILD_META, className = '', placement = 'inline' }: Props) {
  const rootClassName = placement === 'corner'
    ? `relative z-40 mt-3 flex w-full max-w-full flex-wrap items-end justify-end gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs text-ink-muted sm:fixed sm:bottom-3 sm:right-3 sm:mt-0 sm:w-auto sm:max-w-[calc(100vw-1.5rem)] sm:px-0 sm:pb-0 ${className}`
    : `flex flex-wrap items-center gap-2 text-xs text-ink-secondary ${className}`
  const detailPanelClassName = placement === 'corner'
    ? 'tool-inset absolute bottom-full right-0 z-20 mb-2 w-[min(20rem,calc(100vw-1.5rem))] p-3 text-left shadow-sm'
    : 'tool-inset absolute left-0 top-full z-20 mt-2 w-[min(20rem,calc(100vw-1.5rem))] p-3 text-left shadow-sm'

  return (
    <div className={rootClassName}>
      <span className="tool-status bg-surface-1/95 shadow-sm">
        {copy.common.components_BuildMetaStrip_001}{formatDate(meta.generated_at)}
      </span>
      <details className="group relative">
        <summary className="tool-secondary-action min-h-8 list-none bg-surface-1/95 px-2.5 py-1 text-xs text-ink-muted shadow-sm [&::-webkit-details-marker]:hidden">
          {copy.common.components_BuildMetaStrip_002}</summary>
        <div className={detailPanelClassName}>
          <dl className="space-y-2">
            <div>
              <dt className="font-medium text-ink-secondary">{copy.common.components_BuildMetaStrip_003}</dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-ink-muted">{meta.data_version}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink-secondary">{copy.common.components_BuildMetaStrip_004}</dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-ink-muted">{meta.frontend_version}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink-secondary">{copy.common.components_BuildMetaStrip_005}</dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-ink-muted">{meta.backend_version}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink-secondary">{copy.common.components_BuildMetaStrip_006}</dt>
              <dd className="mt-0.5 break-all text-[11px] leading-5 text-ink-muted">{meta.source_summary}</dd>
            </div>
          </dl>
        </div>
      </details>
    </div>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return date.toISOString().slice(0, 10)
}
