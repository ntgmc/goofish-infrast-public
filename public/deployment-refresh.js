(() => {
  const dialog = document.getElementById('deployment-refresh')
  dialog.addEventListener('cancel', (event) => event.preventDefault())
  let reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  try { reduceMotion ||= ['true', 'reduced', 'off'].includes(localStorage.getItem('maatool-reduce-motion')) } catch { /* Use the system preference. */ }
  try {
    const key = 'maatool:deployment-refresh'
    const stored = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    const pending = JSON.parse(stored ?? 'null')
    const age = Date.now() - pending?.startedAt
    if (pending?.path !== location.pathname || !Number.isFinite(age) || age < 0 || age > 30_000) return
    dialog.dataset.restoring = 'true'
    dialog.style.setProperty('--deployment-refresh-delay', `${-age}ms`)
    dialog.toggleAttribute('data-reduced-motion', reduceMotion)
    dialog.showModal()
  } catch { /* A refresh remains usable when browser storage is unavailable. */ }
})()
