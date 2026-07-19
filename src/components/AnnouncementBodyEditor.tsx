import { useState } from 'react'
import { LayoutGroup } from 'motion/react'
import AnnouncementMarkdown from './AnnouncementMarkdown'
import { AnimatedPresenceRegion, MotionNavIndicator } from './MotionPrimitives'
import { copy, CURRENT_LOCALE } from '../copy/index'


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
        <span className="text-sm font-medium text-ink-secondary">{copy.public.components_AnnouncementBodyEditor_001}</span>
        <LayoutGroup id={`${id}-announcement-tabs`}>
        <div role="tablist" aria-label={copy.public.components_AnnouncementBodyEditor_002} className="tool-inset inline-flex p-1">
          <button
            id={`${id}-edit-tab`}
            type="button"
            role="tab"
            aria-selected={mode === 'edit'}
            aria-controls={editorId}
            onClick={() => setMode('edit')}
            className={`tool-secondary-action relative min-h-11 overflow-hidden border-transparent bg-transparent px-3 text-sm ${mode === 'edit' ? 'text-ink-primary' : 'text-ink-secondary hover:border-transparent hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            {mode === 'edit' && <MotionNavIndicator layoutId="announcement-mode-active" />}
            <span className="relative z-10">{copy.public.components_AnnouncementBodyEditor_003}</span></button>
          <button
            id={`${id}-preview-tab`}
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            aria-controls={previewId}
            onClick={() => setMode('preview')}
            className={`tool-secondary-action relative min-h-11 overflow-hidden border-transparent bg-transparent px-3 text-sm ${mode === 'preview' ? 'text-ink-primary' : 'text-ink-secondary hover:border-transparent hover:bg-surface-2 hover:text-ink-primary'}`}
          >
            {mode === 'preview' && <MotionNavIndicator layoutId="announcement-mode-active" />}
            <span className="relative z-10">{copy.public.components_AnnouncementBodyEditor_004}</span></button>
        </div>
        </LayoutGroup>
      </div>

      <AnimatedPresenceRegion motionKey={mode} id={mode === 'edit' ? editorId : previewId} role="tabpanel" labelledBy={`${id}-${mode}-tab`}>
      {mode === 'edit' ? (
        <div className="mt-2">
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
        <div className="tool-inset mt-2 max-h-[50dvh] overflow-y-auto p-3 sm:max-h-96">
          {value ? <AnnouncementMarkdown>{value}</AnnouncementMarkdown> : <p className="text-sm text-ink-muted">{copy.public.components_AnnouncementBodyEditor_005}</p>}
        </div>
      )}
      </AnimatedPresenceRegion>

      <p id={countId} className="mt-2 text-xs text-ink-muted" aria-live="polite">
        {value.length} / {MAX_ANNOUNCEMENT_BODY_LENGTH.toLocaleString(CURRENT_LOCALE)} {copy.public.components_AnnouncementBodyEditor_006}</p>
    </div>
  )
}
