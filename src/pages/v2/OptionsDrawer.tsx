import { lazy, Suspense, useRef, useState } from 'react'
import { ArrowRight, Check, FileClock, LogOut, Search, Upload, UserRound } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import AuthForm from '../../components/AuthForm'
import SklandBindingDialog from '../../components/SklandBindingDialog'
import SklandIcon from '../../components/SklandIcon'
import { Dialog, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { MotionDrawerContent } from '../../components/ui/motion-drawer'
import { copy } from '../../copy'
import { validateScheduleConfig } from '../../lib/config'
import { useSiteFeatures } from '../../lib/site-feature-context'
import { METERED_BILLING_AVAILABLE } from '../../lib/site-features'
import { formatWorkspaceDate } from '../../lib/workspace-history'
import { extensibleLicenseOperatorsSchema } from '../../lib/workspace-validation'
import type { LicenseConfig, LicenseOperator, PermissionMode, WorkspaceResultHistorySummary } from '../../lib/types'
import type { BoardRoom } from '../../components/result-panel/ResultBoardV2'
import type { useToolSession } from '../tool/useToolSession'
import { Avatar, roomLevelLabel } from './ScheduleBoard'
import { getProfileAccessLabel, parseOperatorsText } from '../tool/tool-utils'
import V2Transition from './V2Transition'
import BuildingSkills from './BuildingSkills'

const ConfigEditor = lazy(() => import('../../components/ConfigEditor'))
const text = copy.v2
export type OptionPanel = 'operators' | 'config' | 'account' | 'cdk' | 'history' | 'room'
export type V2Session = ReturnType<typeof useToolSession>

const titles: Record<OptionPanel, string> = {
  operators: text.operators, config: text.facilities,
  account: text.account, cdk: text.cdk, history: text.history, room: text.roomDetails,
}

export default function OptionsDrawer({ panel, onClose, session, config, operators, onUpdateConfig, permission,
  canEditConfig = true, canUseIntermediateConfig = true, sample, busy, onImportOperators, onAccount, history, onHistory, room, error }: {
  panel: OptionPanel | null
  onClose: () => void
  session: V2Session
  config: LicenseConfig
  operators: LicenseOperator[]
  onUpdateConfig: (mutate: (config: LicenseConfig) => void) => void
  permission?: PermissionMode
  canEditConfig?: boolean
  canUseIntermediateConfig?: boolean
  sample: boolean
  busy: boolean
  onImportOperators: (operators: LicenseOperator[]) => Promise<void>
  onAccount: () => void
  history: WorkspaceResultHistorySummary[]
  onHistory?: (summary: WorkspaceResultHistorySummary) => Promise<void>
  room: BoardRoom | null
  error?: string | null
}) {
  const [, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [sklandOpen, setSklandOpen] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importDone, setImportDone] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const featureState = useSiteFeatures()
  const isConfig = panel === 'config'
  const description = isConfig ? sample ? text.demoConfigDescription : text.configDescription
    : panel === 'operators' ? sample ? text.sampleOperatorDescription : text.operatorDescription
      : panel === 'account' ? text.accountDescription : panel === 'room' ? text.roomDescription
        : panel === 'cdk' ? text.cdkDescription : text.historyDescription

  async function importFile(file: File) {
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
      <MotionDrawerContent open={panel !== null} className={`v2-drawer ${isConfig ? 'v2-drawer-wide' : ''}`} closeLabel={text.close}>
        <div className="v2-drawer-heading">
          <DialogTitle>{panel === 'room' && room ? `${room.label} ${room.indexLabel}` : panel ? titles[panel] : ''}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        <V2Transition motionKey={isConfig ? 'config' : panel === 'room' ? `room-${room?.key}` : panel ?? 'closed'} className="v2-drawer-body">
        {isConfig && (
          <>
            {error && <p role="alert" className="v2-feedback v2-feedback-error">{error}</p>}
            <Suspense fallback={<p className="v2-muted">{text.loadingConfig}</p>}>
              <ConfigEditor config={config} canEdit={canEditConfig} canEditIntermediateInventory={canUseIntermediateConfig}
                canSelectPreset={canUseIntermediateConfig} canEditFixedShiftHours={canEditConfig} permission={permission}
                validation={validateScheduleConfig(config)} onUpdate={onUpdateConfig} embedded />
            </Suspense>
            <button type="button" className="v2-button v2-button-primary v2-drawer-done" onClick={onClose}><Check size={16} />{text.done}</button>
          </>
        )}
        {panel === 'operators' && (
          <div className="v2-options-content">
            <label className="v2-search-label"><span>{text.searchOperators}</span><span className="v2-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={text.searchOperators} /></span></label>
            <div className="v2-import-row">
              <div className="v2-import-actions">
                <button type="button" className="v2-button v2-button-secondary" disabled={busy || importBusy}
                  onClick={() => fileInput.current?.click()}><Upload size={15} />{text.uploadMaa}</button>
                <button type="button" className="v2-button v2-button-secondary" disabled={busy || importBusy || !featureState.features.skland}
                  onClick={() => { if (session.user && session.activeProfile) setSklandOpen(true); else onAccount() }}><SklandIcon />{text.bindSkland}</button>
              </div>
              <input className="sr-only" ref={fileInput} type="file" accept=".json,application/json" aria-label={text.uploadMaa}
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} />
              {importError && <p role="alert" className="v2-error">{importError}</p>}
              {importDone && <p role="status" className="v2-muted">{session.user ? text.importSuccess : text.sampleImportSuccess}</p>}
              {session.user && <Link to="/tool/profiles" className="v2-text-button v2-import-profiles">{text.manageProfiles}<ArrowRight size={14} /></Link>}
            </div>
            <div className="v2-operator-rows">
              {operators.filter((operator) => operator.name.toLowerCase().includes(search.trim().toLowerCase())).map((operator) => (
                <div className="v2-operator-entry" key={operator.id}><div className="v2-operator-row">
                  <Avatar operator={operator} /><strong>{operator.name}</strong>
                  <span className="v2-operator-status">{operator.own ? text.ownedLabel : text.notOwnedLabel}</span>
                  <div className="v2-operator-training">
                    <span className="v2-operator-status">{text.elite(operator.elite)}</span>
                    <span className="v2-operator-status">{text.operatorLevel(typeof operator.level === 'number' || typeof operator.level === 'string' ? operator.level : undefined)}</span>
                  </div>
                </div><BuildingSkills operator={operator} /></div>
              ))}
              {!operators.some((operator) => operator.name.toLowerCase().includes(search.trim().toLowerCase())) && <p className="v2-muted">{text.noOperators}</p>}
            </div>
          </div>
        )}
        {panel === 'account' && (
          <div className="v2-options-content">
            {session.user ? (
              <>
                <div className="v2-account-card"><UserRound size={23} /><strong>{session.user.email}</strong>
                  <button type="button" className="v2-icon-button" title={text.logout} aria-label={text.logout} disabled={busy} onClick={() => void session.handleLogout()}><LogOut size={18} /></button></div>
                <h3>{text.profiles}</h3>
                {session.cdkProfiles.filter((profile) => (METERED_BILLING_AVAILABLE && featureState.features.metered_billing) || !profile.kind.startsWith('metered_')).map((profile) => <button type="button" className="v2-profile-option" key={profile.id}
                  disabled={busy || session.openingProfileId !== null} onClick={async () => {
                    if (await session.flushConfigSave()) {
                      await session.refreshProfileWorkspace(profile).then(() => {
                        setParams((current) => { const next = new URLSearchParams(current); next.set('profile_id', profile.id); return next })
                        onClose()
                      }).catch(() => undefined)
                    }
                  }}>
                  <span><strong>{profile.display_name}</strong><small>{getProfileAccessLabel(profile)}</small></span>
                  {profile.id === session.activeProfile?.id ? <Check size={18} /> : <ArrowRight size={18} />}
                </button>)}
                {!session.cdkProfiles.some((profile) => (METERED_BILLING_AVAILABLE && featureState.features.metered_billing) || !profile.kind.startsWith('metered_')) && <p className="v2-muted">{text.noProfiles}</p>}
                {session.workspaceLoadError && <p role="alert" className="v2-error">{session.workspaceLoadError}</p>}
                <Link to="/tool/profiles" className="v2-button v2-button-secondary">{text.manageProfiles}<ArrowRight size={16} /></Link>
              </>
            ) : featureState.status === 'ready' && featureState.features.site && featureState.features.login ? (
              <AuthForm compact allowCdk={false} onAuthenticated={(payload) => { session.applyAuthPayload(payload); onClose() }} submitClassName="v2-button v2-button-primary w-full" />
            ) : (
              <div className="v2-empty-state"><UserRound size={30} /><p>{text.loginUnavailable}</p>
                <button type="button" className="v2-button v2-button-secondary" onClick={() => { featureState.retry(); session.retryAuth() }}>{text.loginRetry}</button></div>
            )}
          </div>
        )}
        {panel === 'cdk' && <div className="v2-options-content">
          <Link to="/tool/redeem" className="v2-button v2-button-primary">{text.manageCdk}<ArrowRight size={16} /></Link></div>}
        {panel === 'history' && <div className="v2-options-content">
          {sample && history.length === 0 ? <button className="v2-history-option" type="button" onClick={onClose}><FileClock size={20} /><span><strong>{text.sampleHistory}</strong><small>{text.sampleSource}</small></span><ArrowRight size={17} /></button>
            : history.length === 0 ? <p className="v2-muted">{text.noHistory}</p>
              : history.map((item) => <button className="v2-history-option" type="button" key={item.id} disabled={busy} onClick={() => void onHistory?.(item).then(onClose)}>
                <FileClock size={20} /><span><strong>{item.name}</strong><small>{formatWorkspaceDate(item.created_at)}</small></span><ArrowRight size={17} /></button>)}
        </div>}
        {panel === 'room' && room && <div className="v2-options-content">
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
      </MotionDrawerContent>
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
