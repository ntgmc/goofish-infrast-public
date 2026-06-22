import type { Announcement } from '../lib/types'

interface Props {
  announcement: Announcement | null;
  className?: string;
}

export default function AnnouncementBanner({ announcement, className = '' }: Props) {
  if (!announcement?.enabled) return null

  return (
    <section
      className={`rounded-lg border border-brand-500/25 bg-brand-500/10 px-4 py-3 text-left ${className}`}
      aria-label="站内公告"
    >
      <h2 className="text-sm font-semibold text-ink-primary">{announcement.title}</h2>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{announcement.body}</p>
    </section>
  )
}
