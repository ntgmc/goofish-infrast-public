import type { Announcement } from '../lib/types'
import { Link } from 'react-router-dom'
import AnnouncementMarkdown from './AnnouncementMarkdown'
import { copy } from '../copy/index'


interface Props {
  announcement: Announcement | null;
  className?: string;
}

export default function AnnouncementBanner({ announcement, className = '' }: Props) {
  if (!announcement?.active || announcement.kind !== 'banner') return null

  return (
    <section
      className={`tool-alert border-brand-500/25 bg-brand-500/10 text-left ${className}`}
      aria-label={copy.public.components_AnnouncementBanner_001}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink-primary">{announcement.title}</h2>
          <AnnouncementMarkdown className="mt-1">{announcement.body}</AnnouncementMarkdown>
        </div>
        <Link
          to="/announcements"
          className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-brand-600 underline-offset-4 hover:underline"
        >
          {copy.public.components_AnnouncementBanner_002}</Link>
      </div>
    </section>
  )
}
