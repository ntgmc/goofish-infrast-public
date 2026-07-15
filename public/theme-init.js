(() => {
  const systemTheme = () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  let theme

  try {
    const stored = localStorage.getItem('maatool-theme')
    theme = stored === 'light' || stored === 'dark' ? stored : systemTheme()
  } catch {
    theme = systemTheme()
  }

  document.documentElement.classList.add(theme)
  document.documentElement.style.colorScheme = theme
})()
