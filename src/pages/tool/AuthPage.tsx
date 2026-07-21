import AnnouncementBanner from '../../components/AnnouncementBanner'
import AuthForm from '../../components/AuthForm'
import BrandLogo from '../../components/BrandLogo'
import DeferredFeatureMenu from '../../components/DeferredFeatureMenu'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import type { Announcement, AuthSuccessResponse } from '../../lib/types'
import { copy } from '../../copy/index'


export default function AuthPage({
  announcement,
  onAuthenticated,
}: {
  announcement: Announcement | null
  onAuthenticated: (payload: AuthSuccessResponse) => void
}) {
  return (
    <main className="tool-shell min-h-dvh px-4 py-5 sm:px-6 sm:py-8" tabIndex={-1} data-route-focus>
      <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-6xl flex-col sm:min-h-[calc(100dvh-4rem)]">
        {announcement?.active && <AnnouncementBanner announcement={announcement} className="mb-6 shrink-0" />}

        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(24rem,0.7fr)] lg:items-center lg:gap-16">
          <section className="max-w-xl py-4 sm:py-8">
            <div className="flex items-start justify-between gap-4">
              <BrandLogo size="lg" />
              <div className="flex flex-wrap justify-end gap-2">
                <ThemeSwitcher />
                <DeferredFeatureMenu />
              </div>
            </div>
            <p className="public-kicker mt-12">{copy.auth.pages_tool_AuthPage_001}</p>
            <h1 aria-label={copy.auth.pages_tool_AuthPage_002} className="display-title mt-4 text-4xl leading-[1.08] text-ink-primary sm:text-5xl">
              {copy.auth.pages_tool_AuthPage_003}</h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-ink-secondary">
              {copy.auth.pages_tool_AuthPage_004}</p>
            <dl className="landing-fact-strip mt-8">
              <AuthFact label={copy.auth.pages_tool_AuthPage_005} value={copy.auth.pages_tool_AuthPage_006} />
              <AuthFact label={copy.auth.pages_tool_AuthPage_007} value={copy.auth.pages_tool_AuthPage_008} />
              <AuthFact label={copy.auth.pages_tool_AuthPage_009} value="MAA JSON" />
            </dl>
          </section>

          <section className="tool-panel p-5 sm:p-7" aria-label={copy.auth.pages_tool_AuthPage_010}>
            <p className="section-index">{copy.auth.pages_tool_AuthPage_011}</p>
            <h2 className="mt-2 text-xl font-semibold text-ink-primary">{copy.auth.pages_tool_AuthPage_012}</h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.auth.pages_tool_AuthPage_013}</p>
            <div className="mt-6">
              <AuthForm onAuthenticated={onAuthenticated} allowCdk compact submitClassName="tool-primary-action min-h-12 w-full" />
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function AuthFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-4">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-ink-primary">{value}</dd>
    </div>
  )
}
