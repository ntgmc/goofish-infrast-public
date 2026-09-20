import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { LicenseConfig } from '../lib/types'
import ConfigEditor from './ConfigEditor'
import { copy } from '../copy'

export default function ConfigCapabilityPreview({ config, enabled, children }: { config: LicenseConfig; enabled: boolean; children: ReactNode }) {
  const [preview, setPreview] = useState(true)
  const text = copy.optimize.paid_preview
  if (!enabled) return children
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={text.config_views}>
        <button type="button" className="tool-secondary-action" aria-pressed={!preview} onClick={() => setPreview(false)}>{text.current_config}</button>
        <button type="button" className="tool-secondary-action" aria-pressed={preview} onClick={() => setPreview(true)}>{text.custom_config}</button>
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
