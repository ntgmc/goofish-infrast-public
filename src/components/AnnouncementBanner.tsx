import { ChevronDown, Megaphone } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
      className={`tool-alert tool-announcement border-s p-0 text-left ${className}`}
      aria-label={copy.public.components_AnnouncementBanner_001}
    >
      <details key={`${announcement.id}:${announcement.updated_at}`} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-2 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden">
          <Megaphone size={18} className="shrink-0 text-brand-600" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
            <span className="min-w-0 truncate font-semibold text-ink-primary group-open:wrap-anywhere group-open:whitespace-normal sm:max-w-[40%] sm:shrink-0 sm:group-open:max-w-none sm:group-open:shrink">{announcement.title}</span>
            <span className="min-w-0 truncate text-ink-secondary group-open:hidden" aria-hidden="true">
              <ReactMarkdown remarkPlugins={[remarkGfm]} allowedElements={[]} unwrapDisallowed skipHtml>{announcement.body}</ReactMarkdown>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-brand-600">
            <span className="group-open:hidden">{copy.public.components_AnnouncementBanner_002}</span>
            <span className="hidden group-open:inline">{copy.public.components_AnnouncementBanner_003}</span>
            <ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" />
          </span>
        </summary>
        <AnnouncementMarkdown className="mx-4 border-t border-surface-3 py-3">{announcement.body}</AnnouncementMarkdown>
      </details>
    </section>
  )
}
