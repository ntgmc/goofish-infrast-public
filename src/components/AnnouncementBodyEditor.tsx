import { useState } from 'react'
import AnnouncementMarkdown from './AnnouncementMarkdown'

export const MAX_ANNOUNCEMENT_BODY_LENGTH = 5000

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

export default function AnnouncementBodyEditor({ id, value, onChange }: Props) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const editorId = `${id}-editor`
  const previewId = `${id}-preview`
  const countId = `${id}-count`

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink-secondary">正文</span>
        <div role="tablist" aria-label="公告正文模式" className="tool-inset inline-flex p-1">
          <button
            id={`${id}-edit-tab`}
            type="button"
            role="tab"
            aria-selected={mode === 'edit'}
            aria-controls={editorId}
            onClick={() => setMode('edit')}
            className={`tool-secondary-action min-h-11 border-transparent bg-transparent px-3 text-sm ${mode === 'edit' ? 'border-surface-3 bg-surface-0 text-ink-primary shadow-sm' : 'text-ink-secondary hover:border-transparent hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            编辑
          </button>
          <button
            id={`${id}-preview-tab`}
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            aria-controls={previewId}
            onClick={() => setMode('preview')}
            className={`tool-secondary-action min-h-11 border-transparent bg-transparent px-3 text-sm ${mode === 'preview' ? 'border-surface-3 bg-surface-0 text-ink-primary shadow-sm' : 'text-ink-secondary hover:border-transparent hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            预览
          </button>
        </div>
      </div>

      {mode === 'edit' ? (
        <div id={editorId} role="tabpanel" aria-labelledby={`${id}-edit-tab`} className="mt-2">
          <textarea
            id={`${id}-input`}
            value={value}
            maxLength={MAX_ANNOUNCEMENT_BODY_LENGTH}
            rows={10}
            onChange={(event) => onChange(event.currentTarget.value)}
            aria-describedby={countId}
            className="tool-field min-h-48 max-h-[50dvh] resize-y overflow-y-auto text-base leading-6 sm:min-h-56 sm:max-h-96 sm:text-sm"
          />
        </div>
      ) : (
        <div id={previewId} role="tabpanel" aria-labelledby={`${id}-preview-tab`} className="tool-inset mt-2 max-h-[50dvh] overflow-y-auto p-3 sm:max-h-96">
          {value ? <AnnouncementMarkdown>{value}</AnnouncementMarkdown> : <p className="text-sm text-ink-muted">暂无正文可预览。</p>}
        </div>
      )}

      <p id={countId} className="mt-2 text-xs text-ink-muted" aria-live="polite">
        {value.length} / {MAX_ANNOUNCEMENT_BODY_LENGTH.toLocaleString('zh-CN')} 字符
      </p>
    </div>
  )
}
