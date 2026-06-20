import { APP_BUILD_META } from '../lib/build-meta'
import type { AppBuildMeta } from '../lib/types'

interface Props {
  meta?: AppBuildMeta;
  className?: string;
}

export default function BuildMetaStrip({ meta = APP_BUILD_META, className = '' }: Props) {
  return (
    <div className={`flex flex-wrap items-center gap-2 text-xs text-ink-secondary ${className}`}>
      <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium text-ink-primary">
        当前规则数据更新于 {formatDate(meta.generated_at)}
      </span>
      <span className="rounded-full bg-surface-2 px-2.5 py-1">
        数据 {meta.data_version}
      </span>
      <span className="rounded-full bg-surface-2 px-2.5 py-1">
        前端 {meta.frontend_version}
      </span>
      <span className="rounded-full bg-surface-2 px-2.5 py-1">
        后端 {meta.backend_version}
      </span>
      <span className="rounded-full bg-surface-2 px-2.5 py-1" title={meta.source_summary}>
        来源摘要
      </span>
    </div>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return date.toISOString().slice(0, 10)
}
