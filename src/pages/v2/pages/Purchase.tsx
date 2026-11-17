import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import QRCode from 'qrcode'
import Link from '../../../components/InternalLink'
import { ExternalLinkIcon, BackIcon, ExpandIcon } from '../../../components/icons'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog'
import { copy } from '../../../copy'
import { PUBLIC_PRICING_PLAN_IDS } from '../../../lib/public-content'
import { usePublicContent } from '../../../lib/public-content-context'
import { useSiteFeatures } from '../../../lib/site-feature-context'
import type { UserGameAccount } from '../../../lib/types'
import { isFreePreviewProfile } from '../../tool/tool-utils'
import { Loading, Notice } from '../components/WorkspaceUI'
import { v2Path } from '../navigation'

const text = copy.public.purchase

export default function Purchase({ profile = null }: { profile?: UserGameAccount | null }) {
  const [params] = useSearchParams()
  const profileId = params.get('profile_id')
  return <div className="v2-purchase-page">
    <Link to={v2Path('pricing', profileId)} className="v2-text-button"><BackIcon size={16} aria-hidden="true" />{text.back}</Link>
    <PurchaseDetails offer={params.get('offer')} profileId={profileId} profile={profile} />
  </div>
}

export function PurchaseDialog({ offer, profileId, profile, onClose }: { offer: string | null; profileId: string | null; profile?: UserGameAccount | null; onClose: () => void }) {
  return <Dialog open={offer !== null} onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="v2-dialog v2-purchase-dialog" showCloseButton closeLabel={copy.v2.close}>
      <header className="v2-purchase-dialog-heading"><DialogTitle>{text.title}</DialogTitle><DialogDescription>{offer === 'lifetime_upgrade' ? text.upgrade_description : text.description}</DialogDescription></header>
      {offer !== null && <PurchaseDetails key={offer} offer={offer} profileId={profileId} profile={profile} />}
    </DialogContent>
  </Dialog>
}

function PurchaseDetails({ offer, profileId, profile }: { offer: string | null; profileId: string | null; profile?: UserGameAccount | null }) {
  const { content, status, isFallback, refresh } = usePublicContent()
  const { features } = useSiteFeatures()
  const planId = PUBLIC_PRICING_PLAN_IDS.find((id) => id !== 'free_preview' && id === offer)
  const plan = planId ? content.pricing.plans[planId] : null
  const upgrade = offer === 'lifetime_upgrade'
  const details = plan ?? (upgrade ? content.pricing.lifetime_upgrade : !offer ? content.cdk_purchase : null)
  const href = details ? ('purchase_url' in details ? details.purchase_url : details.xianyu_url) : ''
  const available = Boolean(details && (href || details.share_image_url))
  const redemptionAvailable = features.site && features.profiles && features.cdk_redemption
  const showPurchase = status === 'ready' && !isFallback && available
  const upgradeExisting = Boolean(profile && isFreePreviewProfile(profile) && profile.status === 'active' && !profile.archived_at)
  const redemptionPath = `${v2Path('add-account', profile?.id ?? profileId)}&mode=${upgradeExisting ? 'upgrade' : 'cdk'}`

  return <div className="v2-purchase-workspace">
    {status === 'loading' ? <Loading label={copy.features.loading} skeleton="cards" /> : status === 'error' || isFallback ? <Notice error>
      <p>{text.load_failed}</p><button type="button" className="v2-button v2-button-secondary" onClick={() => void refresh()}>{text.retry}</button>
    </Notice> : available && details ? <div className="v2-purchase-overview">
      <section className="v2-purchase-product" aria-labelledby="purchase-product-title">
        {plan && <span className="v2-label">{plan.badge}</span>}
        <h2 id="purchase-product-title">{plan?.label.replace(/\s*CDK$/u, '') ?? (upgrade ? copy.public.pricing_upgrade_title : text.general)}</h2>
        {plan ? <><p className="v2-purchase-price">{plan.display_price}</p><p>{text.account_scope}</p></> : <p>{upgrade ? copy.public.pricing_upgrade_description(content.pricing.lifetime_upgrade.service_fee) : text.description}</p>}
        {href && <PurchaseLink key={href} href={href} />}
        {!upgrade && <div className="v2-purchase-delivery"><p>{text.order_help}</p><p><strong>{text.delivery_title}</strong> · {text.delivery_help}</p>
          {features.support && <Link to={v2Path('support', profile?.id ?? profileId)} className="v2-text-button">{text.support_action}</Link>}
        </div>}
      </section>
      {(href || details.share_image_url) && <PurchaseMedia key={href || details.share_image_url} href={href} src={details.share_image_url} />}
    </div> : <Notice>{text.unavailable}</Notice>}
    <section className="v2-purchase-redeem" aria-label={upgrade ? text.upgrade_result : text.redeem_title}>
      <div><h2>{upgrade ? text.upgrade_result : text.redeem_title}</h2><p>{upgrade ? copy.public.pricing_upgrade_process : upgradeExisting ? text.upgrade_redeem_description(profile!.display_name || copy.v2.account) : text.redeem_description}</p></div>
      {upgrade ? <div className="v2-actions">
        {features.support && <Link to="/support" className="v2-button v2-button-secondary">{copy.public.pricing_upgrade_contact}</Link>}
        {features.site && features.profiles && <Link to={v2Path('profiles', profileId)} className="v2-text-button">{text.check_profiles}</Link>}
      </div> : redemptionAvailable ? <div className="v2-actions">
        <Link to={redemptionPath} className="v2-button v2-button-secondary">{upgradeExisting ? text.upgrade_redeem : text.redeem_action}</Link>
        {!upgradeExisting && <Link to={v2Path('profiles', profileId)} className="v2-text-button">{text.profiles}</Link>}
      </div> : <p className="v2-muted">{copy.public.pricing_redemption.unavailable}</p>}
    </section>
    {showPurchase && details && <>
      <details className="v2-purchase-instructions" open={upgrade}>
        <summary>{text.flow_title}<ExpandIcon size={16} aria-hidden="true" /></summary>
        <ol className="v2-support-steps">{(upgrade ? text.upgrade_steps : text.steps).map((step, index) => <li key={step.title}>
          <span className="v2-step-number" aria-hidden="true">{index + 1}</span><div><strong>{step.title}</strong><p>{step.description}</p></div>
        </li>)}</ol>
        {content.cdk_purchase.instructions && <div className="v2-purchase-instructions-note"><h3>{text.instructions}</h3><p>{content.cdk_purchase.instructions}</p></div>}
      </details>
      {href && details.share_image_url && <details className="v2-purchase-share">
        <summary>{text.share_preview}<ExpandIcon size={16} aria-hidden="true" /></summary>
        <PurchaseImage key={details.share_image_url} src={details.share_image_url} title={text.share_image} help={text.share_help} />
      </details>}
    </>}
  </div>
}

