import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import BuildMetaStrip from './components/BuildMetaStrip'
import RouteLifecycle from './components/RouteLifecycle'
import RouteMetadata from './components/RouteMetadata'
import SessionLoader from './components/SessionLoader'
import LandingPage from './pages/LandingPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import CancelAccountDeletionPage from './pages/CancelAccountDeletionPage'
import { copy } from './copy/index'
import { ThemeProvider } from './lib/theme'


const ToolPage = lazy(() => import('./pages/ToolPage'))
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AdminSetupPage = lazy(() => import('./pages/AdminSetupPage'))
const DepotValuePage = lazy(() => import('./pages/DepotValuePage'))
const ScheduleAnalysisPage = lazy(() => import('./pages/ScheduleAnalysisPage'))
const PublicInfoPage = lazy(() => import('./pages/PublicInfoPage'))
const PricingPage = lazy(() => import('./pages/PricingPage'))

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}

function AppContent() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <RouteMetadata />
      <RouteLifecycle />
      <Routes>
        <Route path="/" element={<LandingPage onStart={() => navigate('/tool/profiles')} />} />
        <Route path="/tool/*" element={<LazyPage fallback={copy.common.App_001}><ToolPage /></LazyPage>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/cancel-account-deletion" element={<CancelAccountDeletionPage />} />
        <Route path="/announcements" element={<LazyPage fallback={copy.common.App_002}><AnnouncementsPage /></LazyPage>} />
        <Route path="/faq" element={<LazyPage fallback={copy.common.App_003}><PublicInfoPage page="faq" /></LazyPage>} />
        <Route path="/support" element={<LazyPage fallback={copy.common.App_004}><PublicInfoPage page="support" /></LazyPage>} />
        <Route path="/pricing" element={<LazyPage fallback={copy.common.App_012}><PricingPage /></LazyPage>} />
        <Route path="/privacy" element={<LazyPage fallback={copy.common.App_005}><PublicInfoPage page="privacy" /></LazyPage>} />
        <Route path="/terms" element={<LazyPage fallback={copy.common.App_006}><PublicInfoPage page="terms" /></LazyPage>} />
        <Route path="/disclaimer" element={<LazyPage fallback={copy.common.App_007}><PublicInfoPage page="disclaimer" /></LazyPage>} />
        <Route path="/tools/schedule-analysis" element={<LazyPage fallback={copy.common.App_008}><ScheduleAnalysisPage /></LazyPage>} />
        <Route path="/tools/depot-value" element={<LazyPage fallback={copy.common.App_009}><DepotValuePage /></LazyPage>} />
        <Route path="/admin/setup" element={<LazyPage fallback={copy.common.App_010}><AdminSetupPage /></LazyPage>} />
        <Route path="/admin/*" element={<LazyPage fallback={copy.common.App_011}><AdminPage /></LazyPage>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BuildMetaStrip placement="corner" />
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
