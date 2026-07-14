import AnnouncementBanner from '../../components/AnnouncementBanner'
import AuthForm from '../../components/AuthForm'
import BrandLogo from '../../components/BrandLogo'
import DeferredFeatureMenu from '../../components/DeferredFeatureMenu'
import type { Announcement, AuthSuccessResponse } from '../../lib/types'

export default function AuthPage({
  announcement,
  onAuthenticated,
}: {
  announcement: Announcement | null
  onAuthenticated: (payload: AuthSuccessResponse) => void
}) {
  return (
    <main className="tool-shell min-h-dvh px-4 py-5 sm:px-6 sm:py-8" tabIndex={-1} data-route-focus>
      <div className="mx-auto grid min-h-[calc(100dvh-2.5rem)] max-w-6xl gap-6 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(24rem,0.7fr)] lg:items-center lg:gap-16">
        <section className="max-w-xl py-4 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <BrandLogo size="lg" />
            <DeferredFeatureMenu />
          </div>
          <p className="tool-eyebrow mt-12">账号入口</p>
          <h1 className="sr-only">MAA 基建排班工作台</h1>
          <p className="mt-4 text-4xl font-semibold leading-[1.08] tracking-[-0.035em] text-ink-primary sm:text-5xl">
            准备数据，生成下一份排班。
          </p>
          <p className="mt-5 max-w-lg text-base leading-7 text-ink-secondary">
            登录后添加游戏账号，确认森空岛或 MAA 数据来源，再按当前干员池生成可导入的基建排班 JSON。
          </p>
          <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border border-surface-3 bg-surface-3 sm:grid-cols-3">
            <AuthFact label="数据确认" value="昵称与 UID" />
            <AuthFact label="安全边界" value="无需密码" />
            <AuthFact label="最终结果" value="MAA JSON" />
          </dl>
          {announcement?.active && <AnnouncementBanner announcement={announcement} className="mt-6" />}
        </section>

        <section className="tool-panel p-5 sm:p-7" aria-label="账号登录与注册">
          <p className="tool-eyebrow">继续到工作台</p>
          <h2 className="mt-2 text-xl font-semibold text-ink-primary">登录或创建账号</h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">注册时 CDK 可选；也可以先创建账号，再在账号页添加或兑换游戏档案。</p>
          <div className="mt-6">
            <AuthForm onAuthenticated={onAuthenticated} allowCdk compact submitClassName="tool-primary-action min-h-12 w-full" />
          </div>
        </section>
      </div>
    </main>
  )
}

function AuthFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-1 px-4 py-4">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-ink-primary">{value}</dd>
    </div>
  )
}
