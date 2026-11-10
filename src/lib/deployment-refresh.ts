const REFRESH_KEY = 'maatool:deployment-refresh'

export function reloadDeployment(reloadPage: () => void | Promise<unknown>): void {
  const dialog = refreshDialog()
  if (!dialog) { reloadPage(); return }
  void showDeploymentRefresh().then(() => {
    try {
      sessionStorage.setItem(REFRESH_KEY, JSON.stringify({ path: location.pathname, startedAt: Number(dialog.dataset.startedAt) }))
    } catch { /* Reload still works when browser storage is unavailable. */ }
    void Promise.resolve(reloadPage()).catch(() => {
      try { sessionStorage.removeItem(REFRESH_KEY) } catch { /* Storage may be disabled. */ }
      void hideDeploymentRefresh()
    })
  })
}

export async function showDeploymentRefresh(): Promise<void> {
  const dialog = refreshDialog()
  if (!dialog) return
  dialog.dataset.startedAt = String(Date.now())
  dialog.style.removeProperty('--deployment-refresh-delay')
  dialog.toggleAttribute('data-reduced-motion', reducedMotion())
  if (!dialog.open) dialog.showModal()
  await fade(dialog, 0, 1, 180)
}

export async function hideDeploymentRefresh(): Promise<void> {
  const dialog = refreshDialog()
  if (!dialog?.open || dialog.dataset.closing) return
  dialog.dataset.closing = 'true'
  await fade(dialog, 1, 0, 240)
  dialog.close()
  delete dialog.dataset.closing
}

export function completeDeploymentRefresh(): void {
  const dialog = refreshDialog()
  if (!dialog?.dataset.restoring) return
  delete dialog.dataset.restoring
  // Let the new application's first frame paint beneath the retained loading surface.
  requestAnimationFrame(() => requestAnimationFrame(() => { void hideDeploymentRefresh() }))
}

function refreshDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>('#deployment-refresh')
}

function reducedMotion(): boolean {
  return document.documentElement.hasAttribute('data-reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches
}

async function fade(dialog: HTMLDialogElement, from: number, to: number, duration: number): Promise<void> {
  if (reducedMotion() || !dialog.animate) return
  const animation = dialog.animate([{ opacity: from }, { opacity: to }], { duration, easing: 'ease-in-out', fill: 'both' })
  try { await animation.finished } catch { /* Interrupted previews can close immediately. */ }
  animation.cancel()
}
