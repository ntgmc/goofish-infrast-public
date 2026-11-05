import { useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { RedemptionIcon, NextIcon } from '../../components/icons'
import { copy } from '../../copy'
import { getApiErrorMessage } from '../../lib/api-client'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { AuthSuccessResponse, UserGameAccount } from '../../lib/types'
import { upgradeProfileWithCdk } from '../tool/profile-redemption'
import { getProfileAccessLabel, isFreePreviewProfile } from '../tool/tool-utils'
import type { V2Session } from './OptionsDrawer'
import { Field, Notice, SectionTitle } from './components/WorkspaceUI'
import { v2Path } from './navigation'

const text = copy.v2.profileUpgrade

export function ProfileUpgradeEntry({ profile, onUpgrade, disabled = false }: {
  profile: UserGameAccount
  onUpgrade?: () => void
  disabled?: boolean
}) {
  const { features } = useSiteFeatures()
  const [params] = useSearchParams()
  if (!isFreePreviewProfile(profile) || !features.site || !features.profiles || (!features.cdk_redemption && !features.pricing)) return null
  return <section className="v2-profile-upgrade-entry" aria-label={text.title}>
    <div><strong>{getProfileAccessLabel(profile)}</strong><p>{text.description}</p></div>
    <div className="v2-actions">
      {features.cdk_redemption && (onUpgrade
        ? <button type="button" className="v2-button v2-button-primary" disabled={disabled} onClick={onUpgrade}><RedemptionIcon size={16} aria-hidden="true" />{text.action}</button>
        : <Link className="v2-button v2-button-primary" to={`${v2Path('add-account', profile.id)}&mode=upgrade`}><RedemptionIcon size={16} aria-hidden="true" />{text.action}</Link>)}
      {features.pricing && <Link className="v2-text-button" to={v2Path('pricing', params.get('profile_id'))}>{text.pricing}<NextIcon size={16} aria-hidden="true" /></Link>}
    </div>
  </section>
}

export default function ProfileUpgrade({ session, onUpgraded }: {
  session: V2Session
  onUpgraded: (payload: AuthSuccessResponse) => Promise<void>
}) {
  const { features } = useSiteFeatures()
  const [cdk, setCdk] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<{ cdk: string; idempotencyKey: string } | null>(null)
  const profile = session.activeProfile!

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (loading || !features.cdk_redemption) return
    setLoading(true)
    setError(null)
    try {
      if (!await session.flushConfigSave()) throw new Error(copy.v2.saveFailed)
      const normalizedCdk = cdk.trim()
      const pending = request.current?.cdk === normalizedCdk ? request.current : { cdk: normalizedCdk, idempotencyKey: crypto.randomUUID() }
      request.current = pending
      const payload = await upgradeProfileWithCdk({ profileId: profile.id, cdk: normalizedCdk, idempotencyKey: pending.idempotencyKey, fallbackMessage: copy.optimize.pages_tool_optimize_useOptimizeWorkflow_023 })
      request.current = null
      setCdk('')
      await onUpgraded(payload)
    } catch (caught) {
      setError(getApiErrorMessage(caught, copy.optimize.pages_tool_optimize_useOptimizeWorkflow_023))
    } finally {
      setLoading(false)
    }
  }

  return <form className="v2-account-registration v2-profile-upgrade-form" aria-label={text.title} onSubmit={submit}>
    <SectionTitle title={profile.display_name || copy.v2.account} description={text.description} />
    <Field label={copy.workspace.pages_tool_WorkspaceSetupPage_054} value={cdk} maxLength={256} required autoComplete="off" disabled={loading} onChange={(event) => { request.current = null; setCdk(event.target.value) }} placeholder="MAA-XXXX-XXXX-XXXX" />
    <Notice error>{error}</Notice>
    <div className="v2-actions"><button type="submit" className="v2-button v2-button-primary" disabled={loading}>{loading ? copy.workspace.pages_tool_WorkspaceSetupPage_055 : copy.workspace.pages_tool_WorkspaceSetupPage_056}</button>
      {features.pricing && <Link className="v2-button v2-button-secondary" to={v2Path('pricing', profile.id)}>{text.pricing}</Link>}
    </div>
    <div className="v2-actions"><Link className="v2-text-button" to={`${v2Path('add-account', profile.id)}&mode=cdk`}>{text.newProfile}<NextIcon size={16} aria-hidden="true" /></Link></div>
  </form>
}
