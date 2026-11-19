import { useEffect, useState } from 'react'
import { copy } from '../../../copy'
import { RefreshIcon, ConfigIcon } from '../../../components/icons'
import SklandIcon from '../../../components/SklandIcon'
import SklandBindingDialog from '../../../components/SklandBindingDialog'
import { Tabs } from '../../../components/ui/tabs'
import { useSklandSnapshot } from '../../../hooks/useSklandSnapshot'
import { sklandResourceState } from '../../../lib/skland-snapshot'
import SklandBackpack from './SklandBackpack'
import { SklandOverview, SklandInfrastructure } from './SklandGamePanels'
import type { V2Session } from '../OptionsDrawer'
import { Notice } from '../components/WorkspaceUI'
import { DataRefresh } from '../components/DataActivity'
import AccountChanges from '../AccountChanges'
import { snapshotChanges } from '../../../lib/account-changes'
import type { SklandSnapshot } from '../../../lib/skland-snapshot'
import { v2Path } from '../navigation'
import Link from '../../../components/InternalLink'
import PageHelp from './PageHelp'

const text = copy.skland

export default function Skland({ session, onOpenProfile, onProfiles, onConfig }: {
  session: V2Session
  onOpenProfile: (profile: V2Session['profiles'][number]) => Promise<void>
  onProfiles: () => void
  onConfig: () => void
}) {
  const [tab, setTab] = useState('overview')
  const [binding, setBinding] = useState(false)
  const profile = session.activeProfile
  const snapshot = useSklandSnapshot(session.user?.id, profile, true, 'live')
  const data = snapshot.data
  const [before, setBefore] = useState<SklandSnapshot | null>(null)
  const [refreshed, setRefreshed] = useState(false)
  const changes = before && data ? snapshotChanges(before, data) : null
  async function refresh() {
    setBefore(data)
    setRefreshed(false)
    const next = await snapshot.refresh()
    if (next) setRefreshed(true)
  }
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const remaining = data?.retryAt ? Date.parse(data.retryAt) - Date.now() : 0
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), remaining)
    return () => window.clearTimeout(timer)
  }, [data?.retryAt])
  const canRefresh = snapshot.available && !snapshot.busy && !(data?.retryAt && Date.parse(data.retryAt) > now)
  const game = data && ['fresh', 'stale'].includes(sklandResourceState(data.game.fetchedAt)) ? data.game.data : null
  const profiles = session.profiles.filter((entry) => entry.status === 'active' && !entry.archived_at)
  const rebind = !profile?.skland_binding || profile.skland_binding.credential_status === 'invalid'
  return <div className="space-y-5">
    <section className="v2-panel p-5 sm:p-6">
      <div className="skland-account-controls flex flex-wrap items-end justify-between gap-4">
        {profiles.length > 0 ? <label className="v2-field min-w-0 w-full sm:w-auto sm:flex-1 sm:max-w-sm"><span>{text.profile}</span>
          <select className="v2-input" value={profile?.id ?? ''} disabled={Boolean(session.openingProfileId)} onChange={(event) => {
            const next = profiles.find((entry) => entry.id === event.currentTarget.value)
            if (next) void onOpenProfile(next)
          }}>{!profile && <option value="" disabled>{text.manageAccounts}</option>}{profiles.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}</select>
        </label> : <button type="button" className="v2-button v2-button-secondary" onClick={onProfiles}>{text.manageAccounts}</button>}
        <div className="v2-actions">
          {profile && rebind ? <button type="button" className="v2-button v2-button-primary" onClick={() => setBinding(true)}><SklandIcon />{text.bind}</button>
            : profile && <button type="button" className="v2-button v2-button-secondary" aria-busy={snapshot.busy} disabled={!canRefresh}
              onClick={() => void refresh()}><RefreshIcon size={16} aria-hidden="true" />{snapshot.busy ? text.refreshing : text.refresh}</button>}
          {session.license && <button type="button" className="v2-button v2-button-secondary" onClick={onConfig}><ConfigIcon size={16} aria-hidden="true" />{text.configure}</button>}
        </div>
      </div>
      {rebind && <p className="mt-4 text-sm text-ink-secondary">{text.bindFirst}</p>}
      {snapshot.error && <Notice error>{snapshot.error}</Notice>}
      <DataRefresh pending={snapshot.busy} revision={data} error={Boolean(snapshot.error)}
        label={copy.v2.dataActivity.syncing} description={data ? copy.v2.dataActivity.current : undefined} skeleton={data ? undefined : 'cards'} />
      <p className="mt-4 text-sm leading-6 text-ink-secondary">{text.snapshotHelp}</p>
      {profile?.skland_binding && <p className="mt-2 text-sm text-ink-muted">UID {profile.skland_binding.uid}</p>}
    </section>
    <PageHelp page="skland" profileId={profile?.id} credentialInvalid={profile?.skland_binding?.credential_status === 'invalid'} inventoryIssue={Boolean(data?.inventory.error || !data?.inventory.items)} onAuthorize={profile ? () => setBinding(true) : undefined} onRefreshInventory={canRefresh ? () => void refresh() : undefined} />
    {refreshed && data && profile && session.user && <details className="v2-disclosure"><summary>{copy.v2.workspaceAssistant.changes}</summary>
      {changes ? <AccountChanges userId={session.user.id} profileId={profile.id} changes={changes}>
        {changes.length > 0 && <p className="v2-muted">{copy.v2.workspaceAssistant.gameNext} <Link className="v2-text-button" to={v2Path('cultivation-projects', profile.id)}>{copy.cultivationProjects.openProjects}</Link></p>}
      </AccountChanges> : <p className="v2-muted">{copy.v2.workspaceAssistant.changesMissing}</p>}
    </details>}
    {data && <Tabs.Root className="v2-data-arrival" value={tab} onValueChange={setTab}>
      <Tabs.List className="mb-5 flex border-b border-surface-3" aria-label={text.title}>
        {(['overview', 'backpack', 'infrastructure'] as const).map((entry) => <Tabs.Trigger key={entry} value={entry}
          className="min-h-11 flex-1 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-ink-secondary data-[state=active]:border-brand-500 data-[state=active]:text-ink-primary focus-visible:outline-2 focus-visible:outline-brand-500 sm:flex-none sm:px-6">{text[entry]}</Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value="overview" className="space-y-5">
        {game ? <SklandOverview game={game} lmd={data.inventory.lmd} exp={data.inventory.exp} /> : <Notice>{text.noGame}</Notice>}
        <DataTime value={data.game.fetchedAt} />
      </Tabs.Content>
      <Tabs.Content value="backpack" className="space-y-5"><SklandBackpack items={['fresh', 'stale'].includes(sklandResourceState(data.inventory.fetchedAt)) ? data.inventory.items : null} names={data.inventory.itemNames ?? {}} userId={session.user!.id} uid={data.uid} />
        <DataTime value={data.inventory.fetchedAt} />
      </Tabs.Content>
      <Tabs.Content value="infrastructure" className="space-y-5">
        {game?.building ? <SklandInfrastructure building={game.building} /> : <Notice>{text.noBuilding}</Notice>}
        <DataTime value={data.game.fetchedAt} />
      </Tabs.Content>
    </Tabs.Root>}
    <SklandBindingDialog key={profile?.id} open={binding} profile={profile} context={profile?.kind === 'depot_value' ? 'depot' : 'workspace'} autoStart
      onOpenChange={setBinding} onPayload={session.applyAuthPayload} onCompleted={() => { setBinding(false); snapshot.reload() }} />
  </div>
}

function DataTime({ value }: { value: string | null }) {
  return value ? <p className="text-sm text-ink-muted">{text.updated(new Date(value).toLocaleString('zh-CN'))}</p> : null
}
