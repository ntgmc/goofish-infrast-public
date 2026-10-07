import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { copy } from '../../../copy'
import AnnouncementMarkdown from '../../../components/AnnouncementMarkdown'
import { useUserAnnouncements } from '../../tool/dashboard/AnnouncementsSection'
import { usePublicAnnouncements } from '../../AnnouncementsPage'
import { formatShanghaiDateTime } from '../../tool/tool-utils'
import type { V2Session } from '../OptionsDrawer'
import { EmptyState, Loading, Notice } from '../components/WorkspaceUI'

const text = copy.dashboard

export default function Announcements({ session }: { session: V2Session }) {
  return session.user ? <Inbox onUnreadCountChange={session.setAnnouncementUnreadCount} /> : <PublicFeed />
}

function Inbox({ onUnreadCountChange }: { onUnreadCountChange: (count: number) => void }) {
  const model = useUserAnnouncements(onUnreadCountChange)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const items = model.items.filter((item) => !unreadOnly || !item.read_at)
  const selected = items.find((item) => item.announcement.id === selectedId) ?? items[0]
  if (model.loading && !model.items.length) return <Loading label={text.pages_tool_dashboard_AnnouncementsSection_006} />
  return <div className="v2-announcement-inbox"><Notice error>{model.error}{model.error && <button className="v2-text-button" onClick={() => void model.load()}>{copy.v2.retry}</button>}</Notice><div className="v2-inbox-toolbar"><div className="v2-filter-group"><button aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>{copy.v2.readAll}</button><button aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>{copy.v2.readUnread} {model.unreadCount}</button></div><button className="v2-text-button" disabled={model.loading || model.unreadCount === 0 || model.markingAll || model.markingId !== null} onClick={() => void model.markRead()}>{model.markingAll ? text.pages_tool_dashboard_AnnouncementsSection_004 : text.pages_tool_dashboard_AnnouncementsSection_005}</button></div>
    <div className="v2-selection-workspace v2-inbox-layout"><div className="v2-inbox-index">{items.map(({ announcement, read_at }) => <button key={announcement.id} aria-pressed={selected?.announcement.id === announcement.id} data-unread={!read_at} onClick={() => setSelectedId(announcement.id)}><time>{formatShanghaiDateTime(announcement.updated_at)}</time><strong>{announcement.title}</strong>{!read_at && <small>{text.pages_tool_dashboard_AnnouncementsSection_008}</small>}<ArrowRight size={16} aria-hidden="true" /></button>)}</div>
      {selected ? <article className="v2-announcement-reading"><time>{formatShanghaiDateTime(selected.announcement.updated_at)}</time><h2>{selected.announcement.title}</h2><AnnouncementMarkdown>{selected.announcement.body}</AnnouncementMarkdown>{!selected.read_at && <button className="v2-button v2-button-primary" disabled={model.markingAll || model.markingId === selected.announcement.id} onClick={() => void model.markRead(selected.announcement.id)}>{model.markingId === selected.announcement.id ? text.pages_tool_dashboard_AnnouncementsSection_010 : text.pages_tool_dashboard_AnnouncementsSection_011}</button>}</article> : <EmptyState title={text.pages_tool_dashboard_AnnouncementsSection_007} />}
    </div>
  </div>
}

function PublicFeed() {
  const model = usePublicAnnouncements()
  if (model.loading) return <Loading label={copy.public.pages_AnnouncementsPage_006} />
  return <div className="v2-public-feed"><p className="v2-lead">{copy.public.pages_AnnouncementsPage_004}</p><Notice error>{model.error}</Notice>{!model.error && !model.announcements.length && <EmptyState title={copy.public.pages_AnnouncementsPage_007} />}{model.announcements.map((announcement) => <article key={announcement.id}><time>{formatShanghaiDateTime(announcement.updated_at)}</time><div><h2>{announcement.title}</h2><AnnouncementMarkdown>{announcement.body}</AnnouncementMarkdown></div></article>)}</div>
}
