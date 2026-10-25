import { Link } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy } from '../copy'
import { useCultivation } from './CultivationPlanPage'
import { useToolSession } from './tool/useToolSession'
import { v2Path } from './v2/navigation'
import type { V2Session } from './v2/OptionsDrawer'
import { RefreshIcon } from '../components/icons'

const text = copy.tools.thanksRecruitment

type PageProps = { embedded?: boolean; session?: ReturnType<typeof useToolSession> }

export default function ThanksRecruitmentPage({ embedded = false, session }: PageProps = {}) {
  return session ? <ThanksRecruitmentContent embedded={embedded} session={session} /> : <StandaloneThanksRecruitment />
}

function StandaloneThanksRecruitment() {
  const session = useToolSession()
  return <ThanksRecruitmentContent embedded={false} session={session} />
}

function ThanksRecruitmentContent({ embedded, session }: { embedded: boolean; session: V2Session }) {
  const model = useCultivation(session)
  const queues = model.data?.thanksRecruitment?.queues ?? []
  const highestScore = Math.max(...queues.map((queue) => queue.expectedScore))
  return <div className={embedded ? 'v2-embedded-tool' : 'mx-auto max-w-7xl px-4 py-6 sm:px-6'}>
    {!embedded && <header className="mb-8 flex items-center justify-between gap-3"><Link to="/tool/tools" aria-label={text.back}><BrandLogo /></Link><div className="flex items-center gap-3"><Link to="/tool/tools" className="whitespace-nowrap text-sm text-ink-secondary hover:text-ink-primary">{text.back}</Link><ThemeSwitcher /></div></header>}
    <main className="space-y-6">
      <section className="tool-panel space-y-5 p-5 sm:p-6">
        {!embedded && <h1 className="text-2xl font-semibold">{text.title}</h1>}
        <p className="max-w-3xl text-sm leading-6 text-ink-secondary">{text.description}</p>
        {session.authLoading ? <p role="status">{text.loading}</p> : session.authStatus === 'error' ? <div role="alert"><p>{session.authError?.message}</p><button type="button" className="tool-secondary-action mt-3" onClick={session.retryAuth}>{copy.tools.pages_DepotValuePage_086}</button></div>
          : session.authStatus !== 'authenticated' || !model.profiles.length ? <div className="tool-inset space-y-3 p-4"><p className="text-sm">{session.authStatus !== 'authenticated' ? text.login : text.noProfile}</p><Link to={embedded ? v2Path('profiles', session.activeProfile?.id) : '/tool/profiles'} className="tool-secondary-action inline-flex">{text.loginAction}</Link></div>
            : <div className="flex flex-wrap items-end gap-4"><label className="min-w-0 flex-1 space-y-2 text-sm"><span className="block">{text.profile}</span><select className="tool-field" value={model.profileId} onChange={(event) => model.setChosenProfile(event.target.value)}><option value="" disabled>{text.profile}</option>{model.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name}</option>)}</select></label><button type="button" className="tool-primary-action inline-flex items-center gap-2 whitespace-nowrap" disabled={model.busy} onClick={() => void model.load()}><RefreshIcon size={16} aria-hidden="true" />{model.busy ? text.loadingData : text.refresh}</button></div>}
        {model.error && <p role="alert" className="tool-alert tool-alert--warning p-3 text-sm">{model.error}</p>}
      </section>
      {model.data?.thanksRecruitment && <>
        <section className="tool-inset space-y-2 p-4"><h2 className="text-sm font-semibold">{text.activity}</h2><p className="text-sm leading-6 text-ink-secondary">{model.data.thanksRecruitment.scope}</p><p className="text-xs leading-5 text-ink-muted">{text.scoreHint}</p></section>
        <section aria-label={text.title} className="grid gap-4 lg:grid-cols-2">{queues.map((queue) => <QueueCard key={queue.key} queue={queue} recommended={queue.expectedScore === highestScore} />)}</section>
      </>}
      {model.data && !model.data.thanksRecruitment && !model.busy && <p role="status" className="tool-alert tool-alert--warning p-4 text-sm">{text.unavailable}</p>}
    </main>
  </div>
}

function QueueCard({ queue, recommended }: { queue: NonNullable<NonNullable<ReturnType<typeof useCultivation>['data']>['thanksRecruitment']>['queues'][number]; recommended: boolean }) {
  return <article className={`tool-panel overflow-hidden ${recommended ? 'ring-2 ring-primary/60' : ''}`}>
    <header className="flex items-start justify-between gap-3 border-b border-surface-3 p-4">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">{queue.name}</h2>{recommended && <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">{text.recommended}</span>}</div><p className="mt-2 text-xs text-ink-secondary">{text.queue(queue.key)} · {text.ownership(queue.operators.length - queue.unownedCount, queue.unownedCount, queue.operators.length)}</p></div>
      <strong aria-label={`${queue.name} · ${text.score(queue.expectedScore)}`} className="inline-flex min-w-20 shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 px-3 py-2 text-2xl font-semibold leading-none tabular-nums text-brand-600">{text.expectedScore(queue.expectedScore)}</strong>
    </header>
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">{queue.operators.map((operator) => <div key={operator.operatorId} className={`flex min-w-0 items-center gap-2 rounded-md border p-2 ${operator.owned ? 'border-surface-3 bg-surface-1' : 'border-brand-500/30 bg-brand-500/5'}`}>
      <img src={`/webp96/${encodeURIComponent(operator.operatorId)}.webp`} alt={operator.name} loading="lazy" width={40} height={40} className="size-10 shrink-0 rounded object-cover" />
      <div className="min-w-0"><p className="truncate text-xs font-semibold" title={operator.name}>{operator.name}</p><p className="text-[11px] text-ink-secondary">{operator.owned ? text.owned : text.notOwned} · {text.score(operator.score)}</p></div>
    </div>)}</div>
  </article>
}
