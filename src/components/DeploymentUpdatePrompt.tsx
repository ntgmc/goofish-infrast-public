import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { APP_BUILD_META } from '../lib/build-meta'
import type { AppBuildMeta } from '../lib/types'
import { copy } from '../copy/index'
import { AnimatedPresenceRegion } from './MotionPrimitives'

const DEFAULT_POLL_INTERVAL_MS = 60_000

interface Props {
  meta?: AppBuildMeta
  pollIntervalMs?: number
  fetchHealth?: (signal: AbortSignal) => Promise<AppBuildMeta>
  reloadPage?: () => void
}

export default function DeploymentUpdatePrompt({
  meta = APP_BUILD_META,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  fetchHealth = requestServiceBuildMeta,
  reloadPage = reloadCurrentPage,
}: Props) {
  const [availableMeta, setAvailableMeta] = useState<AppBuildMeta | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const refreshButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let active = true
    let checking = false
    let updateDetected = false
    let timer: number | null = null
    let controller: AbortController | null = null

    const scheduleNextCheck = () => {
      if (!active || updateDetected) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(checkForUpdate, pollIntervalMs)
    }

    const checkForUpdate = () => {
      if (!active || checking || updateDetected) return
      checking = true
      controller = new AbortController()
      void fetchHealth(controller.signal)
        .then((candidate) => {
          if (!active || !isServiceDeploymentNewer(meta, candidate)) return
          updateDetected = true
          if (timer !== null) window.clearTimeout(timer)
          setAvailableMeta(candidate)
        })
        .catch(() => {
          // A transient health failure must not interrupt the current page.
        })
        .finally(() => {
          checking = false
          controller = null
          scheduleNextCheck()
        })
    }

    const handleFocus = () => checkForUpdate()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    }

    checkForUpdate()
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      active = false
      if (timer !== null) window.clearTimeout(timer)
      controller?.abort()
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchHealth, meta, pollIntervalMs])

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
      className="m-auto max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border-0 bg-transparent p-0 text-left backdrop:bg-black/55"
    >
      <section className="tool-panel w-full max-w-lg p-5 text-left shadow-xl">
        <AnimatedPresenceRegion motionKey={deploymentIdentity(availableMeta)}>
          <p className="tool-eyebrow">{copy.common.components_DeploymentUpdatePrompt_001}</p>
          <h2 id="deployment-update-title" className="mt-1 text-lg font-semibold text-ink-primary">
            {copy.common.components_DeploymentUpdatePrompt_002}
          </h2>
          <p id="deployment-update-description" className="mt-4 text-sm leading-7 text-ink-secondary">
            {copy.common.components_DeploymentUpdatePrompt_003}
          </p>
          <dl className="tool-inset mt-4 grid gap-2 px-4 py-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">{copy.common.components_DeploymentUpdatePrompt_004}</dt>
              <dd className="mt-1 break-all font-mono text-xs text-ink-secondary">{meta.frontend_version}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">{copy.common.components_DeploymentUpdatePrompt_005}</dt>
              <dd className="mt-1 break-all font-mono text-xs text-ink-secondary">{availableMeta.frontend_version}</dd>
            </div>
          </dl>
          <div className="mt-6 flex justify-end">
            <button
              ref={refreshButtonRef}
              type="button"
              onClick={reloadPage}
              className="tool-primary-action min-h-12"
            >
              {copy.common.components_DeploymentUpdatePrompt_006}
            </button>
          </div>
        </AnimatedPresenceRegion>
      </section>
    </dialog>
  )
}

async function requestServiceBuildMeta(signal: AbortSignal): Promise<AppBuildMeta> {
  const response = await fetch('/api/health', {
    signal,
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Service health check failed with ${response.status}.`)
  const payload = await response.json() as { build_meta?: AppBuildMeta }
  if (!payload.build_meta) throw new Error('Service health response is missing build metadata.')
  return payload.build_meta
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
