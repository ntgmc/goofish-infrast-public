import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serviceBuildQueryOptions } from '../lib/service-build-query'
import { apiJson } from '../lib/api-client'
import type { ChangelogPageData } from '../lib/changelog-contract'
import { RefreshIcon as RefreshCw } from './icons'
import { APP_BUILD_META } from '../lib/build-meta'
import type { AppBuildMeta } from '../lib/types'
import { copy } from '../copy/index'
import { AnimatedPresenceRegion } from './MotionPrimitives'
import AnnouncementMarkdown from './AnnouncementMarkdown'
import './DeploymentUpdatePrompt.css'

const DEFAULT_POLL_INTERVAL_MS = 60_000
const SECTION_TITLES = {
  feature: copy.public.pages_ChangelogPage_021,
  fix: copy.public.pages_ChangelogPage_022,
  performance: copy.public.pages_ChangelogPage_023,
  security: copy.public.pages_ChangelogPage_024,
}

interface Props {
  meta?: AppBuildMeta
  pollIntervalMs?: number
  fetchHealth?: (signal: AbortSignal) => Promise<AppBuildMeta>
  reloadPage?: () => void
}

export default function DeploymentUpdatePrompt({
  meta = APP_BUILD_META,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  fetchHealth,
  reloadPage = reloadCurrentPage,
}: Props) {
  const [availableMeta, setAvailableMeta] = useState<AppBuildMeta | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const refreshButtonRef = useRef<HTMLButtonElement>(null)

  const query = useQuery({ ...serviceBuildQueryOptions,
    queryKey: fetchHealth ? ['public', 'service-build', 'custom'] : serviceBuildQueryOptions.queryKey,
    queryFn: fetchHealth ? async ({ signal }) => ({ meta: await fetchHealth(signal), ok: true }) : serviceBuildQueryOptions.queryFn,
    enabled: !availableMeta, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: pollIntervalMs,
  })
  const changelog = useQuery({
    queryKey: ['public', 'changelog', 1, 'deployment', availableMeta && deploymentIdentity(availableMeta)],
    queryFn: ({ signal }) => apiJson<ChangelogPageData>(
      `/api/changelog?page=1&release=${encodeURIComponent(`v${availableMeta!.frontend_version}`)}`,
      { signal },
    ),
    enabled: !!availableMeta,
  })
  const release = changelog.data?.releases.find((item) => item.version === availableMeta?.frontend_version)

  useEffect(() => {
    if (!availableMeta && !query.isFetching && query.data?.ok && isServiceDeploymentNewer(meta, query.data.meta)) setAvailableMeta(query.data.meta)
  }, [availableMeta, query.isFetching, query.data, meta])
  useEffect(() => {
    const onFocus = () => { if (!availableMeta && document.visibilityState === 'visible') void query.refetch({ cancelRefetch: false }) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [availableMeta, query.refetch])

  useEffect(() => {
    if (!availableMeta) return
    const dialog = dialogRef.current
    if (!dialog) return

    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    if (!dialog.open) dialog.showModal()
    refreshButtonRef.current?.focus()
    return () => {
      if (dialog.open) dialog.close()
      document.documentElement.style.overflow = previousOverflow
    }
  }, [availableMeta])

  if (!availableMeta) return null

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="deployment-update-title"
      aria-describedby="deployment-update-description"
      aria-modal="true"
      onCancel={handleCancel}
      className="v2-dialog deployment-update-dialog"
    >
      <AnimatedPresenceRegion motionKey={deploymentIdentity(availableMeta)} className="deployment-update-content">
        <header>
          <p className="deployment-update-label">{copy.common.components_DeploymentUpdatePrompt_001}</p>
          <h2 id="deployment-update-title">
            {copy.common.components_DeploymentUpdatePrompt_002}
          </h2>
        </header>
        <p id="deployment-update-description" className="deployment-update-description">
          {copy.common.components_DeploymentUpdatePrompt_003}
        </p>
        <dl className="deployment-update-versions">
          <div>
            <dt>{copy.common.components_DeploymentUpdatePrompt_004}</dt>
            <dd>{meta.frontend_version}</dd>
          </div>
          <div>
            <dt>{copy.common.components_DeploymentUpdatePrompt_005}</dt>
            <dd className="deployment-update-latest">{availableMeta.frontend_version}</dd>
          </div>
        </dl>
        <section className="deployment-update-notes" aria-labelledby="deployment-update-notes-title" aria-busy={changelog.isFetching} tabIndex={0}>
          <h3 id="deployment-update-notes-title">{copy.common.deploymentUpdateNotes}</h3>
          {changelog.isPending ? (
            <p role="status">{copy.v2.updatesLoading}</p>
          ) : changelog.isError ? (
            <p role="alert">
              {copy.v2.updatesLoadFailed}{' '}
              <button type="button" className="deployment-update-retry" onClick={() => void changelog.refetch({ cancelRefetch: false })}>
                {copy.v2.retry}
              </button>
            </p>
          ) : release?.sections.length ? (
            release.sections.map((section) => (
              <section key={section.id} className="deployment-update-section">
                <h4>{section.title || (section.kind === 'custom' ? section.id : SECTION_TITLES[section.kind])}</h4>
                <ul>
                  {section.items.map((item, index) => <li key={index}><AnnouncementMarkdown>{item}</AnnouncementMarkdown></li>)}
                </ul>
              </section>
            ))
          ) : (
            <p>{copy.public.pages_ChangelogPage_020}</p>
          )}
        </section>
        <div className="deployment-update-actions">
          <button
            ref={refreshButtonRef}
            type="button"
            onClick={reloadPage}
            className="tool-primary-action deployment-update-refresh"
          >
            <RefreshCw size={16} aria-hidden="true" />
            {copy.common.components_DeploymentUpdatePrompt_006}
          </button>
        </div>
      </AnimatedPresenceRegion>
    </dialog>
  )
}

function isServiceDeploymentNewer(current: AppBuildMeta, candidate: AppBuildMeta): boolean {
  if (deploymentIdentity(current) === deploymentIdentity(candidate)) return false
  const currentTime = deploymentTime(current)
  const candidateTime = deploymentTime(candidate)
  if (currentTime !== null && candidateTime !== null) return candidateTime > currentTime
  return candidate.frontend_version !== current.frontend_version
}

function deploymentIdentity(meta: AppBuildMeta): string {
  return `${meta.frontend_version}:${meta.git_sha ?? ''}`
}

function deploymentTime(meta: AppBuildMeta): number | null {
  const parsed = new Date(meta.build_generated_at ?? meta.generated_at).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function reloadCurrentPage(): void {
  window.location.reload()
}
