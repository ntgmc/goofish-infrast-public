import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Sparkles } from 'lucide-react'
import type { LicenseConfig } from '../lib/types'
import ConfigEditor from './ConfigEditor'
import { copy } from '../copy'

export default function ConfigCapabilityPreview({ config, enabled, children }: { config: LicenseConfig; enabled: boolean; children: ReactNode }) {
  const [preview, setPreview] = useState(false)
  const text = copy.optimize.paid_preview
  if (!enabled) return children
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border border-surface-3/60 bg-surface-2/50 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between" role="group" aria-label={text.config_views}>
        <button type="button" className={`tool-secondary-action w-full sm:w-auto ${!preview ? 'tool-option-selected' : ''}`} aria-pressed={!preview} onClick={() => setPreview(false)}>{text.current_config}</button>
        <button type="button" className={`tool-secondary-action w-full flex-wrap sm:w-auto ${preview ? 'tool-option-selected' : 'border-brand-500/40 bg-brand-500/10 text-brand-600 dark:text-brand-200'}`} aria-label={text.custom_config} aria-pressed={preview} onClick={() => setPreview(true)}>
          <Sparkles aria-hidden="true" className="size-4 shrink-0" />
          {text.custom_config}
          <span aria-hidden="true" className="rounded bg-brand-500/15 px-1.5 py-0.5 text-xs">{text.advanced}</span>
        </button>
      </div>
      {preview ? (
        <section aria-label={text.custom_config}>
          <div className="tool-inset mb-4 p-4">
            <p className="font-medium text-ink-primary">{text.config_title}</p>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">{text.config_description}</p>
            <Link to="/pricing" className="mt-2 inline-block text-sm text-brand-200 underline">{text.compare}</Link>
          </div>
          <fieldset disabled className="min-w-0" aria-label={text.readonly}>
            <ConfigEditor config={config} canEdit validation={{ ok: true }} onUpdate={() => {}} embedded note={text.readonly} />
          </fieldset>
        </section>
      ) : children}
    </div>
  )
}
