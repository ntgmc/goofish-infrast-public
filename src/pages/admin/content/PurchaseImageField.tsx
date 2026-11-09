import { useId, useState, type ChangeEvent } from 'react'
import { copy } from '../../../copy'
import { adminApiJson } from '../../../lib/admin-api-client'
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_TYPES, type ImageUpload } from '../../../lib/image-upload'

const text = copy.publicContent

export default function PurchaseImageField({ label, value, onChange, onUploadingChange, children }: {
  label: string
  value: string
  onChange: (value: string) => void
  onUploadingChange: (uploading: boolean) => void
  children: React.ReactNode
}) {
  const id = useId()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState(false)
  const [failedPreview, setFailedPreview] = useState<string | null>(null)
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setError(null)
    setUploaded(false)
    if (!file.size || !(IMAGE_UPLOAD_TYPES as readonly string[]).includes(file.type)) { setError(text.admin_image_invalid); return }
    if (file.size > IMAGE_UPLOAD_MAX_BYTES) { setError(text.admin_image_too_large); return }
    setUploading(true)
    onUploadingChange(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(new Error(text.admin_image_upload_failed))
        reader.readAsDataURL(file)
      })
      const result = await adminApiJson<{ url: string }>('/api/admin/public-content-image', {
        method: 'POST', json: { type: file.type as ImageUpload['type'], base64 }, fallbackMessage: text.admin_image_upload_failed,
      })
      onChange(result.url)
      setFailedPreview(null)
      setUploaded(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : text.admin_image_upload_failed)
    } finally { setUploading(false); onUploadingChange(false) }
  }
  return <fieldset className="min-w-0 space-y-3" aria-busy={uploading} disabled={uploading}>
    <legend className="mb-2 text-sm font-medium text-ink-secondary">{label}</legend>
    {value && (failedPreview === value ? <p className="text-sm text-error" role="alert">{text.admin_image_preview_failed}</p>
      : <a href={value} target="_blank" rel="noopener noreferrer" className="inline-block"><img src={value} alt={label} onError={() => setFailedPreview(value)} className="max-h-52 max-w-full rounded-md border border-surface-3 object-contain" /></a>)}
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="tool-secondary-action relative cursor-pointer focus-within:ring-2 focus-within:ring-brand-500">
        {uploading ? text.admin_image_uploading : value ? text.admin_image_replace : text.admin_image_upload}
        <input id={id} type="file" accept={IMAGE_UPLOAD_TYPES.join(',')} aria-label={`${label} · ${text.admin_image_upload}`} onChange={(event) => void upload(event)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
      {value && <button type="button" className="tool-secondary-action" onClick={() => { onChange(''); setUploaded(false); setError(null) }}>{text.admin_image_remove}</button>}
    </div>
    {children}
    {error && <p className="text-sm text-error" role="alert">{error}</p>}
    {uploaded && <p className="text-sm text-ink-secondary" role="status">{text.admin_image_uploaded}</p>}
  </fieldset>
}
