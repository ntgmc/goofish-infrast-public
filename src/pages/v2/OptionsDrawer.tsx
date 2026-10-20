import { useRef, useState } from 'react'
import ConfigCapabilityPreview from '../../components/ConfigCapabilityPreview'
import type { ConfigDiffItem } from '../../lib/workspace-history'
import { NextIcon as ArrowRight, SelectedIcon as Check, LogoutIcon as LogOut, AccountIcon as UserRound, SuccessIcon } from '../../components/icons'
import AuthForm from '../../components/AuthForm'
import AnimationSettings from '../../components/AnimationSettings'
import ConfigEditor from '../../components/ConfigEditor'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { copy } from '../../copy'
import { validateScheduleConfig } from '../../lib/config'
import { useSiteFeatures } from '../../lib/site-feature-context'
import { METERED_BILLING_AVAILABLE } from '../../lib/site-features'
import type { DailyProduction, LicenseConfig, LicenseOperator, PermissionMode } from '../../lib/types'
import type { BoardRoom } from '../../components/result-panel/ResultBoardV2'
import type { useToolSession } from '../tool/useToolSession'
import { Avatar, roomLevelLabel } from './ScheduleBoard'
import { getProfileAccessLabel, isFreePreviewProfile } from '../tool/tool-utils'
import ConfigSaveStatus from '../tool/workspace/ConfigSaveStatus'
import V2Transition from './V2Transition'
import BuildingSkills from './BuildingSkills'
import OperatorManagementPanel from './OperatorManagementPanel'
import { RoomProduction } from './IncomeAnalysis'
import type { V2Section } from './navigation'

const text = copy.v2
export type OptionPanel = 'operators' | 'config' | 'account' | 'room' | 'settings'
export type V2Session = ReturnType<typeof useToolSession>

const titles: Record<OptionPanel, string> = {
  operators: text.operators, config: text.facilities, settings: copy.dashboard.animation.settings,
  account: text.account, room: text.roomDetails,
}

