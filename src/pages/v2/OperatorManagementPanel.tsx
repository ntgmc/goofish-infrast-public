import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { NextIcon as ArrowRight, RefreshIcon, SearchIcon, UploadIcon } from '../../components/icons'
import SklandBindingDialog, { type SklandPayload } from '../../components/SklandBindingDialog'
import SklandIcon from '../../components/SklandIcon'
import { copy, CURRENT_LOCALE } from '../../copy'
import { ApiError, apiJson } from '../../lib/api-client'
import { matchesSearch } from '../../lib/search'
import { useSiteFeatures } from '../../lib/site-feature-context'
import type { LicenseConfig, LicenseOperator } from '../../lib/types'
import { extensibleLicenseOperatorsSchema } from '../../lib/workspace-validation'
import { countOwnedOperators, isFreePreviewProfile, parseOperatorsText, sortOperatorsForPreview } from '../tool/tool-utils'
import BuildingSkills from './BuildingSkills'
import type { V2Session } from './OptionsDrawer'
import { Avatar } from './ScheduleBoard'

const text = copy.v2.operatorManagement

type Notice = { kind: 'success' | 'warning' | 'error'; message: string; detail?: string; recovery?: 'retry' | 'rebind' }

export default function OperatorManagementPanel({ session, config, operators, busy, onImportOperators, onAccount, onManageProfiles }: {
  session: V2Session
  config: LicenseConfig
  operators: LicenseOperator[]
  busy: boolean
  onImportOperators: (operators: LicenseOperator[]) => Promise<void>
  onAccount: () => void
  onManageProfiles: () => void
}) {
  const { features } = useSiteFeatures()
  const [search, setSearch] = useState('')
  const [sklandOpen, setSklandOpen] = useState(false)
  const [action, setAction] = useState<'refresh' | 'file' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null)
  const [credentialInvalid, setCredentialInvalid] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const fileInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const profile = session.activeProfile
  const binding = profile?.skland_binding
  const invalid = binding?.credential_status === 'invalid' || credentialInvalid
  const canUpload = !profile || !isFreePreviewProfile(profile)
  const disabled = busy || action !== null || sklandOpen
  const sortedOperators = useMemo(() => sortOperatorsForPreview(operators)
    .sort((left, right) => Number(right.own !== false) - Number(left.own !== false)), [operators])
  const ownedCount = useMemo(() => countOwnedOperators(operators), [operators])
  const deferredSearch = useDeferredValue(search)
  const filtered = useMemo(() => sortedOperators.filter((operator) => matchesSearch(operator.name, deferredSearch)), [sortedOperators, deferredSearch])

  function openBinding() {
    setNotice(null)
    if (session.user && profile) setSklandOpen(true)
    else onAccount()
  }

  async function refreshSkland() {
    if (!profile || disabled || invalid || !features.skland) return
    setAction('refresh')
    setNotice(null)
    try {
      if (!await session.flushConfigSave()) throw new Error(copy.v2.saveFailed)
      if (!mounted.current) return
      const payload = await apiJson<SklandPayload>('/api/user/skland/import/refresh', {
        method: 'POST', json: { profile_id: profile.id }, fallbackMessage: text.refreshFailed,
      })
      if (!mounted.current) return
      if (!payload.user) throw new Error(text.refreshFailed)
      session.applyAuthPayload(payload)
      const imported = payload.skland_import
      if (imported?.credential_verified_at) setVerifiedAt(imported.credential_verified_at)
      setNotice(imported?.refresh_warning
        ? { kind: 'warning', message: text.retainedOperators, recovery: 'retry' }
        : { kind: imported?.inventory_warning ? 'warning' : 'success',
            message: imported?.credential_verified_at ? text.refreshSuccess(imported.operator_count) : text.cachedSuccess,
            detail: imported?.inventory_warning ? text.inventoryWarning : undefined })
    } catch (caught) {
      if (!mounted.current) return
      const payload = caught instanceof ApiError ? caught.data as Partial<SklandPayload> | null : null
      if (payload?.user) session.applyAuthPayload(payload as SklandPayload)
      const needsRebind = payload?.code === 'skland_credential_invalid' || payload?.recovery_action === 'rebind' || payload?.recovery_action === 'bind_first'
      if (payload?.code === 'skland_credential_invalid') setCredentialInvalid(true)
      setNotice({ kind: 'error', message: needsRebind ? text.credentialInvalid : text.refreshFailed,
        detail: caught instanceof Error ? caught.message : undefined, recovery: needsRebind ? 'rebind' : 'retry' })
    } finally { if (mounted.current) setAction(null) }
  }

  async function importFile(file: File) {
    if (!canUpload || disabled) return
    setAction('file')
    setNotice(null)
    try {
      const parsed = extensibleLicenseOperatorsSchema.safeParse(parseOperatorsText(await file.text()))
      if (!parsed.success) throw new Error(copy.v2.uploadFailed)
      if (!mounted.current) return
      await onImportOperators(parsed.data)
      if (mounted.current) setNotice({ kind: 'success', message: session.user ? copy.v2.importSuccess : copy.v2.sampleImportSuccess })
    } catch (caught) {
      if (mounted.current) setNotice({ kind: 'error', message: caught instanceof Error ? caught.message : copy.v2.uploadFailed })
    } finally {
      if (mounted.current) setAction(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function copyUid() {
    if (!binding) return
    try {
      await navigator.clipboard.writeText(binding.uid)
      if (mounted.current) setCopyState('copied')
    } catch { if (mounted.current) setCopyState('failed') }
  }

  return <>
    <div className="v2-options-content v2-operator-management">
      <section className="v2-operator-account" aria-label={text.currentProfile}>
        {session.user && <div className="v2-operator-section-heading">
          <p className="v2-operator-profile"><span>{text.currentProfile}</span><strong>{profile?.display_name ?? copy.v2.noProfiles}</strong></p>
          <button type="button" className="v2-text-button" onClick={onManageProfiles}>{copy.v2.manageProfiles}<ArrowRight size={14} /></button>
        </div>}
        {binding ? <>
          <div className="v2-operator-identity"><h3>{binding.nickname}</h3><span className="v2-neutral-tag">{text.bound}</span></div>
          <div className="v2-operator-uid"><span>UID <span className="v2-selectable-uid">{binding.uid}</span></span>
            <button type="button" className="v2-text-button" onClick={() => void copyUid()} aria-label={text.copyUid}>{copyState === 'copied' ? text.copied : text.copyUid}</button>
            <span>{text.server} · {binding.channel_name}</span>
          </div>
          {copyState !== 'idle' && <p role="status" className="v2-muted">{copyState === 'failed' ? text.copyFailed : text.copied}</p>}
          <dl className="v2-operator-binding-data">
            <div><dt>{text.boundAt}</dt><dd>{bindingTime(binding.bound_at, text.unavailableValue)}</dd></div>
            <div><dt>{text.refreshedAt}</dt><dd>{bindingTime(binding.last_imported_at, text.neverRefreshed)}</dd></div>
            <div><dt>{text.credentialStatus}</dt><dd className={invalid ? 'v2-error' : ''}>
              {invalid ? text.credentialInvalid : action === 'refresh' ? text.refreshing : verifiedAt ? <>{text.credentialVerified}{bindingTime(verifiedAt, text.unavailableValue)}</> : text.credentialSaved}
            </dd></div>
          </dl>
        </> : <div className="v2-operator-unbound"><h3><SklandIcon />{text.unbound}</h3><p>{text.unboundDescription}</p></div>}
        {features.skland ? <div className="v2-operator-sync-actions">
          <button type="button" className="v2-button v2-button-primary" disabled={disabled} aria-busy={action === 'refresh'}
            onClick={() => { if (!binding || invalid) openBinding(); else void refreshSkland() }}>
            {binding && !invalid ? <RefreshIcon size={16} /> : <SklandIcon />}{action === 'refresh' ? text.refreshing : !binding ? text.bind : invalid ? text.reauthorize : text.refresh}
          </button>
          {binding && !invalid && <button type="button" className="v2-text-button" disabled={disabled} onClick={openBinding}>{text.reauthorize}</button>}
        </div> : <p className="v2-muted">{text.syncUnavailable}</p>}
      </section>
      {notice && <div className={`v2-operator-notice ${notice.kind === 'error' ? 'v2-error' : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
        <p>{notice.message}</p>{notice.detail && notice.detail !== notice.message && <p>{notice.detail}</p>}
        {features.skland && notice.recovery && <button type="button" className="v2-text-button" disabled={disabled}
          onClick={() => { if (notice.recovery === 'rebind') openBinding(); else void refreshSkland() }}>{notice.recovery === 'rebind' ? text.reauthorize : text.retry}</button>}
      </div>}
      <section className="v2-operator-file" aria-label={text.maaTitle}>
        <div className="v2-operator-section-heading"><h3>{text.maaTitle}</h3>
          <button type="button" className="v2-button v2-button-secondary" disabled={!canUpload || disabled} aria-busy={action === 'file'}
            onClick={() => fileInput.current?.click()}><UploadIcon size={15} />{action === 'file' ? text.importing : text.chooseFile}</button>
        </div>
        {!canUpload && <p className="v2-muted">{text.previewImport}</p>}
        <input className="sr-only" ref={fileInput} type="file" accept=".json,application/json" disabled={!canUpload || disabled} aria-label={copy.v2.uploadMaa}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} />
      </section>
      <section aria-label={text.list}>
        <div className="v2-operator-section-heading"><h3>{text.list}</h3><span className="v2-muted">{deferredSearch.trim() ? text.matchingCount(filtered.length) : text.ownedCount(ownedCount)}</span></div>
        <label className="v2-search-label"><span>{copy.v2.searchOperators}</span><span className="v2-search"><SearchIcon size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={copy.v2.searchOperators} /></span></label>
        <div className="v2-operator-rows" aria-busy={search !== deferredSearch}>
          <OperatorRows operators={filtered} />
          {filtered.length === 0 && <div className="v2-operator-empty"><p className="v2-muted">{operators.length ? copy.v2.noOperators : text.empty}</p>
            {deferredSearch && <button type="button" className="v2-text-button" onClick={() => setSearch('')}>{text.clearSearch}</button>}
          </div>}
        </div>
      </section>
    </div>
    <SklandBindingDialog open={sklandOpen} profile={profile} onOpenChange={setSklandOpen}
      onPayload={(payload) => {
        if (!mounted.current || !payload.user) return
        session.applyAuthPayload(payload)
        if (!payload.workspace?.config) session.setConfigOverride(config)
      }}
      onCompleted={() => {
        if (!mounted.current) return
        setSklandOpen(false)
        setCredentialInvalid(false)
        setVerifiedAt(null)
        setNotice({ kind: 'success', message: copy.v2.importSuccess })
      }} />
  </>
}

const OperatorRows = memo(function OperatorRows({ operators }: { operators: LicenseOperator[] }) {
  return operators.map((operator) => <div className="v2-operator-entry" key={operator.id} data-owned={operator.own !== false}>
    <div className="v2-operator-row"><Avatar operator={operator} /><strong>{operator.name}</strong>
      <span className="v2-operator-status">{operator.own !== false ? copy.v2.ownedLabel : copy.v2.notOwnedLabel}</span>
      <div className="v2-operator-training"><span className="v2-operator-status">{copy.v2.elite(operator.elite)}</span>
        <span className="v2-operator-status">{copy.v2.operatorLevel(typeof operator.level === 'number' || typeof operator.level === 'string' ? operator.level : undefined)}</span></div>
    </div><BuildingSkills operator={operator} />
  </div>)
})

function bindingTime(value: string | null, empty: string) {
  if (!value || Number.isNaN(Date.parse(value))) return empty
  return <time dateTime={value}>{new Date(value).toLocaleString(CURRENT_LOCALE, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(/\//g, '-')}</time>
}
