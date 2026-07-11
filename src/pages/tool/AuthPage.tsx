import type { Announcement, AuthSuccessResponse } from '../../lib/types'
import AnnouncementBanner from '../../components/AnnouncementBanner'
import AuthForm from '../../components/AuthForm'
import BrandLogo from '../../components/BrandLogo'
import DeferredFeatureMenu from '../../components/DeferredFeatureMenu'

type AuthMode = 'login' | 'register' | 'forgot'

export default function AuthPage({
  announcement,
  onAuthenticated,
}: {
  announcement: Announcement | null
  onAuthenticated: (payload: AuthSuccessResponse) => void
}) {
  return (
    <main className="min-h-screen bg-surface-0 px-4 py-8 sm:px-6" tabIndex={-1} data-route-focus>
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <section className="rounded-xl border border-surface-3 bg-surface-1 p-6 sm:p-8">
          <div className="mb-5 flex items-start justify-between gap-4">
        <BrandLogo size="lg" />
            <DeferredFeatureMenu />
          </div>
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-ink-primary">MAA 基建排班工作台</h1>
          <p className="mt-3 text-sm leading-6 text-ink-secondary">
            使用邮箱和密码登录。注册时 CDK 可选；也可以先创建账号，登录后再添加多个游戏账号。
          </p>
          {announcement?.active && <AnnouncementBanner announcement={announcement} className="mt-6" />}
        </section>
        <AuthForm onAuthenticated={onAuthenticated} allowCdk />
  </div>
</main>
)
}

