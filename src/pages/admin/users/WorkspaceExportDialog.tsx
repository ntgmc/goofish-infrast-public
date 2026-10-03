import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog'
import SklandIcon from '../../../components/SklandIcon'
import type { AdminUserDetail } from '../contracts'

export function WorkspaceExportDialog({
  detail,
  busy,
  pageLoading,
  onClose,
  onDownload,
  onLoadProfilePage,
}: {
  detail: AdminUserDetail;
  busy: boolean;
  pageLoading: boolean;
  onClose: () => void;
  onDownload: (profileIds: string[]) => Promise<boolean>;
  onLoadProfilePage: (page: number) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const pagination = detail.profile_pagination
  const disabled = busy || pageLoading
  const toggleProfile = (id: string) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((selectedId) => selectedId !== id)
      : [...current, id])
  }
  const download = async () => {
    if (selectedIds.length === 0) return
    setError(null)
    if (await onDownload(selectedIds)) onClose()
    else setError('导出失败，请重试。')
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !disabled) onClose() }}>
      <DialogContent
        className="max-w-xl"
        onOpenAutoFocus={() => {
          returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
          returnFocusRef.current = null
        }}
        onEscapeKeyDown={(event) => { if (disabled) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (disabled) event.preventDefault() }}
      >
        <DialogTitle>导出工作区</DialogTitle>
        <DialogDescription className="break-words">
          选择 {detail.user.email} 的游戏账号，可单选或多选。导出包含干员、配置和完整排班历史。
          导出的最近结果选用优化器排班；手动排班在完整历史中单独标注。
        </DialogDescription>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled || detail.profiles.length === 0}
            onClick={() => setSelectedIds((current) => [...new Set([...current, ...detail.profiles.map((profile) => profile.id)])])}
            className="tool-secondary-action text-xs"
          >全选当前页</button>
          <button
            type="button"
            disabled={disabled || selectedIds.length === 0}
            onClick={() => setSelectedIds([])}
            className="tool-secondary-action text-xs"
          >清空选择</button>
          <span className="text-xs text-ink-muted" role="status">已选 {selectedIds.length} 个账号</span>
        </div>
        <fieldset disabled={disabled} className="max-h-[45dvh] space-y-2 overflow-y-auto">
          <legend className="sr-only">选择要导出的游戏账号</legend>
          {detail.profiles.length === 0 && <p className="text-sm text-ink-muted">该用户暂无账号档案。</p>}
          {detail.profiles.map((profile) => (
            <label key={profile.id} className="tool-inset flex cursor-pointer items-start gap-3 p-3">
              <input
                type="checkbox"
                checked={selectedIds.includes(profile.id)}
                onChange={() => toggleProfile(profile.id)}
                className="mt-1 accent-brand-500"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-primary">{profile.display_name || '账号档案'}</span>
                {profile.skland_binding && (
                  <span className="mt-1 block text-xs text-ink-secondary">
                    <SklandIcon className="mr-2" />
                    {profile.skland_binding.nickname} / {profile.skland_binding.uid} / {profile.skland_binding.channel_name}
                  </span>
                )}
                <span className="mt-1 block break-all text-xs text-ink-muted">档案 ID：{profile.id}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {pagination?.truncated && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-muted">第 {pagination.page} / {pagination.total_pages} 页，共 {pagination.total} 个账号；翻页后保留选择。</span>
            <button type="button" disabled={disabled || pagination.page <= 1} onClick={() => void onLoadProfilePage(pagination.page - 1)} className="tool-secondary-action text-xs">上一页</button>
            <button type="button" disabled={disabled || pagination.page >= pagination.total_pages} onClick={() => void onLoadProfilePage(pagination.page + 1)} className="tool-secondary-action text-xs">{pageLoading ? '加载中…' : '下一页'}</button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={disabled} onClick={onClose} className="tool-secondary-action">取消</button>
          <button type="button" disabled={disabled || selectedIds.length === 0} onClick={() => void download()} className="tool-primary-action">
            {busy ? '导出中…' : `导出所选账号（${selectedIds.length}）`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
