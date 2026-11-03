import { useEffect, useRef } from 'react'
import { AnimationIcon, AnnouncementIcon, CollapsedIcon, ComparisonIcon, FacilitiesIcon, GenerateIcon, HelpIcon, OperatorsIcon, OverviewIcon, PricingIcon, ProjectsIcon, ReleasesIcon, ResultHistoryIcon, ServiceStatusIcon, SupportIcon, ToolsIcon } from '../../components/icons'
import Link from '../../components/InternalLink'
import FeedbackButton from '../../components/FeedbackDialog'
import { copy } from '../../copy'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { OptionPanel, V2Session } from './OptionsDrawer'
import { sectionLabels, v2Path, v2SectionAvailable, type V2Section } from './navigation'

const text = copy.v2
const workspaceEntries = ['overview', 'generation', 'plans', 'lab'] as const
const utilityEntries = ['cultivation-projects', 'tools'] as const
const supportEntries = ['help', 'support'] as const
const productEntries = ['announcements', 'updates', 'benchmarks', 'pricing'] as const
const moreEntries = [...supportEntries, ...productEntries, 'status'] as const
const toolSections: V2Section[] = ['tools', 'manual-tool', 'schedule-comparison', 'cultivation', 'thanks-recruitment', 'training-ratio', 'material-demand', 'depot']
const icons = {
  overview: OverviewIcon, generation: GenerateIcon, plans: ResultHistoryIcon, lab: ComparisonIcon, 'cultivation-projects': ProjectsIcon, tools: ToolsIcon,
  announcements: AnnouncementIcon, pricing: PricingIcon, help: HelpIcon, support: SupportIcon, status: ServiceStatusIcon, updates: ReleasesIcon, benchmarks: ComparisonIcon,
}

