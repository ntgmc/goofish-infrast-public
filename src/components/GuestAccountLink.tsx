import { useId } from 'react'
import { Link, useLocation } from 'react-router'
import { copy } from '../copy'
import { authPath } from '../lib/auth-navigation'
import { useSiteFeatures } from '../lib/site-feature-context'
import { NextIcon } from './icons'
import './GuestAccountLink.css'

export default function GuestAccountLink({ label, description, inset = false }: { label: string; description?: string; inset?: boolean }) {
  const { features } = useSiteFeatures()
  const { pathname, search, hash } = useLocation()
  const labelId = useId()
  const descriptionId = `${labelId}-description`
  if (!features.login && !features.registration) return <p className="guest-account-unavailable" role="status">{copy.v2.guestAccount.unavailable}</p>
  const mode = features.login ? 'login' : 'register'
  return <Link to={authPath(mode, `${pathname}${search}${hash}`)} className={`guest-account-link${description ? ' guest-account-row' : ''}${inset ? ' guest-account-row-inset' : ''}`}
    aria-labelledby={labelId} aria-describedby={description ? descriptionId : undefined}>
    <span><strong id={labelId}>{mode === 'login' ? label : copy.auth.components_AuthForm_009}</strong>
      {description && <span className="guest-account-description" id={descriptionId}>{description}</span>}</span>
    <NextIcon size={16} aria-hidden="true" />
  </Link>
}
