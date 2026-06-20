import { APP_BUILD_META } from '../lib/build-meta'
import type { AppBuildMeta } from '../lib/types'

interface Props {
  meta?: AppBuildMeta;
  className?: string;
  placement?: 'inline' | 'corner';
}

export default function BuildMetaStrip({ meta = APP_BUILD_META, className = '', placement = 'inline' }: Props) {
  const rootClassName = placement === 'corner'
    ? `fixed bottom-3 right-3 z-40 flex max-w-[calc(100vw-1.5rem)] items-end gap-2 text-xs text-ink-muted ${className}`
    : `flex flex-wrap items-center gap-2 text-xs text-ink-secondary ${className}`
  const detailPanelClassName = placement === 'corner'
    ? 'absolute bottom-full right-0 mb-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-surface-3 bg-surface-1 p-3 text-left shadow-sm'
    : 'absolute left-0 top-full z-20 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-lg border border-surface-3 bg-surface-1 p-3 text-left shadow-sm'

  return (
    <div className={rootClassName}>
      <span className="rounded-full border border-surface-3 bg-surface-1/95 px-2.5 py-1 font-medium text-ink-secondary shadow-sm">
        当前规则数据更新于 {formatDate(meta.generated_at)}
      </span>
      <details className="group relative">
        <summary className="cursor-pointer list-none rounded-full border border-surface-3 bg-surface-1/95 px-2.5 py-1 text-ink-muted shadow-sm transition-colors duration-150 hover:border-surface-4 hover:text-ink-secondary [&::-webkit-details-marker]:hidden">
          版本
        </summary>
        <div className={detailPanelClassName}>
          <dl className="space-y-2">
            <div>
              <dt className="font-medium text-ink-secondary">数据</dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-ink-muted">{meta.data_version}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink-secondary">前端</dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-ink-muted">{meta.frontend_version}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink-secondary">后端</dt>
              <dd className="mt-0.5 break-all font-mono text-[11px] text-ink-muted">{meta.backend_version}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink-secondary">来源摘要</dt>
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
