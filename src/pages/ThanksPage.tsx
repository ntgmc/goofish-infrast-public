import { copy } from '../copy'
import { usePublicContent } from '../lib/public-content-context'
import PublicPageLayout from './v2/PublicPageLayout'

export default function ThanksPage() {
  const { content } = usePublicContent()
  const thanks = content.thanks
  return <PublicPageLayout title={thanks.title} description={thanks.intro}>
    {thanks.sections.map((section) => <section key={section.id} className="v2-thanks-section" aria-labelledby={`thanks-${section.id}`}>
      <h2 id={`thanks-${section.id}`} className="v2-subheading">{section.heading}</h2><p>{section.intro}</p>
      <div className="v2-thanks-list">{section.entries.map((entry) => <article key={entry.id}>
        {entry.avatar_url && <img src={entry.avatar_url} alt={copy.publicContent.thanks_github_avatar_alt.replace('{name}', entry.name)} loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
        <div><h3>{entry.url ? <a href={entry.url} target="_blank" rel="noopener noreferrer">{entry.name}</a> : entry.name}</h3>{entry.description && <p>{entry.description}</p>}</div>
      </article>)}</div>
    </section>)}
  </PublicPageLayout>
}
