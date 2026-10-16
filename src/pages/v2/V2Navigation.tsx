import type { MouseEventHandler } from 'react'
import { Activity, ArrowUpRight, Bell, BookOpen, Building2, CalendarClock, ChevronRight, FileClock, LayoutDashboard, LifeBuoy, RefreshCw, ScrollText, Settings2, Users, WalletCards } from 'lucide-react'
import Link from '../../components/InternalLink'
import FeedbackButton from '../../components/FeedbackDialog'
import { copy } from '../../copy'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { OptionPanel, V2Session } from './OptionsDrawer'
import { sectionLabels, v2Path, v2SectionAvailable, type V2Section } from './navigation'

const text = copy.v2
const workspaceEntries = ['overview', 'generation', 'plans', 'lab', 'tools'] as const
const personalEntries = ['profiles', 'inventory', 'commercial', 'balance', 'announcements', 'settings'] as const
const guestPersonalEntries = ['plans', 'lab', 'profiles', 'inventory', 'commercial', 'balance'] as const
const icons = {
  overview: LayoutDashboard, generation: RefreshCw, plans: FileClock, lab: Activity, tools: CalendarClock,
  profiles: Users, inventory: WalletCards, commercial: WalletCards, balance: WalletCards, announcements: Bell, settings: Settings2,
  pricing: WalletCards, help: BookOpen, support: LifeBuoy, status: Activity, updates: ScrollText,
}

export default function V2Navigation({ section, session, operatorCount, sampleOperators, onNavigate, onPanel, onClose, onLegacy }: {
  section: V2Section
  session: V2Session
  operatorCount: number
  sampleOperators: boolean
  onNavigate: (section: V2Section) => void
  onPanel: (panel: OptionPanel) => void
  onClose: () => void
  onLegacy: MouseEventHandler<HTMLAnchorElement>
}) {
  const { features } = useSiteFeatures()
  const signedIn = session.authStatus === 'authenticated' && Boolean(session.user)
  const personalCurrent = guestPersonalEntries.some((entry) => entry === section)
  function workspaceItem(entry: typeof workspaceEntries[number] | typeof personalEntries[number]) {
    if (!v2SectionAvailable(entry, features)) return null
    const Icon = icons[entry]
    return <button type="button" key={entry} className={`v2-nav-item ${section === entry ? 'v2-nav-active' : ''}`} aria-current={section === entry ? 'page' : undefined} onClick={() => onNavigate(entry)}>
      <Icon size={19} aria-hidden="true" /><span>{sectionLabels[entry]}</span>
      {entry === 'announcements' && session.announcementUnreadCount > 0 && <small>{session.announcementUnreadCount}</small>}
      {section === entry && <span className="v2-nav-dot" />}
    </button>
  }
  function publicItem(entry: 'overview' | 'generation' | 'pricing' | 'help' | 'support' | 'status' | 'updates', label = sectionLabels[entry]) {
    if (!v2SectionAvailable(entry, features)) return null
    const Icon = icons[entry]
    return <Link key={entry} className={`v2-nav-item ${section === entry ? 'v2-nav-active' : ''}`} to={v2Path(entry, session.activeProfile?.id)} aria-current={section === entry ? 'page' : undefined} onClick={onClose}>
      <Icon size={19} aria-hidden="true" /><span>{label}</span>{section === entry && <span className="v2-nav-dot" />}
    </Link>
  }
  const configuration = <>
    <p className="v2-nav-label">{signedIn ? text.configuration : text.guestNavigation.configuration}</p>
    <button type="button" className="v2-nav-item" aria-label={text.operators} aria-describedby="v2-nav-operator-count" onClick={() => onPanel('operators')}><Users size={19} aria-hidden="true" /><span>{text.operators}</span><small id="v2-nav-operator-count">{sampleOperators ? text.guestNavigation.operatorCount(operatorCount) : operatorCount}</small></button>
    <button type="button" className="v2-nav-item" onClick={() => onPanel('config')}><Building2 size={19} aria-hidden="true" /><span>{text.facilities}</span></button>
  </>
  const animationSettings = <button type="button" className="v2-nav-item" onClick={() => onPanel('settings')}><Settings2 size={19} aria-hidden="true" /><span>{copy.dashboard.animation.settings}</span></button>
  return <>
    <nav aria-label={text.navigation}>
      <p className="v2-nav-label">{signedIn ? text.workspace : text.guestNavigation.title}</p>
      {signedIn ? <>
        {workspaceEntries.map(workspaceItem)}
        {configuration}
        <p className="v2-nav-label">{text.personal}</p>
        {animationSettings}
        {personalEntries.map(workspaceItem)}
      </> : <>
        {publicItem('overview', text.guestNavigation.example)}
        {publicItem('generation', text.generateMine)}
        {publicItem('pricing', text.guestNavigation.pricing)}
        {publicItem('help')}
      </>}
      <div className="v2-sidebar-menu-links">
        {signedIn && publicItem('pricing', text.guestNavigation.pricing)}
        {publicItem('support')}
        {publicItem('status')}
      </div>
      {!signedIn && <>
        {configuration}
        <details className="v2-nav-disclosure" open={personalCurrent}>
          <summary className="v2-nav-item"><Users size={19} aria-hidden="true" /><span>{text.guestNavigation.personal}</span><small>{text.guestNavigation.signIn}</small><ChevronRight className="v2-nav-chevron" size={16} aria-hidden="true" /></summary>
          {guestPersonalEntries.map(workspaceItem)}
        </details>
      </>}
      <div className="v2-sidebar-menu-links">
        {!signedIn && <>{workspaceItem('tools')}{workspaceItem('announcements')}{animationSettings}</>}
        {publicItem('updates')}
        <Link className="v2-nav-item" to="/v1" onClick={onLegacy}><ArrowUpRight size={19} aria-hidden="true" /><span>{text.legacyEntry}</span></Link>
      </div>
    </nav>
    {signedIn && <div className="v2-sidebar-bottom">
      <FeedbackButton className="v2-help-link" profileId={session.activeProfile?.id} />
      {features.faq && <Link className="v2-help-link" to={v2Path('help', session.activeProfile?.id)} onClick={onClose}><BookOpen size={19} aria-hidden="true" /><span>{text.helpAction}</span><ArrowUpRight size={14} aria-hidden="true" /></Link>}
    </div>}
  </>
}
