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
    <details className="rounded-xl bg-surface-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2/60 sm:px-6">
        <span className="flex flex-wrap items-center gap-2">
          干员数据
          <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-300">
            {operatorCount} 名干员
          </span>
        </span>
        <span className="text-xs text-ink-muted">管理员</span>
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
            className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-3"
          >
            替换干员 JSON
          </button>
          {status && <span className="text-sm text-ink-secondary">{status}</span>}
        </div>
      </div>
    </details>
  )
}
