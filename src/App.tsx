import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import LandingPage from './pages/LandingPage'
import ToolPage from './pages/ToolPage'

const AdminPage = lazy(() => import('./pages/AdminPage'))
const AdminSetupPage = lazy(() => import('./pages/AdminSetupPage'))

type Route = 'home' | 'tool' | 'admin' | 'adminSetup'

function App() {
  const [route, setRoute] = useState<Route>(() => resolveRoute(window.location.pathname) ?? 'home')

  useEffect(() => {
    const syncRoute = () => {
      const nextRoute = resolveRoute(window.location.pathname)
      if (!nextRoute) {
        window.history.replaceState(null, '', '/')
        setRoute('home')
        return
      }
      setRoute(nextRoute)
    }

    syncRoute()
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  const navigateToTool = useCallback(() => {
    window.history.pushState(null, '', '/tool')
    setRoute('tool')
  }, [])

  if (route === 'admin' || route === 'adminSetup') {
    return (
      <div className="min-h-screen bg-surface-0 text-ink-primary">
        <Suspense fallback={
          <div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">
            正在载入管理后台...
          </div>
        }>
          {route === 'admin' ? <AdminPage /> : <AdminSetupPage />}
        </Suspense>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      {route === 'home' && <LandingPage onStart={navigateToTool} />}
      {route === 'tool' && <ToolPage />}
    </div>
  )
}

function resolveRoute(pathname: string): Route | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return 'home'
  if (path === '/tool') return 'tool'
  if (path === '/admin') return 'admin'
  if (path === '/admin/setup') return 'adminSetup'
  return null
}

export default App
