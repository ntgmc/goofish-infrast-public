import type { PaginationMeta } from '../contracts'

export function PaginationControls({ pagination, loading, onPageChange, onPageSizeChange }: {
  pagination: PaginationMeta;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const current = pagination.page
  const last = pagination.total_pages
  const pages = compactPages(current, last)
  return (
    <nav className="flex flex-col gap-3 border-t border-surface-3 p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="分页导航">
      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
        <span role="status" aria-live="polite">共 {pagination.total} 条 · {last === 0 ? '暂无分页' : `第 ${current}/${last} 页`}</span>
        <label className="flex items-center gap-2">
          <span>每页</span>
          <select className="tool-field min-h-10 w-24 py-1" value={pagination.page_size} disabled={loading} onChange={(event) => onPageSizeChange(Number(event.currentTarget.value))}>
            {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <PageButton label="首页" disabled={loading || current <= 1} onClick={() => onPageChange(1)} />
        <PageButton label="上一页" disabled={loading || current <= 1} onClick={() => onPageChange(current - 1)} />
        {pages.map((page, index) => page === null
          ? <span key={`ellipsis-${index}`} className="px-2 text-ink-muted" aria-hidden="true">…</span>
          : <button key={page} type="button" aria-label={`第 ${page} 页`} aria-current={page === current ? 'page' : undefined} disabled={loading} onClick={() => onPageChange(page)} className={`tool-secondary-action min-h-10 min-w-10 px-2 text-sm ${page === current ? 'tool-option-selected' : ''}`}>{page}</button>)}
        <PageButton label="下一页" disabled={loading || last === 0 || current >= last} onClick={() => onPageChange(current + 1)} />
        <PageButton label="末页" disabled={loading || last === 0 || current >= last} onClick={() => onPageChange(last)} />
      </div>
    </nav>
  )
}

function PageButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="tool-secondary-action min-h-10 px-3 text-sm">{label}</button>
}

function compactPages(current: number, last: number): Array<number | null> {
  if (last <= 0) return []
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1)
  const values = new Set([1, last, current - 1, current, current + 1].filter((page) => page >= 1 && page <= last))
  const sorted = [...values].sort((left, right) => left - right)
  const result: Array<number | null> = []
  for (const page of sorted) {
    const previous = result[result.length - 1]
    if (typeof previous === 'number' && page - previous > 1) result.push(null)
    result.push(page)
  }
  return result
}
