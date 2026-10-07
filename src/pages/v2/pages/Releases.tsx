import { useState } from 'react'
import { copy } from '../../../copy'
import { CHANGELOG_RELEASES } from '../../../lib/changelog'
import { EmptyState } from '../components/WorkspaceUI'

const titles = { feature: copy.public.pages_ChangelogPage_021, fix: copy.public.pages_ChangelogPage_022, performance: copy.public.pages_ChangelogPage_023, security: copy.public.pages_ChangelogPage_024 }

export default function Releases() {
  const [chosen, setChosen] = useState(CHANGELOG_RELEASES[0]?.id ?? '')
  const selected = CHANGELOG_RELEASES.find((release) => release.id === chosen) ?? CHANGELOG_RELEASES[0]
  return <div className="v2-releases"><p className="v2-lead">{copy.public.pages_ChangelogPage_003}</p><div className="v2-selection-workspace"><nav className="v2-release-index" aria-label={copy.public.pages_ChangelogPage_002}>{CHANGELOG_RELEASES.map((release) => <button key={release.id} aria-pressed={selected?.id === release.id} onClick={() => setChosen(release.id)}><strong>{release.displayVersion}</strong><time dateTime={release.releasedAt}>{release.releasedAt}</time></button>)}</nav>{selected ? <article className="v2-release-detail"><header><h2>{selected.displayVersion}</h2><time dateTime={selected.releasedAt}>{copy.public.pages_ChangelogPage_006}{selected.releasedAt}</time>{selected.targetSha && <code title={selected.targetSha}>{copy.public.pages_ChangelogPage_018}{selected.targetSha.slice(0, 7)}</code>}</header>{selected.sections.length > 0 ? selected.sections.map((section) => <section key={section.id}><h3>{section.title || (section.kind === 'custom' ? section.id : titles[section.kind])}</h3><ul>{section.items.map((item, i) => <li key={i}>{item}</li>)}</ul></section>) : <EmptyState title={selected.kind === 'baseline' ? copy.public.pages_ChangelogPage_019 : copy.public.pages_ChangelogPage_020} />}</article> : <EmptyState title={copy.v2.noMatches} />}</div></div>
}
