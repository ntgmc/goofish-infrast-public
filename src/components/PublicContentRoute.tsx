import { Outlet } from 'react-router'
import { copy } from '../copy/index'
import { PublicContentProvider, usePublicContent } from '../lib/public-content-context'

export default function PublicContentRoute() {
  return (
    <PublicContentProvider>
      <PublicContentStatusNotice />
      <Outlet />
    </PublicContentProvider>
  )
}

function PublicContentStatusNotice() {
  const { status, isFallback, refresh } = usePublicContent()
  if (status === 'ready') return null
  const message = status === 'loading'
    ? isFallback ? copy.publicContent.status_loading_fallback : copy.publicContent.status_loading_cached
    : isFallback
      ? copy.publicContent.status_error_fallback
      : copy.publicContent.status_error_cached
  return (
    <div className="border-b border-warning/35 bg-warning/10 px-4 py-3 text-sm text-ink-secondary">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <p role={status === 'error' ? 'alert' : 'status'}>{message}</p>
        {status === 'error' && (
          <button type="button" onClick={() => void refresh()} className="tool-secondary-action px-3 text-sm">
            {copy.publicContent.status_retry}
          </button>
        )}
      </div>
    </div>
  )
}
