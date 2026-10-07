import { useRef, useState } from 'react'
import { ArrowUpRight, Search } from 'lucide-react'
import { copy } from '../../../copy'
import { legalContent, pageMeta, EFFECTIVE_DATE, type PublicInfoPageKind } from '../../PublicInfoPage'
import { usePublicContent } from '../../../lib/public-content-context'
import { productPolicies } from '../../../lib/product-catalog'
import { SupportGroupLink } from '../../../components/PublicFooter'
import { EmptyState, Notice, SectionTitle } from '../components/WorkspaceUI'

export default function Documents({ page }: { page: PublicInfoPageKind }) {
  if (page === 'faq') return <Help />
  if (page === 'support') return <Support />
  const sections = legalContent[page]
  return <article className="v2-legal-document">
    <div className="v2-document-meta"><span>{pageMeta[page].intro}</span><time>{copy.public.pages_PublicInfoPage_063}{EFFECTIVE_DATE}</time></div>
    <div className="v2-legal-layout"><div className="v2-legal-reading">{sections.map((section, index) => <section id={section.id} tabIndex={-1} key={section.id}><span className="v2-section-number">{String(index + 1).padStart(2, '0')}</span><h2>{section.heading}</h2>{section.paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)}{section.items && <ul>{section.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}</section>)}<section><h2>{copy.public.pages_PublicInfoPage_077}</h2><p>{copy.public.pages_PublicInfoPage_078}</p><SupportGroupLink className="v2-button v2-button-secondary" /></section></div><nav className="v2-document-index" aria-label={copy.v2.contents}><strong>{copy.v2.contents}</strong>{sections.map((section, index) => <a key={section.id} href={`#${section.id}`}><span>{String(index + 1).padStart(2, '0')}</span>{section.heading}</a>)}</nav></div>
  </article>
}

function Help() {
  const { content } = usePublicContent()
  const [search, setSearch] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const items = content.faq.items.filter((item) => terms.every((term) => `${item.question}\n${item.answer}`.toLocaleLowerCase().includes(term)))
  return <div className="v2-help-workspace"><div className="v2-help-search"><p className="v2-lead">{content.faq.intro}</p><label className="v2-field" htmlFor="v2-faq-search"><span>{copy.public.faq_search_label}</span><span className="v2-search"><Search size={18} aria-hidden="true" /><input id="v2-faq-search" ref={input} type="search" value={search} placeholder={copy.public.faq_search_placeholder} aria-describedby="v2-faq-results" onChange={(event) => setSearch(event.target.value)} /></span></label>{search && <button className="v2-text-button" onClick={() => { setSearch(''); input.current?.focus() }}>{copy.public.faq_search_clear}</button>}<p id="v2-faq-results" role="status" className="v2-muted">{terms.length ? copy.public.faq_search_results(items.length) : copy.public.faq_total(items.length)}</p></div>
    <section className="v2-help-answers" aria-label={copy.public.pages_PublicInfoPage_064}>{!items.length && <EmptyState title={copy.public.faq_search_empty}>{copy.public.faq_search_empty_hint}</EmptyState>}{items.map((item, index) => <details key={item.id} open={terms.length > 0 || undefined}><summary><span className="v2-section-number">{String(index + 1).padStart(2, '0')}</span><strong>{item.question}</strong><span aria-hidden="true">+</span></summary><div><p>{item.answer}</p>{item.action === 'qq_group' && <SupportGroupLink className="v2-button v2-button-secondary" />}</div></details>)}</section>
    <aside className="v2-help-contact"><SectionTitle title={content.faq.cta_heading} description={content.faq.cta_body} /><SupportGroupLink className="v2-button v2-button-primary" /></aside>
  </div>
}

function Support() {
  return <div className="v2-support-workspace"><section className="v2-support-entry"><ArrowUpRight size={32} aria-hidden="true" /><h2>{copy.public.pages_PublicInfoPage_067}</h2><p>{copy.public.pages_PublicInfoPage_068}</p><SupportGroupLink className="v2-button v2-button-primary" /></section>
    <div className="v2-support-preparation"><SectionTitle title={copy.public.pages_PublicInfoPage_069} /><ol className="v2-support-steps">{[copy.public.pages_PublicInfoPage_070, copy.public.pages_PublicInfoPage_071, copy.public.pages_PublicInfoPage_072].map((item, i) => <li key={item}><span className="v2-step-number">{i + 1}</span>{item}</li>)}</ol><SectionTitle title={copy.public.pages_PublicInfoPage_073} /><ul className="v2-prose-list">{[copy.public.pages_PublicInfoPage_074, copy.public.pages_PublicInfoPage_075, copy.public.pages_PublicInfoPage_076].map((item) => <li key={item}>{item}</li>)}</ul></div>
    <section className="v2-service-requests"><SectionTitle title={copy.public.pages_PublicInfoPage_079} description={copy.public.pages_PublicInfoPage_080} /><div className="v2-support-information"><ul>{productPolicies.support.required_information.map((item) => <li key={item}>{item}</li>)}</ul><ul>{productPolicies.support.forbidden_information.map((item) => <li key={item}>{item}</li>)}</ul></div><Notice>{productPolicies.support.sla_statement}</Notice></section>
  </div>
}
