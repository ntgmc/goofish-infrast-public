import { useState } from 'react'
import { copy } from '../copy'
import { useSklandSnapshot } from '../hooks/useSklandSnapshot'
import { notifySklandAuthorization } from '../lib/skland-snapshot-client'
import { useSiteFeatures } from '../lib/site-feature-context'
import type { UserGameAccount } from '../lib/types'
import type { useToolSession } from '../pages/tool/useToolSession'
import { RefreshIcon } from './icons'
import SklandIcon from './SklandIcon'
import SklandBindingDialog from './SklandBindingDialog'

type Props = {
  session: ReturnType<typeof useToolSession>
  profile: UserGameAccount | null | undefined
  onRefresh?: () => void
  refreshing?: boolean
  refreshDisabled?: boolean
  authorizationRequired?: boolean
  onAuthorized?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export default function SklandDataActions(props: Props) {
  const { features } = useSiteFeatures()
  if (!features.skland || !props.session.user || !props.profile || props.profile.status !== 'active' || props.profile.archived_at) return null
  return <Actions key={`${props.session.user.id}:${props.profile.id}`} {...props} profile={props.profile} />
}

function Actions({ session, profile, onRefresh, refreshing, refreshDisabled, authorizationRequired, onAuthorized, open, onOpenChange }: Props & { profile: UserGameAccount }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [completed, setCompleted] = useState(false)
  const snapshot = useSklandSnapshot(session.user?.id, profile, false)
  const reauthorizing = Boolean(profile.skland_binding)
  const needsAuthorization = snapshot.needsAuthorization || authorizationRequired
  const changeOpen = (value: boolean) => { setDialogOpen(value); onOpenChange?.(value) }
  return <>
    {snapshot.errorCode === 'session_expired' ? <button type="button" className="v2-button v2-button-primary" onClick={session.retryAuth}>{copy.v2.login}</button> : <>
      {onRefresh && !needsAuthorization && <button type="button" className="v2-button v2-button-secondary" disabled={refreshDisabled || refreshing} aria-busy={refreshing}
        onClick={onRefresh}><RefreshIcon size={16} aria-hidden="true" />{refreshing ? copy.skland.refreshing : copy.skland.refresh}</button>}
      {(needsAuthorization || open || dialogOpen) && <button type="button" className="v2-button v2-button-primary" onClick={() => { setCompleted(false); changeOpen(true) }}>
        <SklandIcon />{reauthorizing ? copy.skland.reauthorize : copy.skland.bind}
      </button>}
    </>}
    {completed && <span role="status" className="v2-muted">{copy.skland.authorized}</span>}
    <SklandBindingDialog open={open ?? dialogOpen} profile={profile} context={profile.kind === 'depot_value' ? 'depot' : 'workspace'} autoStart
      purpose={reauthorizing ? 'reauthorize' : undefined} onOpenChange={changeOpen}
      onPayload={reauthorizing ? session.applySklandAuthorizationPayload : session.applyAuthPayload}
      onCompleted={() => {
        notifySklandAuthorization(session.user!.id, profile)
        changeOpen(false)
        setCompleted(reauthorizing)
        onAuthorized?.()
      }} />
  </>
}
