import { useEffect, useRef } from 'react'
import { AnimationIcon, AnnouncementIcon, CollapsedIcon, ComparisonIcon, FacilitiesIcon, GenerateIcon, HelpIcon, OperatorsIcon, OverviewIcon, PricingIcon, ProjectsIcon, ReleasesIcon, ResultHistoryIcon, ServiceStatusIcon, SupportIcon, ToolsIcon } from '../../components/icons'
import Link from '../../components/InternalLink'
import FeedbackButton from '../../components/FeedbackDialog'
import { copy } from '../../copy'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { OptionPanel, V2Session } from './OptionsDrawer'
import { sectionLabels, v2Path, v2SectionAvailable, type V2Section } from './navigation'

const text = copy.v2
const workspaceEntries = ['overview', 'generation', 'plans', 'lab', 'cultivation-projects', 'tools'] as const
const moreEntries = ['help', 'announcements', 'updates', 'benchmarks', 'pricing', 'support', 'status'] as const
const toolSections: V2Section[] = ['tools', 'manual-tool', 'schedule-comparison', 'cultivation', 'thanks-recruitment', 'training-ratio', 'material-demand', 'depot']
const icons = {
  overview: OverviewIcon, generation: GenerateIcon, plans: ResultHistoryIcon, lab: ComparisonIcon, 'cultivation-projects': ProjectsIcon, tools: ToolsIcon,
  announcements: AnnouncementIcon, pricing: PricingIcon, help: HelpIcon, support: SupportIcon, status: ServiceStatusIcon, updates: ReleasesIcon, benchmarks: ComparisonIcon,
}

export default function V2Navigation({ section, session, operatorCount, sampleOperators, onNavigate, onPanel, onClose }: {
  section: V2Section
  session: V2Session
  operatorCount: number
  sampleOperators: boolean
  onNavigate: (section: V2Section) => void
  onPanel: (panel: OptionPanel) => void
  onClose: () => void
}) {
  const { features } = useSiteFeatures()
  const more = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      // Keep the opener visible when a nested dialog restores focus.
      if (document.querySelector('[data-slot="dialog-content"]')) return
      if (more.current && event.target instanceof Node && !more.current.contains(event.target)) more.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside, true)
    return () => document.removeEventListener('pointerdown', closeOutside, true)
  }, [])
  function closeNavigation() {
    if (more.current) more.current.open = false
    onClose()
  }
  const signedIn = session.authStatus === 'authenticated' && Boolean(session.user)
  const moreCurrent = moreEntries.some((entry) => entry === section)
  function item(entry: typeof workspaceEntries[number] | typeof moreEntries[number], label = sectionLabels[entry]) {
    if (!v2SectionAvailable(entry, features)) return null
    const Icon = icons[entry]
    const current = section === entry
    const active = current || entry === 'tools' && (toolSections.includes(section) || !signedIn && section === 'cultivation-projects')
    const contents = <><Icon size={19} aria-hidden="true" /><span>{label}</span>
      {entry === 'announcements' && session.announcementUnreadCount > 0 && <small>{session.announcementUnreadCount}</small>}
      {active && <span className="v2-nav-dot" />}</>
    const className = `v2-nav-item ${active ? 'v2-nav-active' : ''}`
    return signedIn && workspaceEntries.some((workspace) => workspace === entry)
      ? <button type="button" key={entry} className={className} aria-current={current ? 'page' : undefined} onClick={() => onNavigate(entry)}>{contents}</button>
      : <Link key={entry} className={className} to={v2Path(entry, session.activeProfile?.id)} aria-current={current ? 'page' : undefined} onClick={closeNavigation}>{contents}</Link>
  }
  return <nav aria-label={text.navigation}>
      <p className="v2-nav-label">{signedIn ? text.workspace : text.guestNavigation.title}</p>
      {signedIn ? workspaceEntries.map((entry) => item(entry)) : <>
        {item('overview', text.guestNavigation.example)}
        {item('generation', text.generateMine)}
        {item('tools')}
        {item('pricing', text.guestNavigation.pricing)}
      </>}
      <p className="v2-nav-label">{signedIn ? text.configuration : text.guestNavigation.configuration}</p>
      <div className="v2-config-shortcuts">
        <button type="button" className="v2-config-shortcut" aria-label={text.operators} aria-describedby="v2-nav-operator-count" onClick={() => onPanel('operators')}>
          <OperatorsIcon size={20} aria-hidden="true" /><span>{text.operators}</span><small id="v2-nav-operator-count">{sampleOperators ? text.guestNavigation.operatorCount(operatorCount) : operatorCount}</small>
        </button>
        <button type="button" className="v2-config-shortcut" onClick={() => onPanel('config')}><FacilitiesIcon size={20} aria-hidden="true" /><span>{text.facilities}</span></button>
      </div>
    <div className="v2-sidebar-bottom">
      <details ref={more} className="v2-nav-disclosure" onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.open = false
        event.currentTarget.querySelector('summary')?.focus()
      }}>
        <summary className={`v2-nav-item ${moreCurrent ? 'v2-nav-active' : ''}`}><HelpIcon size={19} aria-hidden="true" /><span>{text.navigationMore}</span>
          {features.announcements && session.announcementUnreadCount > 0 && <small aria-label={text.unreadAnnouncements(session.announcementUnreadCount)}>{session.announcementUnreadCount}</small>}
          <CollapsedIcon className="v2-nav-chevron" size={16} aria-hidden="true" />
        </summary>
        <div className="v2-nav-extra">
          {moreEntries.filter((entry) => signedIn || entry !== 'pricing').map((entry) => item(entry, entry === 'pricing' ? text.guestNavigation.pricing : entry === 'support' ? text.contactSupport : sectionLabels[entry]))}
          <div className="v2-sidebar-menu-links">
            <button type="button" className="v2-nav-item" onClick={() => onPanel('settings')}><AnimationIcon size={19} aria-hidden="true" /><span>{copy.dashboard.animation.settings}</span></button>
            {signedIn && <FeedbackButton className="v2-nav-item" profileId={session.activeProfile?.id} />}
          </div>
        </div>
      </details>
    </div>
  </nav>
}
