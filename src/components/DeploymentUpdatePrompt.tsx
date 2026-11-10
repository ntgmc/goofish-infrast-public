import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serviceBuildQueryOptions } from '../lib/service-build-query'
import { apiJson } from '../lib/api-client'
import type { ChangelogPageData, ChangelogRelease } from '../lib/changelog-contract'
import { appBuildMetaSchema } from '../lib/app-build-meta-validation'
import { RefreshIcon as RefreshCw } from './icons'
import { APP_BUILD_META } from '../lib/build-meta'
import { reloadDeployment } from '../lib/deployment-refresh'
import type { AppBuildMeta } from '../lib/types'
import { copy } from '../copy/index'
import { AnimatedPresenceRegion } from './MotionPrimitives'
import AnnouncementMarkdown from './AnnouncementMarkdown'
import './DeploymentUpdatePrompt.css'

const DEFAULT_POLL_INTERVAL_MS = 60_000
const LAST_VISIT_KEY = 'maatool:last-visited-build'
const RECENT_RELEASE_LIMIT = 3
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
  reloadPage?: () => void | Promise<unknown>
}

export default function DeploymentUpdatePrompt({
  meta = APP_BUILD_META,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  fetchHealth,
  reloadPage = reloadCurrentPage,
}: Props) {
  const [previousMeta] = useState(readLastVisit)
  const [welcomeOpen, setWelcomeOpen] = useState(() => !!previousMeta && isServiceDeploymentNewer(previousMeta, meta))
  const [availableMeta, setAvailableMeta] = useState<AppBuildMeta | null>(null)
  const isWelcome = !availableMeta && welcomeOpen
  const promptMeta = availableMeta ?? (welcomeOpen ? meta : null)
  const query = useQuery({ ...serviceBuildQueryOptions,
    queryKey: fetchHealth ? ['public', 'service-build', 'custom'] : serviceBuildQueryOptions.queryKey,
    queryFn: fetchHealth ? async ({ signal }) => ({ meta: await fetchHealth(signal), ok: true }) : serviceBuildQueryOptions.queryFn,
    enabled: !availableMeta, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: pollIntervalMs,
  })
  const changelog = useQuery({
    queryKey: ['public', 'changelog', 1, 'deployment', promptMeta && deploymentIdentity(promptMeta), isWelcome ? previousMeta?.frontend_version : null],
    queryFn: async ({ signal }) => {
      if (isWelcome && previousMeta) {
        const { CHANGELOG_RELEASES, compareReleaseVersions } = await import('../lib/changelog')
        return CHANGELOG_RELEASES.filter((release) => release.version
          && compareReleaseVersions(release.version, previousMeta.frontend_version) < 0
          && compareReleaseVersions(release.version, meta.frontend_version) >= 0
          && release.sections.some((section) => section.items.length > 0)).slice(0, RECENT_RELEASE_LIMIT)
      }
      const page = await apiJson<ChangelogPageData>(
        `/api/changelog?page=1&release=${encodeURIComponent(`v${promptMeta!.frontend_version}`)}`,
        { signal },
      )
      return page.releases.filter((item) => item.version === promptMeta!.frontend_version)
    },
    enabled: !!promptMeta,
  })

  useEffect(() => { rememberVisit(meta) }, [meta])
  useEffect(() => {
    if (!availableMeta && !query.isFetching && query.data?.ok && isServiceDeploymentNewer(meta, query.data.meta)) setAvailableMeta(query.data.meta)
  }, [availableMeta, query.isFetching, query.data, meta])
  useEffect(() => {
    const onFocus = () => { if (!availableMeta && document.visibilityState === 'visible') void query.refetch({ cancelRefetch: false }) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [availableMeta, query.refetch])

  if (!promptMeta) return null

  return <DeploymentUpdateDialog
    isWelcome={isWelcome}
    previousVersion={isWelcome ? previousMeta!.frontend_version : meta.frontend_version}
    promptVersion={promptMeta.frontend_version}
    changelog={changelog}
    onDismiss={isWelcome ? () => setWelcomeOpen(false) : undefined}
    onContinue={() => {
      if (isWelcome) setWelcomeOpen(false)
      else {
        rememberVisit(promptMeta)
        reloadDeployment(reloadPage)
      }
    }}
  />
}

interface DialogProps {
  isWelcome: boolean
  previousVersion: string
  promptVersion: string
  changelog: {
    data?: ChangelogRelease[]
    isPending?: boolean
    isFetching?: boolean
    isError?: boolean
    refetch?: (options: { cancelRefetch: boolean }) => unknown
  }
  onContinue: () => void
  onDismiss?: () => void
  preview?: { label: string; close: string; refresh: string }
}

export function DeploymentUpdateDialog({ isWelcome, previousVersion, promptVersion, changelog, onContinue, onDismiss, preview }: DialogProps) {
  const id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const refreshButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const previousFocus = document.activeElement
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    if (!dialog.open) dialog.showModal()
    refreshButtonRef.current?.focus()
    return () => {
      if (dialog.open) dialog.close()
      document.documentElement.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => { refreshButtonRef.current?.focus() }, [isWelcome])

  const SectionHeading = isWelcome ? 'h5' : 'h4'

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onDismiss?.() }}
      className="v2-dialog deployment-update-dialog"
    >
      <AnimatedPresenceRegion motionKey={`${isWelcome}:${promptVersion}`} className="deployment-update-content">
        <header>
          <p className="deployment-update-label">{preview?.label ?? copy.common.components_DeploymentUpdatePrompt_001}</p>
          <h2 id={`${id}-title`}>
            {isWelcome ? copy.common.deploymentWelcomeTitle : copy.common.components_DeploymentUpdatePrompt_002}
          </h2>
        </header>
        <p id={`${id}-description`} className="deployment-update-description">
          {isWelcome ? copy.common.deploymentWelcomeDescription : copy.common.components_DeploymentUpdatePrompt_003}
        </p>
        <dl className="deployment-update-versions">
          <div>
            <dt>{isWelcome ? copy.common.deploymentPreviousVersion : copy.common.components_DeploymentUpdatePrompt_004}</dt>
            <dd>{previousVersion}</dd>
          </div>
          <div>
            <dt>{isWelcome ? copy.common.components_DeploymentUpdatePrompt_004 : copy.common.components_DeploymentUpdatePrompt_005}</dt>
            <dd className="deployment-update-latest">{promptVersion}</dd>
          </div>
        </dl>
        <section className="deployment-update-notes" aria-labelledby={`${id}-notes-title`} aria-busy={changelog.isFetching} tabIndex={0}>
          <h3 id={`${id}-notes-title`}>{isWelcome ? copy.common.deploymentRecentUpdates : copy.common.deploymentUpdateNotes}</h3>
          {changelog.isPending ? (
            <p role="status">{copy.common.deploymentNotesLoading}</p>
          ) : changelog.isError ? (
            <p role="alert">
              {copy.common.deploymentNotesLoadFailed}{' '}
              <button type="button" className="deployment-update-retry" onClick={() => void changelog.refetch?.({ cancelRefetch: false })}>
                {copy.common.deploymentNotesRetry}
              </button>
            </p>
          ) : changelog.data?.some((release) => release.sections.length > 0) ? (
            changelog.data.map((release) => (
              <article key={release.id} className="deployment-update-release">
                {isWelcome && <h4>{release.displayVersion} <time dateTime={release.releasedAt}>{release.releasedAt.slice(0, 10)}</time></h4>}
                {release.sections.map((section) => (
                  <section key={section.id} className="deployment-update-section">
                    <SectionHeading>{section.title || (section.kind === 'custom' ? section.id : SECTION_TITLES[section.kind])}</SectionHeading>
                    <ul>
                      {section.items.map((item, index) => <li key={index}><AnnouncementMarkdown>{item}</AnnouncementMarkdown></li>)}
                    </ul>
                  </section>
                ))}
              </article>
            ))
          ) : (
            <p>{isWelcome ? copy.common.deploymentWelcomeEmpty : copy.public.pages_ChangelogPage_020}</p>
          )}
        </section>
        <div className="deployment-update-actions">
          {isWelcome && <a className="deployment-update-history" href="/changelog">{copy.common.deploymentAllUpdates}</a>}
          {preview && <button type="button" className="v2-button v2-button-secondary" onClick={onDismiss}>{preview.close}</button>}
          <button
            ref={refreshButtonRef}
            type="button"
            onClick={onContinue}
            className="tool-primary-action deployment-update-refresh"
          >
            {!isWelcome && <RefreshCw size={16} aria-hidden="true" />}
            {isWelcome ? copy.common.deploymentWelcomeContinue : preview ? preview.refresh : copy.common.components_DeploymentUpdatePrompt_006}
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

function readLastVisit(): AppBuildMeta | null {
  try {
    const parsed = appBuildMetaSchema.safeParse(JSON.parse(window.localStorage.getItem(LAST_VISIT_KEY) ?? 'null'))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function rememberVisit(meta: AppBuildMeta): void {
  try {
    const previous = readLastVisit()
    // An older open tab must not erase a version already seen in another tab.
    if (!previous || isServiceDeploymentNewer(previous, meta)) window.localStorage.setItem(LAST_VISIT_KEY, JSON.stringify(meta))
  } catch { /* Storage may be disabled. */ }
}

function reloadCurrentPage(): void | Promise<unknown> {
  if (window.navigation) {
    const navigation = window.navigation.reload()
    void navigation.committed?.catch(() => undefined)
    return navigation.finished
  }
  window.location.reload()
}
