import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { copy } from '../../../copy'
import { apiJson, getApiErrorMessage } from '../../../lib/api-client'
import type { ChangelogPageData } from '../../../lib/changelog-contract'
import { EmptyState, Loading, Notice } from '../components/WorkspaceUI'

const titles = { feature: copy.public.pages_ChangelogPage_021, fix: copy.public.pages_ChangelogPage_022, performance: copy.public.pages_ChangelogPage_023, security: copy.public.pages_ChangelogPage_024 }

export default function Releases() {
  const location = useLocation()
  const navigate = useNavigate()
  const rawPage = Number(new URLSearchParams(location.search).get('page') ?? 1)
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const releaseId = location.hash.startsWith('#release-') ? location.hash.slice(9) : ''
  const client = useQueryClient()
  const key = ['public', 'changelog', page]
  const cached = client.getQueryData<ChangelogPageData>(key)
  const locate = releaseId && !cached?.releases.some((release) => release.id === releaseId) ? releaseId : ''
  const query = useQuery({ queryKey: locate ? [...key, locate] : key,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page) })
      if (locate) params.set('release', locate)
      return apiJson<ChangelogPageData>(`/api/changelog?${params}`, { signal })
    },
  })
  const lastPage = useRef<number | null>(null)
  const data = query.data ?? (lastPage.current ? client.getQueryData<ChangelogPageData>(['public', 'changelog', lastPage.current]) : undefined)
  const loading = query.isFetching
  const error = query.error ? getApiErrorMessage(query.error, copy.v2.updatesLoadFailed) : null

  useEffect(() => {
    if (!query.data || query.isFetching) return
    const data = query.data
    lastPage.current = data.page
    if (locate || data.page !== page) client.setQueryData(['public', 'changelog', data.page], data, { updatedAt: query.dataUpdatedAt })
    if (data.page !== page) {
      const search = new URLSearchParams(location.search)
      search.set('section', 'updates'); search.set('page', String(data.page))
      navigate({ search: `?${search}`, hash: location.hash }, { replace: true })
    }
  }, [query.data, query.dataUpdatedAt, query.isFetching, locate, page, location.search, location.hash, navigate, client])

  function openPage(nextPage: number, id = '') {
    const params = new URLSearchParams(location.search)
    params.set('section', 'updates')
    params.set('page', String(nextPage))
    navigate({ search: `?${params}`, hash: id ? `#release-${id}` : '' })
  }

  const selected = data?.releases.find((release) => release.id === releaseId) ?? (!releaseId ? data?.releases[0] : undefined)
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  return <div className="v2-releases">
    <p className="v2-lead">{copy.public.pages_ChangelogPage_003}</p>
    {error && <Notice error>{error}<button className="v2-text-button" onClick={() => void query.refetch({ cancelRefetch: false })}>{copy.v2.retry}</button></Notice>}
    {loading && <Loading label={copy.v2.updatesLoading} />}
    {data && <>
      <div className="v2-selection-workspace" aria-busy={loading}>
        <nav className="v2-release-index" aria-label={copy.public.pages_ChangelogPage_002}>
          {data.releases.map((release) => <button key={release.id} disabled={loading} aria-pressed={selected?.id === release.id} onClick={() => openPage(data.page, release.id)}><strong>{release.displayVersion}</strong><time dateTime={release.releasedAt}>{release.releasedAt}</time></button>)}
        </nav>
        {selected ? <article key={selected.id} className="v2-release-detail" aria-labelledby={`release-${selected.id}`}>
          <header><h2 id={`release-${selected.id}`}>{selected.displayVersion}</h2><time dateTime={selected.releasedAt}>{copy.public.pages_ChangelogPage_006}{selected.releasedAt}</time>{selected.targetSha && <code title={selected.targetSha}>{copy.public.pages_ChangelogPage_018}{selected.targetSha.slice(0, 7)}</code>}</header>
          {selected.sections.length > 0 ? selected.sections.map((section) => <section key={section.id}><h3>{section.title || (section.kind === 'custom' ? section.id : titles[section.kind])}</h3><ul>{section.items.map((item, i) => <li key={i}>{item}</li>)}</ul></section>) : <EmptyState title={selected.kind === 'baseline' ? copy.public.pages_ChangelogPage_019 : copy.public.pages_ChangelogPage_020} />}
        </article> : !loading && !error && <EmptyState title={releaseId ? copy.v2.updatesNotFound : copy.v2.noMatches} />}
      </div>
      <nav className="v2-actions" aria-label={copy.v2.updatesPagination}>
        <button className="v2-button v2-button-secondary" disabled={loading || data.page <= 1} onClick={() => openPage(data.page - 1)}>{copy.v2.previousPage}</button>
        <span aria-live="polite">{copy.v2.pageNumber(data.page, pages)}</span>
        <button className="v2-button v2-button-secondary" disabled={loading || data.page >= pages} onClick={() => openPage(data.page + 1)}>{copy.v2.nextPage}</button>
      </nav>
    </>}
  </div>
}
