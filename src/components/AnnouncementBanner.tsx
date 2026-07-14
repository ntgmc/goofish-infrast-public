import type { Announcement } from '../lib/types'
import { Link } from 'react-router-dom'
import AnnouncementMarkdown from './AnnouncementMarkdown'

interface Props {
  announcement: Announcement | null;
  className?: string;
}

export default function AnnouncementBanner({ announcement, className = '' }: Props) {
  if (!announcement?.active || announcement.kind !== 'banner') return null

  return (
    <section
      className={`rounded-lg border border-brand-500/25 bg-brand-500/10 px-4 py-3 text-left ${className}`}
      aria-label="站内横幅"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink-primary">{announcement.title}</h2>
          <AnnouncementMarkdown className="mt-1">{announcement.body}</AnnouncementMarkdown>
        </div>
        <Link
          to="/announcements"
          className="shrink-0 text-sm font-semibold text-brand-600 underline-offset-4 hover:underline"
        >
          查看公告
        </Link>
      </div>
    </section>
  )
}
