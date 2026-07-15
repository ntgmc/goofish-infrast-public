import type { RefObject } from 'react'

export default function AdminOperatorPanel({
  operatorCount,
  status,
  fileRef,
  onReplace,
}: {
  operatorCount: number;
  status: string | null;
  fileRef: RefObject<HTMLInputElement>;
  onReplace: () => void;
}) {
  return (
    <details className="tool-panel overflow-hidden">
      <summary className="tool-panel-header flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 sm:px-6">
        <span className="flex flex-wrap items-center gap-2">
          干员数据
          <span className="tool-status tool-status--current">
            {operatorCount} 名干员
          </span>
        </span>
        <span className="tool-status">管理员</span>
      </summary>
      <div className="border-t border-surface-3/60 p-5 sm:p-6">
        <p className="text-sm leading-6 text-ink-secondary">
          管理员可以替换当前授权内的干员数据。普通用户数据由账号空间同步。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onReplace}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onReplace}
            className="tool-secondary-action text-sm"
          >
            替换干员 JSON
          </button>
          {status && <span className="tool-status" role="status" aria-live="polite">{status}</span>}
        </div>
      </div>
    </details>
  )
}
