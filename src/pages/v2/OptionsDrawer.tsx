import { useRef, useState } from 'react'
import PinyinMatch from 'pinyin-match'
import ConfigCapabilityPreview from '../../components/ConfigCapabilityPreview'
import type { ConfigDiffItem } from '../../lib/workspace-history'
import { ArrowRight, Check, LogOut, RefreshCw, Search, Upload, UserRound } from 'lucide-react'
import Link from '../../components/InternalLink'
import AuthForm from '../../components/AuthForm'
import AnimationSettings from '../../components/AnimationSettings'
import ConfigEditor from '../../components/ConfigEditor'
import SklandBindingDialog from '../../components/SklandBindingDialog'
import SklandIcon from '../../components/SklandIcon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { copy } from '../../copy'
import { validateScheduleConfig } from '../../lib/config'
import { useSiteFeatures } from '../../lib/site-feature-context'
import { METERED_BILLING_AVAILABLE } from '../../lib/site-features'
import { extensibleLicenseOperatorsSchema } from '../../lib/workspace-validation'
import type { LicenseConfig, LicenseOperator, PermissionMode } from '../../lib/types'
import type { BoardRoom } from '../../components/result-panel/ResultBoardV2'
import type { useToolSession } from '../tool/useToolSession'
import { Avatar, roomLevelLabel } from './ScheduleBoard'
import { getProfileAccessLabel, isFreePreviewProfile, parseOperatorsText } from '../tool/tool-utils'
import { apiJson, ApiError } from '../../lib/api-client'
import type { SklandPayload } from '../../components/SklandBindingDialog'
import ConfigSaveStatus from '../tool/workspace/ConfigSaveStatus'
import V2Transition from './V2Transition'
import BuildingSkills from './BuildingSkills'
import { v2Path, type V2Section } from './navigation'

const text = copy.v2
export type OptionPanel = 'operators' | 'config' | 'account' | 'room' | 'settings'
export type V2Session = ReturnType<typeof useToolSession>

const titles: Record<OptionPanel, string> = {
  operators: text.operators, config: text.facilities, settings: copy.dashboard.animation.settings,
  account: text.account, room: text.roomDetails,
}