export default function OptionsDrawer({ panel, onClose, onOpenProfile, onNavigate, session, config, operators, onUpdateConfig, permission,
  canEditConfig = true, canUseIntermediateConfig = true, configReadOnly = false, sample, busy, onImportOperators, onAccount, room, dailyProduction, shiftName, error, configDiffRows, hasPreviousResult, onConfirmConfig, confirmingConfig = false }: {
  panel: OptionPanel | null
  onClose: () => void
  onOpenProfile: (profile: V2Session['profiles'][number]) => Promise<void>
  onNavigate: (section: V2Section) => void
  session: V2Session
  config: LicenseConfig
  operators: LicenseOperator[]
  onUpdateConfig: (mutate: (config: LicenseConfig) => void) => void
  permission?: PermissionMode
  canEditConfig?: boolean
  canUseIntermediateConfig?: boolean
  configReadOnly?: boolean
  sample: boolean
  busy: boolean
  onImportOperators: (operators: LicenseOperator[]) => Promise<void>
  onAccount: () => void
  room: BoardRoom | null
  dailyProduction?: DailyProduction
  shiftName?: string
  error?: string | null
  configDiffRows?: ConfigDiffItem[]
  hasPreviousResult?: boolean
  onConfirmConfig?: () => Promise<boolean>
  confirmingConfig?: boolean
}) {
  const opener = useRef<HTMLElement | null>(null)
  const featureState = useSiteFeatures()
  const [lastPanel, setLastPanel] = useState(panel)
  if (panel !== null && panel !== lastPanel) setLastPanel(panel)
  const shownPanel = panel ?? lastPanel
  const isConfig = shownPanel === 'config'
  const validation = validateScheduleConfig(config)
  const exampleData = sample && !session.license
  const description = shownPanel === 'settings' ? copy.dashboard.animation.description : isConfig ? exampleData ? text.demoConfigDescription : text.configDescription
    : shownPanel === 'operators' ? exampleData ? text.sampleOperatorDescription : text.operatorDescription
      : shownPanel === 'account' ? text.accountDescription : text.roomDescription

  return (
    <Dialog open={panel !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className={`v2-drawer ${isConfig ? 'v2-drawer-wide' : shownPanel === 'operators' ? 'v2-operators-drawer' : ''}`} showCloseButton closeLabel={text.close}
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={(event) => { event.preventDefault(); setLastPanel(null); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }}>
        <div className="v2-drawer-heading">
          <DialogTitle>{shownPanel === 'room' && room ? `${room.label} ${room.indexLabel}` : shownPanel ? titles[shownPanel] : ''}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {isConfig && <div className="v2-config-feedback">
            {!validation.ok ? <p id="v2-config-validation" role="status" className="tool-alert tool-alert--warning">{validation.message}</p>
              : error && session.configSyncStatus !== 'failed' ? <p role="alert" className="v2-feedback v2-feedback-error">{error}</p>
                : <ConfigSaveStatus status={session.configSyncStatus} onRetry={session.retryConfigSave} sample={exampleData} compact />}
          </div>}
        </div>
        <V2Transition motionKey={isConfig ? 'config' : shownPanel === 'room' ? `room-${room?.key}` : shownPanel ?? 'closed'} className="v2-drawer-body">
        {isConfig && (
          <>
            <ConfigCapabilityPreview config={config} enabled={!canEditConfig}>
            <ConfigEditor profileId={session.activeProfile?.id} config={config} canEdit={canEditConfig} readOnly={configReadOnly} canEditIntermediateInventory={canUseIntermediateConfig}
              canSelectPreset={canUseIntermediateConfig} canEditFixedShiftHours={canEditConfig || Boolean(session.activeProfile && isFreePreviewProfile(session.activeProfile))} permission={permission}
              note={session.activeProfile && isFreePreviewProfile(session.activeProfile) && !canEditConfig
                ? `${copy.common.components_ConfigEditor_024}${getProfileAccessLabel(session.activeProfile)}${copy.common.components_ConfigEditor_025}`
                : undefined}
              validation={validation} onUpdate={onUpdateConfig} embedded hideHeader hideValidation />
            </ConfigCapabilityPreview>
            {hasPreviousResult && <details className="v2-config-changes">
              <summary>{text.configEditor.changes}{Boolean(configDiffRows?.length) && <span>{configDiffRows!.length}</span>}</summary>
              {configDiffRows?.length ? <dl>{configDiffRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{copy.optimize.pages_tool_optimize_ConfigSection_012}{row.before}<br />{copy.optimize.pages_tool_optimize_ConfigSection_013}{row.after}</dd></div>)}</dl>
                : <p role="status">{copy.optimize.pages_tool_optimize_ConfigSection_014}</p>}
            </details>}
          </>
        )}
        {shownPanel === 'operators' && <OperatorManagementPanel key={session.activeProfile?.id ?? 'guest'}
          session={session} config={config} operators={operators} busy={busy} onImportOperators={onImportOperators}
          onAccount={onAccount} onManageProfiles={() => onNavigate('profiles')} />}
        {shownPanel === 'account' && (
          <div className="v2-options-content">
            {session.user ? (
              <>
                <div className="v2-account-card"><UserRound size={23} /><strong>{session.user.email}</strong>
                  <button type="button" className="v2-icon-button" title={text.logout} aria-label={text.logout} disabled={busy} onClick={() => void session.handleLogout()}><LogOut size={18} /></button></div>
                <h3>{text.profiles}</h3>
                {session.cdkProfiles.filter((profile) => (METERED_BILLING_AVAILABLE && featureState.features.metered_billing) || !profile.kind.startsWith('metered_')).map((profile) => <button type="button" className="v2-profile-option" key={profile.id}
                  disabled={busy || session.openingProfileId !== null} onClick={() => void onOpenProfile(profile)}>
                  <span><strong>{profile.display_name}</strong><small>{getProfileAccessLabel(profile)}</small></span>
                  {profile.id === session.activeProfile?.id ? <Check size={18} /> : <ArrowRight size={18} />}
                </button>)}
                {!session.cdkProfiles.some((profile) => (METERED_BILLING_AVAILABLE && featureState.features.metered_billing) || !profile.kind.startsWith('metered_')) && <p className="v2-muted">{text.noProfiles}</p>}
                {session.workspaceLoadError && <p role="alert" className="v2-error">{session.workspaceLoadError}</p>}
                <button type="button" className="v2-button v2-button-secondary" onClick={() => onNavigate('profiles')}>{text.manageProfiles}<ArrowRight size={16} /></button>
              </>
            ) : featureState.status === 'ready' && featureState.features.site && featureState.features.login ? (
              <AuthForm compact allowCdk={false} onAuthenticated={(payload) => { session.applyAuthPayload(payload); onClose() }} submitClassName="v2-button v2-button-primary w-full" />
            ) : (
              <div className="v2-empty-state"><UserRound size={30} /><p>{text.loginUnavailable}</p>
                <button type="button" className="v2-button v2-button-secondary" onClick={() => { featureState.retry(); session.retryAuth() }}>{text.loginRetry}</button></div>
            )}
          </div>
        )}
        {shownPanel === 'settings' && <AnimationSettings className="v2-options-content" />}
        {shownPanel === 'room' && room && <div className="v2-options-content">
          <div className="v2-room-operator-details">{room.row?.operators.map((operator) => {
            const mood = room.data?.mood?.[operator.name]
            const moodValue = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? value.toFixed(1) : text.moodUnavailable
            return <section className="v2-room-operator" key={operator.name}>
              <div className="v2-operator-row"><Avatar operator={operator} /><strong>{operator.name}</strong></div>
              <dl className="v2-detail-data v2-mood-data"><div><dt>{text.startMood}</dt><dd>{moodValue(mood?.start)}</dd></div>
                <div><dt>{text.endMood}</dt><dd>{moodValue(mood?.end)}</dd></div></dl>
              <BuildingSkills operator={operator} />
            </section>
          })}</div>
          <dl className="v2-detail-data"><div><dt>{text.level}</dt><dd>{roomLevelLabel(room)}</dd></div>
            <div><dt>{text.product}</dt><dd>{room.product}</dd></div><div><dt>{room.roomType === 'trading' ? text.equivalentEfficiency : text.efficiency}</dt><dd>{room.row?.efficiency ?? '—'}</dd></div>
            {dailyProduction && <RoomProduction daily={dailyProduction} room={room} shift={shiftName} />}</dl>
          <h3>{text.roomDetails}</h3><ul className="v2-room-detail-list">{room.row?.detailItems.map((item, index) => <li key={item}>{room.roomType === 'trading'
            ? index === 0 ? `${text.equivalentEfficiency} ${room.row?.efficiency}`
              : item.startsWith(copy.domain.components_result_panel_formatters_023) ? `${text.expectedFullOrders}${room.data?.overflow?.time}` : item
            : item}</li>)}</ul>
        </div>}
        </V2Transition>
        {isConfig && <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="v2-button v2-button-primary v2-drawer-done" aria-disabled={!validation.ok} aria-describedby={validation.ok ? undefined : 'v2-config-validation'}
              disabled={confirmingConfig} aria-busy={confirmingConfig}
              onClick={(event) => {
                if (!validation.ok) return
                event.preventDefault()
                if (onConfirmConfig) void onConfirmConfig().then((saved) => { if (saved) onClose() })
                else onClose()
              }}><SuccessIcon size={16} aria-hidden="true" />{confirmingConfig ? text.firstSchedule.confirming : onConfirmConfig ? text.firstSchedule.confirmConfig : text.done}</button>
          </PopoverTrigger>
          {!validation.ok && <PopoverContent side="top" align="center" role="alert" className="v2-dialog v2-config-completion-hint" onOpenAutoFocus={(event) => event.preventDefault()}>
            {validation.message}
          </PopoverContent>}
        </Popover>}
      </DialogContent>
    </Dialog>
  )
}
