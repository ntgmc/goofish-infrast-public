import { lazy, Suspense, useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
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
import NotFoundPage from './components/NotFoundPage'
import { recordDebugNavigation } from './lib/debug-diagnostics'
import QueryProvider from './lib/query-provider'


const LandingPage = lazy(() => import('./pages/LandingPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'))
const CancelAccountDeletionPage = lazy(() => import('./pages/CancelAccountDeletionPage'))
const AccountSafetyPage = lazy(() => import('./pages/AccountSafetyPage'))
const ToolPage = lazy(() => import('./pages/ToolPage'))
const CultivationPlanPage = lazy(() => import('./pages/CultivationPlanPage'))
const ThanksRecruitmentPage = lazy(() => import('./pages/ThanksRecruitmentPage'))
const TrainingRatioPage = lazy(() => import('./pages/TrainingRatioPage'))
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'))
const ChangelogPage = lazy(() => import('./pages/ChangelogPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AdminSetupPage = lazy(() => import('./pages/AdminSetupPage'))
const DepotValuePage = lazy(() => import('./pages/DepotValuePage'))
const ManualSchedulePage = lazy(() => import('./pages/ManualSchedulePage'))
const PublicInfoPage = lazy(() => import('./pages/PublicInfoPage'))
const PricingPage = lazy(() => import('./pages/PricingPage'))
const ThanksPage = lazy(() => import('./pages/ThanksPage'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const V2Page = lazy(() => import('./pages/v2/V2Page'))

export default function App() {
  return (
    <QueryProvider><ThemeProvider>
      <MotionPreferenceProvider>
        <SiteFeatureProvider>
          <AnimatedApp />
        </SiteFeatureProvider>
      </MotionPreferenceProvider>
    </ThemeProvider></QueryProvider>
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

  const v2Page = <FeatureRoute feature="v2" renderPending={(status, retry) => <V2LoadingScreen
    error={status === 'error' ? copy.features.load_failed_body : null} onRetry={retry} retryLabel={copy.features.retry} />}>
    <PublicContentProvider><Suspense fallback={<V2LoadingScreen />}><V2Page /></Suspense></PublicContentProvider></FeatureRoute>

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <RouteMetadata />
      <RouteLifecycle />
      <Routes>
        <Route element={<PublicContentRoute />}>
          <Route path="/v1" element={<LazyPage fallback={copy.features.loading}><LandingPage onStart={() => navigate('/tool/profiles')} /></LazyPage>} />
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
        <Route path="/tool/*" element={<LazyPage fallback={copy.common.App_001}><ToolPage /></LazyPage>} />
        <Route path="/reset-password" element={<LazyPage fallback={copy.features.loading}><ResetPasswordPage /></LazyPage>} />
        <Route path="/verify-email" element={<LazyPage fallback={copy.features.loading}><VerifyEmailPage /></LazyPage>} />
        <Route path="/cancel-account-deletion" element={<LazyPage fallback={copy.features.loading}><CancelAccountDeletionPage /></LazyPage>} />
        <Route path="/account-safety" element={<LazyPage fallback={copy.features.loading}><AccountSafetyPage /></LazyPage>} />
        <Route path="/announcements" element={<FeatureRoute feature="announcements"><LazyPage fallback={copy.common.App_002}><AnnouncementsPage /></LazyPage></FeatureRoute>} />
        <Route path="/tools/depot-value" element={<FeatureRoute feature="depot_value"><LazyPage fallback={copy.common.App_009}><DepotValuePage /></LazyPage></FeatureRoute>} />
        <Route path="/tools/manual-schedule" element={<FeatureRoute feature="manual_schedule"><LazyPage fallback={routesCopy.loading['manual-tool']}><ManualSchedulePage /></LazyPage></FeatureRoute>} />
        <Route path="/tools/training-ratio" element={<FeatureRoute feature="tools"><LazyPage fallback={routesCopy.loading['training-ratio']}><TrainingRatioPage /></LazyPage></FeatureRoute>} />
        <Route path="/tools/cultivation-plan" element={<FeatureRoute feature="cultivation_plan"><LazyPage fallback={routesCopy.loading.cultivation}><CultivationPlanPage /></LazyPage></FeatureRoute>} />
        <Route path="/tools/thanks-recruitment" element={<FeatureRoute feature="thanks_recruitment"><LazyPage fallback={routesCopy.loading['thanks-recruitment']}><ThanksRecruitmentPage /></LazyPage></FeatureRoute>} />
        <Route path="/admin/setup" element={<LazyPage fallback={copy.common.App_010}><AdminSetupPage /></LazyPage>} />
        <Route path="/admin/*" element={<LazyPage fallback={copy.common.App_011}><AdminPage /></LazyPage>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <DeploymentUpdatePrompt />
      <MobileBrowserPrompt />
      {location.pathname !== '/' && location.pathname !== '/v2' && <BuildMetaStrip placement="corner" />}
    </div>
  )
}

function LazyPage({ fallback, children }: { fallback: string; children: React.ReactNode }) {
  return (
    <Suspense fallback={<SessionLoader label={fallback} />}>
      {children}
    </Suspense>
  )
}
