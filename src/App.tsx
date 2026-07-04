import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import BuildMetaStrip from './components/BuildMetaStrip'
import LandingPage from './pages/LandingPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ToolPage from './pages/ToolPage'

const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AdminSetupPage = lazy(() => import('./pages/AdminSetupPage'))

type Route = 'home' | 'tool' | 'resetPassword' | 'announcements' | 'admin' | 'adminSetup'

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
        <BuildMetaStrip placement="corner" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      {route === 'home' && <LandingPage onStart={navigateToTool} />}
      {route === 'tool' && <ToolPage />}
      {route === 'resetPassword' && <ResetPasswordPage />}
      {route === 'announcements' && (
        <Suspense fallback={
          <div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">
            正在载入公告...
          </div>
        }>
          <AnnouncementsPage />
        </Suspense>
      )}
      <BuildMetaStrip placement="corner" />
    </div>
  )
}

function resolveRoute(pathname: string): Route | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return 'home'
  if (path === '/tool') return 'tool'
  if (path === '/reset-password') return 'resetPassword'
  if (path === '/announcements') return 'announcements'
  if (path === '/admin') return 'admin'
  if (path === '/admin/setup') return 'adminSetup'
  return null
}

export default App
