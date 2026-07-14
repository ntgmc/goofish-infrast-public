import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import BuildMetaStrip from './components/BuildMetaStrip'
import RouteLifecycle from './components/RouteLifecycle'
import LandingPage from './pages/LandingPage'
import ResetPasswordPage from './pages/ResetPasswordPage'

const ToolPage = lazy(() => import('./pages/ToolPage'))
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AdminSetupPage = lazy(() => import('./pages/AdminSetupPage'))
const DepotValuePage = lazy(() => import('./pages/DepotValuePage'))
const ScheduleAnalysisPage = lazy(() => import('./pages/ScheduleAnalysisPage'))
const PublicInfoPage = lazy(() => import('./pages/PublicInfoPage'))

export default function App() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <RouteLifecycle />
      <Routes>
        <Route path="/" element={<LandingPage onStart={() => navigate('/tool/profiles')} />} />
        <Route path="/tool/*" element={<LazyPage fallback="正在载入工作台..."><ToolPage /></LazyPage>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/announcements" element={<LazyPage fallback="正在载入公告..."><AnnouncementsPage /></LazyPage>} />
        <Route path="/faq" element={<LazyPage fallback="正在载入常见问题..."><PublicInfoPage page="faq" /></LazyPage>} />
        <Route path="/support" element={<LazyPage fallback="正在载入客服信息..."><PublicInfoPage page="support" /></LazyPage>} />
        <Route path="/privacy" element={<LazyPage fallback="正在载入隐私政策..."><PublicInfoPage page="privacy" /></LazyPage>} />
        <Route path="/terms" element={<LazyPage fallback="正在载入用户服务协议..."><PublicInfoPage page="terms" /></LazyPage>} />
        <Route path="/disclaimer" element={<LazyPage fallback="正在载入免责声明..."><PublicInfoPage page="disclaimer" /></LazyPage>} />
        <Route path="/tools/schedule-analysis" element={<LazyPage fallback="正在载入排班表分析..."><ScheduleAnalysisPage /></LazyPage>} />
        <Route path="/tools/depot-value" element={<LazyPage fallback="正在载入仓库价值分析器..."><DepotValuePage /></LazyPage>} />
        <Route path="/admin/setup" element={<LazyPage fallback="正在载入管理后台..."><AdminSetupPage /></LazyPage>} />
        <Route path="/admin/*" element={<LazyPage fallback="正在载入管理后台..."><AdminPage /></LazyPage>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BuildMetaStrip placement="corner" />
    </div>
  )
}

function LazyPage({ fallback, children }: { fallback: string; children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center px-6 text-ink-secondary">
        {fallback}
      </div>
    }>
      {children}
    </Suspense>
  )
}