function PurchaseMedia({ href, src }: { href: string; src: string }) {
  const hasLink = Boolean(href)
  const [open, setOpen] = useState(() => !hasLink || !window.matchMedia?.('(max-width: 40rem)').matches)
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 40rem)')
    if (!query) return
    const update = () => setOpen(!hasLink || !query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [hasLink])
  return <details className="v2-purchase-media" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{text.scan}<ExpandIcon size={16} aria-hidden="true" /></summary>
    {href ? <PurchaseQrCode key={href} href={href} /> : <PurchaseImage src={src} title={text.share_image} help={text.share_help} />}
  </details>
}

function PurchaseQrCode({ href }: { href: string }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setFailed(false)
    void QRCode.toDataURL(href, { width: 320, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#1C242B', light: '#FFFFFF' } }).then(
      (url) => { if (active) setSrc(url) },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [href, attempt])
  if (src) return <PurchaseImage src={src} title={text.qr_code} help={text.qr_help} qr />
  return <figure className="v2-purchase-image v2-purchase-qr"><h3>{text.qr_code}</h3>
    {failed ? <div role="alert"><p>{text.qr_failed}</p><button type="button" className="v2-text-button" onClick={() => setAttempt((value) => value + 1)}>{text.qr_retry}</button></div>
      : <Loading label={text.qr_loading} />}
  </figure>
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
      <button type="button" className="v2-text-button" onClick={() => void copyLink()}>{text.copy}</button>
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
    <h3>{title}</h3>
    {failed ? <div className="v2-purchase-image-error" role="alert"><p>{text.image_failed}</p><button type="button" className="v2-text-button" onClick={() => { setFailed(false); setAttempt((value) => value + 1) }}>{text.image_retry}</button></div>
      : <a href={src} target={qr ? undefined : '_blank'} download={qr ? 'maatool-purchase.png' : undefined} rel="noopener noreferrer" aria-label={`${title} · ${qr ? text.qr_download : text.original}`}><img key={attempt} src={src} alt={title} onError={() => setFailed(true)} /></a>}
    <figcaption><p>{help}</p><a href={src} target={qr ? undefined : '_blank'} download={qr ? 'maatool-purchase.png' : undefined} rel="noopener noreferrer" className="v2-text-button">{qr ? text.qr_download : text.original}{!qr && <ExternalLinkIcon size={14} aria-hidden="true" />}</a></figcaption>
  </figure>
}
