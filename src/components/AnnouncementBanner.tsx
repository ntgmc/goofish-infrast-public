import type { Announcement } from '../lib/types'
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
      <div>
        <h2 className="text-sm font-semibold text-ink-primary">{announcement.title}</h2>
        <AnnouncementMarkdown className="mt-1">{announcement.body}</AnnouncementMarkdown>
      </div>
    </section>
  )
}
