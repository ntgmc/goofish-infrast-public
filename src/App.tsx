import { lazy, Suspense, useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import BuildMetaStrip from './components/BuildMetaStrip'
import DeploymentUpdatePrompt from './components/DeploymentUpdatePrompt'
import MobileBrowserPrompt from './components/MobileBrowserPrompt'
import { motionTokens } from './components/MotionPrimitives'
import RouteLifecycle from './components/RouteLifecycle'
import RouteMetadata from './components/RouteMetadata'
import SessionLoader from './components/SessionLoader'
import V2LoadingScreen from './pages/v2/V2LoadingScreen'
import { copy } from './copy/index'
import { routesCopy } from './copy/zh-CN/routes'
import { ThemeProvider } from './lib/theme'
import { MotionPreferenceProvider, useAppReducedMotion } from './lib/motion-preference'
import { SiteFeatureProvider } from './lib/site-feature-context'
import { FeatureRoute } from './components/FeatureUnavailablePage'
import PublicContentRoute from './components/PublicContentRoute'
import { PublicContentProvider } from './lib/public-content-context'
import { apiVoid } from './lib/api-client'
import { categorizeBehaviorRiskPath } from './lib/behavior-risk-client'
import { recordDebugNavigation } from './lib/debug-diagnostics'
import QueryProvider from './lib/query-provider'
import { completeDeploymentRefresh } from './lib/deployment-refresh'
import { TaskDraftProvider } from './lib/task-drafts'
import { authModeForPath, authPath, USER_SESSION_EXPIRED_EVENT } from './lib/auth-navigation'
import { v2Href, v2Section } from './pages/v2/navigation'


const NotFoundPage = lazy(() => import('./components/NotFoundPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'))
const CancelAccountDeletionPage = lazy(() => import('./pages/CancelAccountDeletionPage'))
const AccountSafetyPage = lazy(() => import('./pages/AccountSafetyPage'))
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'))
const ChangelogPage = lazy(() => import('./pages/ChangelogPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AdminSetupPage = lazy(() => import('./pages/AdminSetupPage'))
const PublicInfoPage = lazy(() => import('./pages/PublicInfoPage'))
const PricingPage = lazy(() => import('./pages/PricingPage'))
const ThanksPage = lazy(() => import('./pages/ThanksPage'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const V2Page = lazy(() => import('./pages/v2/V2Page'))
const ValueClock = lazy(() => import('./pages/v2/pages/ValueClock'))
const AuthPage = lazy(() => import('./pages/v2/AuthPage'))

export default function App() {
  return (
    <QueryProvider><TaskDraftProvider><ThemeProvider>
      <MotionPreferenceProvider>
        <SiteFeatureProvider>
          <AnimatedApp />
        </SiteFeatureProvider>
      </MotionPreferenceProvider>
    </ThemeProvider></TaskDraftProvider></QueryProvider>
  )
}

function AnimatedApp() {
  const reduceMotion = useAppReducedMotion()
  return <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'} transition={{ duration: reduceMotion ? 0 : motionTokens.duration.enter, ease: motionTokens.ease.enter }}>
    <AppContent />
  </MotionConfig>
}

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => { completeDeploymentRefresh() }, [])

  useEffect(() => {
    const expired = () => {
      if (location.pathname.startsWith('/admin') || authModeForPath(location.pathname) || ['/verify-email', '/reset-password'].includes(location.pathname)) return
      void navigate(authPath('login', `${location.pathname}${location.search}${location.hash}`), { replace: true })
    }
    window.addEventListener(USER_SESSION_EXPIRED_EVENT, expired)
    return () => window.removeEventListener(USER_SESSION_EXPIRED_EVENT, expired)
  }, [location, navigate])

  useEffect(() => {
    recordDebugNavigation(location.pathname)
  }, [location.pathname])

  useEffect(() => {
    if (location.pathname.startsWith('/admin')) return
    void apiVoid('/api/user/behavior-risk/engagement', {
      method: 'POST',
      json: { page_category: categorizeBehaviorRiskPath(location.pathname) },
    }).catch(() => undefined)
  }, [location.pathname])

  const section = v2Section(new URLSearchParams(location.search), location.hash, location.pathname)
  const v2Page = <FeatureRoute feature="v2" renderPending={(status, retry) => <V2LoadingScreen
    error={status === 'error' ? copy.features.load_failed_body : null} onRetry={retry} retryLabel={copy.features.retry} />}>
    {section === 'value-clock'
      ? <FeatureRoute feature="base_value_dashboard"><Suspense fallback={<V2LoadingScreen />}><ValueClock /></Suspense></FeatureRoute>
      : <PublicContentProvider><Suspense fallback={<V2LoadingScreen />}><V2Page /></Suspense></PublicContentProvider>}</FeatureRoute>

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <RouteMetadata />
      <RouteLifecycle />
      <Routes>
        <Route path="/v1" element={<RetiredPageRedirect />} />
        <Route path="/tool/*" element={<RetiredPageRedirect />} />
        <Route element={<PublicContentRoute />}>
          <Route path="/changelog" element={<FeatureRoute feature="changelog"><LazyPage fallback={copy.common.App_014}><ChangelogPage /></LazyPage></FeatureRoute>} />
          <Route path="/faq" element={<FeatureRoute feature="faq"><LazyPage fallback={copy.common.App_003}><PublicInfoPage page="faq" /></LazyPage></FeatureRoute>} />
          <Route path="/support" element={<FeatureRoute feature="support"><LazyPage fallback={copy.common.App_004}><PublicInfoPage page="support" /></LazyPage></FeatureRoute>} />
          <Route path="/pricing" element={<FeatureRoute feature="pricing"><LazyPage fallback={copy.common.App_012}><PricingPage /></LazyPage></FeatureRoute>} />
          <Route path="/thanks" element={<FeatureRoute feature="thanks"><LazyPage fallback={copy.common.App_013}><ThanksPage /></LazyPage></FeatureRoute>} />
          <Route path="/status" element={<FeatureRoute feature="service_status"><LazyPage fallback={routesCopy.loading.status}><StatusPage /></LazyPage></FeatureRoute>} />
          <Route path="/privacy" element={<LazyPage fallback={copy.common.App_005}><PublicInfoPage page="privacy" /></LazyPage>} />
          <Route path="/terms" element={<LazyPage fallback={copy.common.App_006}><PublicInfoPage page="terms" /></LazyPage>} />
          <Route path="/disclaimer" element={<LazyPage fallback={copy.common.App_007}><PublicInfoPage page="disclaimer" /></LazyPage>} />
        </Route>
        <Route path="/" element={v2Page} />
        <Route path="/v2" element={v2Page} />
        <Route path="/v2/benchmarks" element={v2Page} />
        <Route path="/login" element={<Suspense fallback={<V2LoadingScreen />}><AuthPage /></Suspense>} />
        <Route path="/register" element={<Suspense fallback={<V2LoadingScreen />}><AuthPage /></Suspense>} />
        <Route path="/forgot-password" element={<Suspense fallback={<V2LoadingScreen />}><AuthPage /></Suspense>} />
        <Route path="/reset-password" element={<Suspense fallback={<V2LoadingScreen />}><ResetPasswordPage /></Suspense>} />
        <Route path="/verify-email" element={<Suspense fallback={<V2LoadingScreen />}><VerifyEmailPage /></Suspense>} />
        <Route path="/cancel-account-deletion" element={<LazyPage fallback={copy.features.loading}><CancelAccountDeletionPage /></LazyPage>} />
        <Route path="/account-safety" element={<LazyPage fallback={copy.features.loading}><AccountSafetyPage /></LazyPage>} />
        <Route path="/announcements" element={<FeatureRoute feature="announcements"><LazyPage fallback={copy.common.App_002}><AnnouncementsPage /></LazyPage></FeatureRoute>} />
        {['/tools/depot-value', '/tools/manual-schedule', '/tools/training-ratio', '/tools/cultivation-plan', '/tools/thanks-recruitment'].map((path) => <Route key={path} path={path} element={<RetiredPageRedirect />} />)}
        <Route path="/admin/setup" element={<LazyPage fallback={copy.common.App_010}><AdminSetupPage /></LazyPage>} />
        <Route path="/admin/*" element={<LazyPage fallback={copy.common.App_011}><AdminPage /></LazyPage>} />
        <Route path="*" element={<Suspense fallback={<V2LoadingScreen />}><NotFoundPage /></Suspense>} />
      </Routes>
      {import.meta.env.PROD && <DeploymentUpdatePrompt />}
      <MobileBrowserPrompt />
      {location.pathname !== '/' && location.pathname !== '/v2' && location.pathname !== '/v2/benchmarks' && <BuildMetaStrip placement="corner" />}
    </div>
  )
}

function RetiredPageRedirect() {
  const location = useLocation()
  return <Navigate to={v2Href(`${location.pathname}${location.search}${location.hash}`)} replace />
}

function LazyPage({ fallback, children }: { fallback: string; children: React.ReactNode }) {
  return (
    <Suspense fallback={<SessionLoader label={fallback} />}>
      {children}
    </Suspense>
  )
}