export default function OptionsDrawer({ panel, onClose, onOpenProfile, onNavigate, session, config, operators, onUpdateConfig, permission,
  canEditConfig = true, canUseIntermediateConfig = true, configReadOnly = false, sample, busy, onImportOperators, onAccount, room, error, configDiffRows, hasPreviousResult }: {
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
  error?: string | null
  configDiffRows?: ConfigDiffItem[]
  hasPreviousResult?: boolean
}) {
  const [search, setSearch] = useState('')
  const [sklandOpen, setSklandOpen] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importDone, setImportDone] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const featureState = useSiteFeatures()
  const [lastPanel, setLastPanel] = useState(panel)
  if (panel !== null && panel !== lastPanel) setLastPanel(panel)
  const shownPanel = panel ?? lastPanel
  const isConfig = shownPanel === 'config'
  const description = shownPanel === 'settings' ? copy.dashboard.animation.description : isConfig ? sample ? text.demoConfigDescription : text.configDescription
    : shownPanel === 'operators' ? sample ? text.sampleOperatorDescription : text.operatorDescription
      : shownPanel === 'account' ? text.accountDescription : text.roomDescription

  const filteredOperators = search.trim() ? operators.filter((operator) => PinyinMatch.match(operator.name, search.trim())) : operators
  const canUpload = !session.activeProfile || !isFreePreviewProfile(session.activeProfile)
  async function refreshSkland() {
    if (!session.activeProfile || importBusy || busy) return
    setImportBusy(true)
    setImportError(null)
    setImportDone(false)
    try {
      if (!await session.flushConfigSave()) throw new Error(text.saveFailed)
      const payload = await apiJson<SklandPayload>('/api/user/skland/import/refresh', { method: 'POST', json: { profile_id: session.activeProfile.id }, fallbackMessage: copy.workspace.pages_tool_WorkspaceSetupPage_005 })
      if (!payload.user) throw new Error(copy.workspace.pages_tool_WorkspaceSetupPage_006)
      session.applyAuthPayload(payload)
      setImportDone(true)
    } catch (caught) {
      if (caught instanceof ApiError && caught.data && typeof caught.data === 'object' && 'user' in caught.data && caught.data.user) session.applyAuthPayload(caught.data as SklandPayload)
      setImportError(caught instanceof Error ? caught.message : copy.workspace.pages_tool_WorkspaceSetupPage_005)
    } finally { setImportBusy(false) }
  }

  async function importFile(file: File) {
    if (!canUpload || importBusy || busy) return
    setImportBusy(true)
    setImportError(null)
    setImportDone(false)
    try {
      const parsed = extensibleLicenseOperatorsSchema.safeParse(parseOperatorsText(await file.text()))
      if (!parsed.success) throw new Error(text.uploadFailed)
      await onImportOperators(parsed.data)
      setImportDone(true)
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : text.uploadFailed)
    } finally {
      setImportBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <Dialog open={panel !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className={`v2-drawer ${isConfig ? 'v2-drawer-wide' : ''}`} showCloseButton closeLabel={text.close}
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={(event) => { event.preventDefault(); setLastPanel(null); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }}>
        <div className="v2-drawer-heading">
          <DialogTitle>{shownPanel === 'room' && room ? `${room.label} ${room.indexLabel}` : shownPanel ? titles[shownPanel] : ''}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        <V2Transition motionKey={isConfig ? 'config' : shownPanel === 'room' ? `room-${room?.key}` : shownPanel ?? 'closed'} className="v2-drawer-body">
        {isConfig && (
          <>
            {error && <p role="alert" className="v2-feedback v2-feedback-error">{error}</p>}
            <ConfigCapabilityPreview config={config} enabled={!canEditConfig}>
            <ConfigEditor profileId={session.activeProfile?.id} config={config} canEdit={canEditConfig} readOnly={configReadOnly} canEditIntermediateInventory={canUseIntermediateConfig}
              canSelectPreset={canUseIntermediateConfig} canEditFixedShiftHours={canEditConfig || Boolean(session.activeProfile && isFreePreviewProfile(session.activeProfile))} permission={permission}
              validation={validateScheduleConfig(config)} onUpdate={onUpdateConfig} embedded />
            </ConfigCapabilityPreview>
            {hasPreviousResult && <aside className="v2-options-content">
              <h3>{copy.optimize.pages_tool_optimize_ConfigSection_010}</h3>
              {configDiffRows?.length ? <dl>{configDiffRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{copy.optimize.pages_tool_optimize_ConfigSection_012}{row.before}<br />{copy.optimize.pages_tool_optimize_ConfigSection_013}{row.after}</dd></div>)}</dl>
                : <p role="status">{copy.optimize.pages_tool_optimize_ConfigSection_014}</p>}
            </aside>}
            {session.user && <ConfigSaveStatus status={session.configSyncStatus} onRetry={session.retryConfigSave} />}
            <button type="button" className="v2-button v2-button-primary v2-drawer-done" onClick={onClose}><Check size={16} />{text.done}</button>
          </>
        )}
        {shownPanel === 'operators' && (
          <div className="v2-options-content">
            <label className="v2-search-label"><span>{text.searchOperators}</span><span className="v2-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={text.searchOperators} /></span></label>
            <div className="v2-import-row">
              <div className="v2-import-actions">
                <button type="button" className="v2-button v2-button-secondary" disabled={!canUpload || busy || importBusy}
                  onClick={() => fileInput.current?.click()}><Upload size={15} />{text.uploadMaa}</button>
                <button type="button" className="v2-button v2-button-secondary" disabled={busy || importBusy || !featureState.features.skland}
                  onClick={() => { if (session.user && session.activeProfile) setSklandOpen(true); else onAccount() }}><SklandIcon />{text.bindSkland}</button>
                {featureState.features.skland && session.activeProfile?.skland_binding && <button type="button" className="v2-button v2-button-secondary" disabled={importBusy || busy} onClick={() => void refreshSkland()}><RefreshCw size={16} />{text.refreshSkland}</button>}
              </div>
              {!canUpload && <p className="v2-muted">{copy.workspace.pages_tool_WorkspaceSetupPage_004}</p>}
              <input className="sr-only" ref={fileInput} type="file" accept=".json,application/json" disabled={!canUpload || importBusy || busy} aria-label={text.uploadMaa}
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} />
              {importError && <p role="alert" className="v2-error">{importError}</p>}
              {importDone && <p role="status" className="v2-muted">{session.user ? text.importSuccess : text.sampleImportSuccess}</p>}
              {session.user && <Link to={v2Path('profiles', session.activeProfile?.id)} className="v2-text-button v2-import-profiles">{text.manageProfiles}<ArrowRight size={14} /></Link>}
            </div>
            <div className="v2-operator-rows">
              {filteredOperators.map((operator) => (
                <div className="v2-operator-entry" key={operator.id}><div className="v2-operator-row">
                  <Avatar operator={operator} /><strong>{operator.name}</strong>
                  <span className="v2-operator-status">{operator.own ? text.ownedLabel : text.notOwnedLabel}</span>
                  <div className="v2-operator-training">
                    <span className="v2-operator-status">{text.elite(operator.elite)}</span>
                    <span className="v2-operator-status">{text.operatorLevel(typeof operator.level === 'number' || typeof operator.level === 'string' ? operator.level : undefined)}</span>
                  </div>
                </div><BuildingSkills operator={operator} /></div>
              ))}
              {filteredOperators.length === 0 && <p className="v2-muted">{text.noOperators}</p>}
            </div>
          </div>
        )}
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
            <div><dt>{text.product}</dt><dd>{room.product}</dd></div><div><dt>{room.roomType === 'trading' ? text.equivalentEfficiency : text.efficiency}</dt><dd>{room.row?.efficiency ?? '—'}</dd></div></dl>
          <h3>{text.roomDetails}</h3><ul className="v2-room-detail-list">{room.row?.detailItems.map((item, index) => <li key={item}>{room.roomType === 'trading'
            ? index === 0 ? `${text.equivalentEfficiency} ${room.row?.efficiency}`
              : item.startsWith(copy.domain.components_result_panel_formatters_023) ? `${text.expectedFullOrders}${room.data?.overflow?.time}` : item
            : item}</li>)}</ul>
        </div>}
        </V2Transition>
      </DialogContent>
      <SklandBindingDialog open={sklandOpen} profile={session.activeProfile} onOpenChange={setSklandOpen}
        onPayload={(payload) => {
          if (!payload.user) return
          session.applyAuthPayload(payload)
          if (!payload.workspace?.config) session.setConfigOverride(config)
        }}
        onCompleted={() => { setSklandOpen(false); setImportDone(true) }} />
    </Dialog>
  )
}