export default function V2Navigation({ section, session, operatorCount, sampleOperators, onPanel, onClose }: {
  section: V2Section
  session: V2Session
  operatorCount: number
  sampleOperators: boolean
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
  function item(entry: typeof workspaceEntries[number] | typeof utilityEntries[number] | typeof moreEntries[number], label = sectionLabels[entry]) {
    if (!v2SectionAvailable(entry, features)) return null
    const Icon = icons[entry]
    const current = section === entry
    const active = current || entry === 'tools' && (toolSections.includes(section) || !signedIn && section === 'cultivation-projects')
    const contents = <><Icon size={19} aria-hidden="true" /><span>{label}</span>
      {entry === 'announcements' && session.announcementUnreadCount > 0 && <small>{session.announcementUnreadCount}</small>}</>
    return <Link key={entry} className={`v2-nav-item ${active ? 'v2-nav-active' : ''}`} to={v2Path(entry, session.activeProfile?.id)}
      aria-current={current ? 'page' : active ? 'location' : undefined} onClick={closeNavigation}>{contents}</Link>
  }
  return <nav aria-label={text.navigation}>
    <div className="v2-nav-scroll">
      <div className="v2-nav-section" role="group" aria-label={signedIn ? text.sidebar.schedule : text.guestNavigation.title}>
        <p className="v2-nav-label" aria-hidden="true">{signedIn ? text.sidebar.schedule : text.guestNavigation.title}</p>
        {signedIn ? workspaceEntries.map((entry) => item(entry)) : <>
          {item('overview', text.guestNavigation.example)}
          {item('generation', text.generateMine)}
          {item('tools')}
          {item('pricing', text.guestNavigation.pricing)}
        </>}
      </div>
      {signedIn && utilityEntries.some((entry) => v2SectionAvailable(entry, features)) && <div className="v2-nav-section" role="group" aria-label={text.sidebar.tools}>
        <p className="v2-nav-label" aria-hidden="true">{text.sidebar.tools}</p>
        {utilityEntries.map((entry) => item(entry))}
      </div>}
      <div className="v2-nav-section" role="group" aria-label={signedIn ? text.configuration : text.guestNavigation.configuration}>
        <p className="v2-nav-label" aria-hidden="true">{signedIn ? text.configuration : text.guestNavigation.configuration}</p>
        <div className="v2-config-shortcuts">
          <button type="button" className="v2-nav-item v2-config-shortcut" aria-label={text.operators} aria-describedby="v2-nav-operator-count" aria-haspopup="dialog" onClick={() => onPanel('operators')}>
            <OperatorsIcon size={19} aria-hidden="true" /><span>{text.operators}</span><small id="v2-nav-operator-count">{sampleOperators ? text.guestNavigation.operatorCount(operatorCount) : operatorCount}</small>
          </button>
          <button type="button" className="v2-nav-item v2-config-shortcut" aria-haspopup="dialog" onClick={() => onPanel('config')}><FacilitiesIcon size={19} aria-hidden="true" /><span>{text.facilities}</span></button>
        </div>
      </div>
    </div>
    <div className="v2-sidebar-bottom">
      <details ref={more} className="v2-nav-disclosure" onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
          && !document.querySelector('[data-slot="dialog-content"]')) event.currentTarget.open = false
      }} onKeyDown={(event) => {
        const disclosure = event.currentTarget
        if (!(event.target instanceof Node) || !disclosure.contains(event.target)) return
        if (event.key === 'Escape' && disclosure.open) {
          event.preventDefault()
          event.stopPropagation()
          disclosure.open = false
          disclosure.querySelector('summary')?.focus()
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !disclosure.open && ['Home', 'End'].includes(event.key)) return
        event.preventDefault()
        disclosure.open = true
        const entries = Array.from(disclosure.querySelectorAll<HTMLElement>('.v2-nav-extra a[href], .v2-nav-extra button:not(:disabled)'))
        const index = entries.indexOf(document.activeElement as HTMLElement)
        let next = index + (event.key === 'ArrowUp' ? -1 : 1)
        if (event.key === 'Home') next = 0
        if (event.key === 'End' || index < 0 && event.key === 'ArrowUp') next = entries.length - 1
        entries[(next + entries.length) % entries.length]?.focus()
      }}>
        <summary className={`v2-nav-item ${moreCurrent ? 'v2-nav-active' : ''}`}><HelpIcon size={19} aria-hidden="true" /><span>{text.navigationMore}</span>
          {features.announcements && session.announcementUnreadCount > 0 && <small aria-label={text.unreadAnnouncements(session.announcementUnreadCount)}>{session.announcementUnreadCount}</small>}
          <CollapsedIcon className="v2-nav-chevron" size={16} aria-hidden="true" />
        </summary>
        <div className="v2-nav-extra">
          {(signedIn || supportEntries.some((entry) => v2SectionAvailable(entry, features))) && <div className="v2-nav-group" role="group" aria-label={text.navigationGroups.support}>
            <p className="v2-nav-group-label" aria-hidden="true">{text.navigationGroups.support}</p>
            {supportEntries.map((entry) => item(entry, entry === 'support' ? text.contactSupport : sectionLabels[entry]))}
            {signedIn && <FeedbackButton className="v2-nav-item" profileId={session.activeProfile?.id} />}
          </div>}
          {productEntries.some((entry) => (signedIn || entry !== 'pricing') && v2SectionAvailable(entry, features)) && <div className="v2-nav-group" role="group" aria-label={text.navigationGroups.product}>
            <p className="v2-nav-group-label" aria-hidden="true">{text.navigationGroups.product}</p>
            {productEntries.filter((entry) => signedIn || entry !== 'pricing').map((entry) => item(entry, entry === 'pricing' ? text.guestNavigation.pricing : sectionLabels[entry]))}
          </div>}
          <div className="v2-sidebar-menu-links">
            <button type="button" className="v2-nav-item" onClick={() => onPanel('settings')}><AnimationIcon size={19} aria-hidden="true" /><span>{copy.dashboard.animation.settings}</span></button>
            {item('status')}
          </div>
        </div>
      </details>
    </div>
  </nav>
}
