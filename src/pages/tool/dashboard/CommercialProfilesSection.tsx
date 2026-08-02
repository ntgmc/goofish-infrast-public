import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { UserGameAccount } from '../../../lib/types'
import { apiJson, getApiErrorMessage } from '../../../lib/api-client'
import { copy } from '../../../copy/index'

type Limits = {
  active: number
  total: number
  active_limit: number
  total_limit: number
  suspended: boolean
  suspension_reason: string | null
  revision: number
  as_of: string
  inflight_jobs: number
  inflight_reserved: string
}
type Page = { profiles: UserGameAccount[]; next_cursor: string | null; limits: Limits }
type EditDraft = { profileId: string; displayName: string; note: string }

export default function CommercialProfilesSection({ onOpen }: { onOpen: (profile: UserGameAccount) => void }) {
  const [page, setPage] = useState<Page | null>(null)
  const [state, setState] = useState<'active' | 'archived'>('active')
  const [draftQuery, setDraftQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const requestSequence = useRef(0)
  const requestController = useRef<AbortController | null>(null)
  const batchRequest = useRef<{ signature: string; operationId: string } | null>(null)

  const load = useCallback(async (cursor?: string | null) => {
    const sequence = ++requestSequence.current
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ state, limit: '20' })
      if (appliedQuery) params.set('q', appliedQuery)
      if (cursor) params.set('cursor', cursor)
      const next = await apiJson<Page>(`/api/user/commercial/profiles?${params}`, { signal: controller.signal })
      if (sequence !== requestSequence.current) return
      setPage((current) => cursor && current ? {
        ...next,
        profiles: [...current.profiles, ...next.profiles.filter((profile) => !current.profiles.some((existing) => existing.id === profile.id))],
      } : next)
      if (!cursor) setSelectedIds(new Set())
    } catch (caught) {
      if (sequence === requestSequence.current && !isAbortError(caught)) {
        setError(getApiErrorMessage(caught, copy.metered.commercial_profiles.load_failed))
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [appliedQuery, state])

  useEffect(() => {
    void load()
    return () => requestController.current?.abort()
  }, [load])

  const create = async () => {
    if (!page) return
    setBusy('create'); setError(null); setNotice(null)
    try {
      await apiJson('/api/user/commercial/profiles', { method: 'POST', json: {}, fallbackMessage: copy.metered.commercial_profiles.create_failed })
      await load()
    } catch (caught) { setError(getApiErrorMessage(caught, copy.metered.commercial_profiles.create_failed)) }
    finally { setBusy(null) }
  }

  const mutate = async (profile: UserGameAccount, action: 'archive' | 'restore' | 'delete') => {
    if (action === 'delete' && !window.confirm(copy.metered.commercial_profiles.delete_confirm(profile.display_name))) return
    setBusy(profile.id); setError(null); setNotice(null)
    try {
      await apiJson('/api/user/commercial/profiles', action === 'delete' ? {
        method: 'DELETE', json: { profile_id: profile.id, confirm_permanent_delete: true },
      } : { method: 'PATCH', json: { profile_id: profile.id, action } })
      await load()
    } catch (caught) { setError(getApiErrorMessage(caught, copy.metered.commercial_profiles.update_failed)) }
    finally { setBusy(null) }
  }

  const saveEdit = async () => {
    if (!editDraft) return
    const displayName = editDraft.displayName.trim()
    if (!displayName) {
      setError(copy.metered.commercial_profiles.name_required)
      return
    }
    setBusy(editDraft.profileId); setError(null); setNotice(null)
    try {
      await apiJson('/api/user/commercial/profiles', {
        method: 'PATCH',
        json: { profile_id: editDraft.profileId, action: 'update', display_name: displayName, note: editDraft.note.trim() },
        fallbackMessage: copy.metered.commercial_profiles.update_failed,
      })
      setEditDraft(null)
      setNotice(copy.metered.commercial_profiles.edit_success)
      await load()
    } catch (caught) { setError(getApiErrorMessage(caught, copy.metered.commercial_profiles.update_failed)) }
    finally { setBusy(null) }
  }

  const search = (event: FormEvent) => {
    event.preventDefault()
    const next = draftQuery.trim()
    setPage(null)
    if (next === appliedQuery) void load()
    else setAppliedQuery(next)
  }

  const batchArchive = async () => {
    const profileIds = [...selectedIds].sort()
    if (profileIds.length === 0 || !window.confirm(copy.metered.commercial_profiles.batch_confirm(profileIds.length))) return
    const signature = profileIds.join(':')
    const request = batchRequest.current?.signature === signature
      ? batchRequest.current
      : { signature, operationId: crypto.randomUUID() }
    batchRequest.current = request
    setBusy('batch'); setError(null); setNotice(null)
    try {
      const result = await apiJson<{ results: Array<{ profile_id: string; status: 'archived' }>; replayed: boolean }>('/api/user/commercial/profiles', {
        method: 'PATCH',
        json: { action: 'batch_archive', profile_ids: profileIds, operation_id: request.operationId },
        fallbackMessage: copy.metered.commercial_profiles.batch_failed,
      })
      batchRequest.current = null
      setNotice(copy.metered.commercial_profiles.batch_success(result.results.length))
      await load()
    } catch (caught) { setError(getApiErrorMessage(caught, copy.metered.commercial_profiles.batch_partial)) }
    finally { setBusy(null) }
  }

  const activeProfiles = state === 'active' ? page?.profiles ?? [] : []
  const allVisibleSelected = activeProfiles.length > 0 && activeProfiles.every((profile) => selectedIds.has(profile.id))
  return <div className="space-y-4">
    <section className="tool-panel p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="tool-eyebrow">{copy.metered.commercial_profiles.eyebrow}</p><h2 className="mt-2 text-xl font-semibold text-ink-primary">{copy.metered.commercial_profiles.title}</h2><p className="mt-2 text-sm text-ink-secondary">{copy.metered.commercial_profiles.description}</p></div>
        <button type="button" onClick={() => void create()} disabled={!page || busy === 'create' || page.limits.suspended} className="tool-primary-action">{busy === 'create' ? copy.metered.commercial_profiles.creating : copy.metered.commercial_profiles.create}</button>
      </div>
      {page && <div className="tool-inset mt-4 p-4 text-sm text-ink-secondary">{copy.metered.commercial_profiles.limits(page.limits.active, page.limits.active_limit, page.limits.total, page.limits.total_limit)}{page.limits.suspended ? copy.metered.commercial_profiles.suspended(page.limits.suspension_reason ?? copy.metered.commercial_profiles.default_suspension_reason) : ''}</div>}
      {error && <div className="tool-alert tool-alert--error mt-4" role="alert">{error}{!page && <button type="button" className="ml-2 underline" onClick={() => void load()}>{copy.metered.commercial_profiles.retry}</button>}</div>}
      {notice && <div className="tool-alert tool-alert--success mt-4" role="status">{notice}</div>}
      <form onSubmit={search} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <select value={state} onChange={(event) => { setPage(null); setState(event.currentTarget.value as 'active' | 'archived') }} className="tool-field sm:w-36"><option value="active">{copy.metered.commercial_profiles.active_filter}</option><option value="archived">{copy.metered.commercial_profiles.archived_filter}</option></select>
        <input value={draftQuery} onChange={(event) => setDraftQuery(event.currentTarget.value)} className="tool-field flex-1" placeholder={copy.metered.commercial_profiles.search_placeholder} />
        <button className="tool-secondary-action" type="submit">{copy.metered.commercial_profiles.search}</button>
      </form>
      {state === 'active' && activeProfiles.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex min-h-10 items-center gap-2 text-sm text-ink-secondary">
          <input type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelectedIds(event.currentTarget.checked
            ? new Set(activeProfiles.map((profile) => profile.id))
            : new Set())} />
          {copy.metered.commercial_profiles.select_all_loaded}
        </label>
        <button type="button" disabled={selectedIds.size === 0 || busy !== null} onClick={() => void batchArchive()} className="tool-secondary-action">
          {busy === 'batch' ? copy.metered.commercial_profiles.archiving : copy.metered.commercial_profiles.batch_archive(selectedIds.size)}
        </button>
      </div>}
    </section>
    {loading && !page ? <div className="tool-panel p-6 text-sm text-ink-secondary" role="status">{copy.metered.commercial_profiles.loading}</div> : <section className="grid gap-3 xl:grid-cols-2">
      {(page?.profiles ?? []).map((profile) => <article key={profile.id} className="tool-panel p-5">
        {editDraft?.profileId === profile.id ? <div className="space-y-3">
          <label><span className="mb-1 block text-xs text-ink-muted">{copy.metered.commercial_profiles.name_label}</span><input className="tool-field" maxLength={40} value={editDraft.displayName} onChange={(event) => setEditDraft({ ...editDraft, displayName: event.currentTarget.value })} /></label>
          <label><span className="mb-1 block text-xs text-ink-muted">{copy.metered.commercial_profiles.note_label}</span><textarea className="tool-field min-h-24" maxLength={500} value={editDraft.note} onChange={(event) => setEditDraft({ ...editDraft, note: event.currentTarget.value })} /></label>
          <div className="flex gap-2"><button type="button" className="tool-primary-action" disabled={busy === profile.id} onClick={() => void saveEdit()}>{copy.metered.commercial_profiles.save}</button><button type="button" className="tool-secondary-action" disabled={busy === profile.id} onClick={() => setEditDraft(null)}>{copy.metered.commercial_profiles.cancel}</button></div>
        </div> : <>
          <div className="flex items-start gap-3">
            {state === 'active' && <input aria-label={copy.metered.commercial_profiles.select_profile(profile.display_name)} type="checkbox" checked={selectedIds.has(profile.id)} onChange={(event) => setSelectedIds((current) => {
              const next = new Set(current)
              event.currentTarget.checked ? next.add(profile.id) : next.delete(profile.id)
              return next
            })} />}
            <div><h3 className="font-semibold text-ink-primary">{profile.display_name}</h3><p className="mt-2 text-sm text-ink-secondary">{profile.note || copy.metered.commercial_profiles.no_note}</p></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {!profile.archived_at && <button type="button" className="tool-primary-action" onClick={() => onOpen(profile)}>{copy.metered.commercial_profiles.open_workspace}</button>}
            <button type="button" disabled={busy === profile.id} className="tool-secondary-action" onClick={() => setEditDraft({ profileId: profile.id, displayName: profile.display_name, note: profile.note ?? '' })}>{copy.metered.commercial_profiles.edit}</button>
            <button type="button" disabled={busy === profile.id} className="tool-secondary-action" onClick={() => void mutate(profile, profile.archived_at ? 'restore' : 'archive')}>{profile.archived_at ? copy.metered.commercial_profiles.restore : copy.metered.commercial_profiles.archive}</button>
            <button type="button" disabled={busy === profile.id} className="tool-danger-action" onClick={() => void mutate(profile, 'delete')}>{copy.metered.commercial_profiles.permanent_delete}</button>
          </div>
        </>}
      </article>)}
      {!loading && !(page?.profiles.length) && <div className="tool-panel p-6 text-sm text-ink-secondary">{copy.metered.commercial_profiles.empty}</div>}
    </section>}
    {page?.next_cursor && <button type="button" disabled={loading} onClick={() => void load(page.next_cursor)} className="tool-secondary-action w-full">{copy.metered.commercial_profiles.load_more}</button>}
  </div>
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
