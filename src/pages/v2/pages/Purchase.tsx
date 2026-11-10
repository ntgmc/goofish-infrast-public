import { useState } from 'react'
import { useSearchParams } from 'react-router'
import Link from '../../../components/InternalLink'
import { ExternalLinkIcon, BackIcon, ExpandIcon } from '../../../components/icons'
import { copy } from '../../../copy'
import { PUBLIC_PRICING_PLAN_IDS } from '../../../lib/public-content'
import { usePublicContent } from '../../../lib/public-content-context'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import { Loading, Notice, SectionTitle } from '../components/WorkspaceUI'
import { v2Path } from '../navigation'

const text = copy.public.purchase

export default function Purchase() {
  const { content, status, isFallback, refresh } = usePublicContent()
  const { features } = useSiteFeatures()
  const [params] = useSearchParams()
  const profileId = params.get('profile_id')
  const offer = params.get('offer')
  const planId = PUBLIC_PRICING_PLAN_IDS.find((id) => id !== 'free_preview' && id === offer)
  const plan = planId ? content.pricing.plans[planId] : null
  const upgrade = offer === 'lifetime_upgrade'
  const details = plan ?? (upgrade ? content.pricing.lifetime_upgrade : !offer ? content.cdk_purchase : null)
  const href = details && ('purchase_url' in details ? details.purchase_url : details.xianyu_url)
  const available = Boolean(details && (href || details.share_image_url || details.qr_code_url))
  const redemptionAvailable = features.site && features.profiles && features.cdk_redemption
  const showPurchase = status === 'ready' && !isFallback && available

  return <div className="v2-purchase-workspace">
    <Link to={v2Path('pricing', profileId)} className="v2-text-button"><BackIcon size={16} aria-hidden="true" />{text.back}</Link>
    <div className="v2-purchase-overview">
    {status === 'loading' ? <Loading label={copy.features.loading} skeleton="cards" /> : status === 'error' || isFallback ? <Notice error>
      <p>{text.load_failed}</p><button type="button" className="v2-button v2-button-secondary" onClick={() => void refresh()}>{text.retry}</button>
    </Notice> : available && details ? <section className="v2-purchase-product" aria-labelledby="purchase-product-title">
          <div><h2 id="purchase-product-title">{plan?.label ?? (upgrade ? copy.public.pricing_upgrade_title : text.general)}</h2>
            {plan ? <><p className="v2-purchase-price">{plan.display_price}</p><p>{plan.account_scope}</p><p>{copy.public.pricing_redemption.activation}</p></> : <p>{upgrade ? copy.public.pricing_upgrade_description(content.pricing.lifetime_upgrade.service_fee) : text.description}</p>}
          </div>
          {href && <PurchaseLink key={href} href={href} />}
        </section> : <Notice>{text.unavailable}</Notice>}
    <section className="v2-purchase-redeem" aria-label={upgrade ? text.upgrade_result : text.redeem_title}>
      <h2>{upgrade ? text.upgrade_result : text.redeem_title}</h2>
      <p>{upgrade ? copy.public.pricing_upgrade_process : text.redeem_description}</p>
      {upgrade ? <div className="v2-actions">
        {features.support && <Link to="/support" className="v2-button v2-button-secondary">{copy.public.pricing_upgrade_contact}</Link>}
        {features.site && features.profiles && <Link to={v2Path('profiles', profileId)} className="v2-text-button">{text.check_profiles}</Link>}
      </div> : redemptionAvailable ? <div className="v2-actions">
        <Link to={`${v2Path('add-account', profileId)}&mode=cdk`} className="v2-button v2-button-secondary">{copy.public.pricing_redemption.action}</Link>
        <Link to={v2Path('profiles', profileId)} className="v2-text-button">{text.profiles}</Link>
      </div> : <p className="v2-muted">{copy.public.pricing_redemption.unavailable}</p>}
    </section>
    {showPurchase && details?.qr_code_url && <PurchaseImage key={`qr:${details.qr_code_url}`} src={details.qr_code_url} title={text.qr_code} help={text.qr_help} qr />}
    </div>
    {showPurchase && details && <div className="v2-purchase-layout">
      <section aria-label={text.flow_title}>
        <SectionTitle title={text.flow_title} />
        <ol className="v2-support-steps">{(upgrade ? text.upgrade_steps : text.steps).map((step, index) => <li key={step.title}>
          <span className="v2-step-number" aria-hidden="true">{index + 1}</span><div><strong>{step.title}</strong><p>{step.description}</p></div>
        </li>)}</ol>
        {content.cdk_purchase.instructions && <div className="v2-purchase-instructions"><h3>{text.instructions}</h3><p>{content.cdk_purchase.instructions}</p></div>}
      </section>
      {details.share_image_url && <details className="v2-purchase-share" open={!href && !details.qr_code_url}>
        <summary><span><strong>{text.share_image}</strong><small>{text.share_preview}</small></span><ExpandIcon size={18} aria-hidden="true" /></summary>
        <PurchaseImage key={`share:${details.share_image_url}`} src={details.share_image_url} title={text.share_image} help={text.share_help} />
      </details>}
    </div>}
  </div>
}

function PurchaseLink({ href }: { href: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(href)
      setCopied(true)
      setError(false)
    } catch {
      setCopied(false)
      setError(true)
    }
  }
  return <div className="v2-purchase-link">
    <div className="v2-actions">
      <a href={href} target="_blank" rel="noopener noreferrer" className="v2-button v2-button-primary">{text.open}<ExternalLinkIcon size={16} aria-hidden="true" /></a>
      <button type="button" className="v2-button v2-button-secondary" onClick={() => void copyLink()}>{text.copy}</button>
    </div>
    <details className="v2-purchase-link-details"><summary>{text.show_link}</summary>
      <label className="v2-field"><span>{text.link}</span><input className="v2-input" readOnly value={href} onFocus={(event) => event.currentTarget.select()} /></label>
    </details>
    {copied && <p role="status">{text.copied}</p>}{error && <p className="v2-error" role="alert">{text.copy_failed}</p>}
  </div>
}

function PurchaseImage({ src, title, help, qr = false }: { src: string; title: string; help: string; qr?: boolean }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  return <figure className={`v2-purchase-image${qr ? ' v2-purchase-qr' : ''}`}>
    <figcaption>{qr && <h2>{title}</h2>}<p>{help}</p></figcaption>
    {failed ? <div className="v2-purchase-image-error" role="alert"><p>{text.image_failed}</p><button type="button" className="v2-text-button" onClick={() => { setFailed(false); setAttempt((value) => value + 1) }}>{text.image_retry}</button></div>
      : <a href={src} target="_blank" rel="noopener noreferrer" aria-label={`${title} · ${text.original}`}><img key={attempt} src={src} alt={title} onError={() => setFailed(true)} /></a>}
    <a href={src} target="_blank" rel="noopener noreferrer" className="v2-text-button">{text.original}<ExternalLinkIcon size={14} aria-hidden="true" /></a>
  </figure>
}
