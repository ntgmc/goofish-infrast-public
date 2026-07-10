import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Announcement, AuthSuccessResponse, AuthUser, LicenseConfig, LicenseOperator, UserGameAccount, UserWorkspace } from '../../lib/types'
import AnnouncementBanner from '../../components/AnnouncementBanner'
import BrandLogo from '../../components/BrandLogo'
import SklandBindingDialog, { type SklandPayload } from '../../components/SklandBindingDialog'
import { ApiError, apiJson } from '../../lib/api-client'
import { CONFIG_PRESETS, cloneConfig, normalizeConfig, validateConfig } from '../../lib/config'
import { canonicalJson } from '../../lib/crypto'
import { countOwnedOperators, formatDate, getProfileAccessLabel, isFreePreviewProfile, parseOperatorsText, sortOperatorsForPreview } from './tool-utils'

const WorkspaceConfigSection = lazy(() => import('./workspace/WorkspaceConfigSection'))

type WorkspaceSetupSection = 'operators' | 'config'
type IntermediateProduct = 'Originium Shard' | 'Pure Gold'
type SklandRefreshNotice = {
  kind: 'success' | 'error'
  message: string
  recovery_action?: SklandPayload['recovery_action']
}

export default function WorkspaceSetupPage({
  user,
  profile,
  workspace,
  announcement,
  onSaved,
  onSynced,
  onBack,
  onLogout,
}: {
  user: AuthUser
  profile: UserGameAccount
  workspace: UserWorkspace | null
  announcement: Announcement | null
  onSaved: (payload: AuthSuccessResponse) => void
  onSynced: (payload: AuthSuccessResponse) => void
  onBack: () => void
  onLogout: () => void
}) {
  const [operators, setOperators] = useState<LicenseOperator[] | null>(workspace?.operators ?? null)
  const [operatorFileName, setOperatorFileName] = useState<string | null>(null)
  const [operatorSearch, setOperatorSearch] = useState('')
  const [config, setConfig] = useState<LicenseConfig>(() => normalizeConfig(workspace?.config ?? cloneConfig(CONFIG_PRESETS['243'])))
  const [activeSection, setActiveSection] = useState<WorkspaceSetupSection>('operators')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sklandDialogOpen, setSklandDialogOpen] = useState(false)
  const [sklandRefreshing, setSklandRefreshing] = useState(false)
  const [sklandRefreshNotice, setSklandRefreshNotice] = useState<SklandRefreshNotice | null>(null)

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
  const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])
  const isPreviewProfile = isFreePreviewProfile(profile)
  const canEditConfig = profile.permission === 'advanced' || profile.permission === 'ultimate' || profile.permission === 'admin'
  const canEditLimitedConfig = isPreviewProfile || profile.permission === 'recommended' || profile.permission === 'growth'
  const freePreviewNeedsBinding = isPreviewProfile && !profile.skland_binding
  const canManualEditOperators = !isPreviewProfile
  const ownedOperatorCount = useMemo(() => countOwnedOperators(operators), [operators])
  const configChanged = workspace?.config ? canonicalJson(normalizedConfig) !== canonicalJson(workspace.config) : true
  const filteredOperators = useMemo(() => {
    const keyword = operatorSearch.trim().toLowerCase()
    const source = sortOperatorsForPreview((operators ?? []).filter((operator) => operator.own !== false))
    return keyword ? source.filter((operator) => operator.name.toLowerCase().includes(keyword)) : source
  }, [operatorSearch, operators])
  const setupSections: Array<{ id: WorkspaceSetupSection; label: string; ready: boolean }> = [
    { id: 'operators', label: '干员数据', ready: Boolean(operators) },
    { id: 'config', label: '基建配置', ready: configValidation.ok },
  ]

  const updateConfig = useCallback((mutate: (config: LicenseConfig) => void) => {
    const next = normalizeConfig(normalizedConfig)
    mutate(next)
    setConfig(next)
  }, [normalizedConfig])

  const handleOperatorsFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    setOperatorFileName(file?.name ?? null)
    setError(null)
    setStatus(null)
    setSklandRefreshNotice(null)
    if (isPreviewProfile) {
      setOperatorFileName(null)
      setError('免费个人排班档案的干员数据只能通过森空岛导入。')
      event.currentTarget.value = ''
      return
    }
    if (!file) return
    try {
      setOperators(parseOperatorsText(await file.text()))
    } catch (caught) {
      setOperators(null)
      setError((caught as Error).message)
    }
  }

  const applySklandPayload = useCallback((data: SklandPayload) => {
    if (!data.user) return
    setOperators(data.workspace?.operators ?? null)
    if (data.workspace?.config) setConfig(normalizeConfig(data.workspace.config))
    setOperatorFileName(null)
    setError(null)
    setStatus(null)
    setSklandRefreshNotice(null)
    onSynced(data)
  }, [onSynced])

  const handleRefreshSkland = useCallback(async () => {
    setSklandRefreshing(true)
    setError(null)
    setStatus(null)
    setSklandRefreshNotice(null)
    try {
      const data = await apiJson<SklandPayload>('/api/user/skland/import/refresh', {
        method: 'POST',
        json: { profile_id: profile.id },
        fallbackMessage: '森空岛刷新失败',
      })
      if (!data.user) throw new Error('森空岛刷新失败')
      applySklandPayload(data)
      setSklandRefreshNotice({
        kind: 'success',
        message: data.skland_import
          ? formatSklandImportNotice(data.skland_import, '已刷新')
          : '森空岛干员数据已刷新。',
      })
    } catch (caught) {
      const payload = sklandPayloadFromError(caught)
      if (payload?.user) onSynced(payload as SklandPayload)
      setSklandRefreshNotice({
        kind: 'error',
        message: formatSklandRefreshError(payload, caught instanceof ApiError ? caught.status : 500),
        recovery_action: payload?.recovery_action,
      })
    } finally {
      setSklandRefreshing(false)
    }
  }, [applySklandPayload, onSynced, profile.id])

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!operators) {
      setError('请先上传干员识别文件。')
      return
    }
    if (freePreviewNeedsBinding) {
      setError('免费个人排班档案必须先绑定森空岛后才能保存工作区数据。')
      return
    }
    if (!configValidation.ok) {
      setError(configValidation.message)
      return
    }
    setSaving(true)
    setError(null)
    setStatus(null)
    setSklandRefreshNotice(null)
    try {
      const data = await apiJson<AuthSuccessResponse>('/api/user/workspace', {
        method: 'PATCH',
        json: {
          profile_id: profile.id,
          ...(isPreviewProfile ? {} : { operators }),
          config: normalizedConfig,
          elite_overrides: workspace?.elite_overrides ?? {},
        },
        fallbackMessage: '保存失败',
      })
      if (!data.user) throw new Error('保存失败')
      onSaved(data)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-0 text-ink-primary">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-surface-3 bg-surface-1 px-4 py-5 lg:block">
        <div className="flex items-start gap-3 px-2">
          <BrandLogo size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-500">MAA 工作台</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
            <p className="mt-3 truncate text-sm font-medium text-ink-primary">{profile.display_name}</p>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          {setupSections.map((section) => (
            <button key={section.id} type="button" onClick={() => setActiveSection(section.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ${activeSection === section.id ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'}`}>
              <span>{section.label}</span>
              <span className={`h-2 w-2 rounded-full ${section.ready ? 'bg-success' : 'bg-surface-4'}`} />
            </button>
          ))}
        </nav>
        <button type="button" onClick={onBack} className="absolute bottom-16 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">返回账号列表</button>
        <button type="button" onClick={onLogout} className="absolute bottom-5 left-4 right-4 rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">退出登录</button>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-surface-3 bg-surface-0/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <BrandLogo size="sm" className="lg:hidden" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-400">{profile.display_name}</p>
                <h1 className="mt-1 text-xl font-semibold text-ink-primary">准备账号工作区</h1>
                <p className="mt-1 text-sm text-ink-muted">上传干员识别文件并确认基建配置，保存后进入排班优化。</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onBack} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3">返回账号列表</button>
              <button type="button" onClick={onLogout} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-3 lg:hidden">退出登录</button>
            </div>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {setupSections.map((section) => (
              <button key={section.id} type="button" onClick={() => setActiveSection(section.id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${activeSection === section.id ? 'bg-brand-600 text-white' : 'bg-surface-1 text-ink-secondary'}`}>{section.label}</button>
            ))}
          </div>
          {announcement?.active && <AnnouncementBanner announcement={announcement} className="mt-4" />}
        </header>

        <form onSubmit={handleSave} className="px-5 py-6 sm:px-8">
          <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              {error && <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
              {status && <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{status}</div>}

              {activeSection === 'operators' && (
                <section className="rounded-xl border border-surface-3 bg-surface-1 p-5 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-ink-primary">干员数据</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">上传 MAA 导出的干员识别文件，或使用森空岛扫码导入后预览干员头像、精英化和等级。</p>
                    </div>
                    {operators && <span className="rounded-md bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">已就绪</span>}
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary">
                      {operatorFileName ? `已选择：${operatorFileName}` : operators ? `已载入 ${ownedOperatorCount} 名拥有干员` : '选择干员识别文件'}
                      <input type="file" accept=".json,.txt,application/json,text/plain" onChange={handleOperatorsFile} disabled={!canManualEditOperators} className="hidden" />
                    </label>
                    {operators && <span className="text-sm text-brand-400">拥有干员 {ownedOperatorCount} 名</span>}
                  </div>

                  <SklandStatusCard
                    profile={profile}
                    busy={sklandRefreshing}
                    dialogOpen={sklandDialogOpen}
                    notice={sklandRefreshNotice}
                    onOpen={() => setSklandDialogOpen(true)}
                    onRefresh={handleRefreshSkland}
                  />

                  {operators && (
                    <div className="mt-5">
                      <input value={operatorSearch} onChange={(event) => setOperatorSearch(event.currentTarget.value)} className="mb-4 w-full rounded-lg border border-surface-4 bg-surface-0 px-3 py-2 text-sm text-ink-primary" placeholder="搜索干员名称" />
                      <div className="grid max-h-[560px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                        {filteredOperators.map((operator) => <OperatorPreviewCard key={operator.id} operator={operator} />)}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {activeSection === 'config' && (
                <Suspense fallback={<SectionFallback />}>
                  <WorkspaceConfigSection
                    config={normalizedConfig}
                    canEdit={canEditConfig}
                    canEditIntermediateInventory={canEditLimitedConfig}
                    canSelectPreset
                    changed={configChanged}
                    permission={profile.permission}
                    validation={configValidation}
                    onUpdate={updateConfig}
                  />
                </Suspense>
              )}
            </div>

            <aside className="space-y-5">
              <section className="rounded-xl border border-surface-3 bg-surface-1 p-5">
                <h2 className="text-base font-semibold text-ink-primary">准备情况</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <InfoRow label="套餐" value={getProfileAccessLabel(profile)} />
                  <InfoRow label="干员" value={operators ? `${ownedOperatorCount} 名` : '还未上传'} />
                  <InfoRow label="已拥有" value={operators ? `${ownedOperatorCount} 名` : '-'} />
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-ink-muted">基建配置</dt>
                    <dd className={`font-medium ${configValidation.ok ? 'text-success' : 'text-error'}`}>{configValidation.ok ? (configChanged ? '已修改' : '已保存') : '请检查'}</dd>
                  </div>
                </dl>
              </section>
              <button type="submit" disabled={saving || freePreviewNeedsBinding || !operators || !configValidation.ok} className="w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                {saving ? '正在保存...' : '保存工作区并开始排班'}
              </button>
            </aside>
          </div>
        </form>
      </main>

      <SklandBindingDialog
        open={sklandDialogOpen}
        profile={profile}
        context="workspace"
        onOpenChange={setSklandDialogOpen}
        onPayload={applySklandPayload}
      />
    </div>
  )
}

function SklandStatusCard({
  profile,
  busy,
  dialogOpen,
  notice,
  onOpen,
  onRefresh,
}: {
  profile: UserGameAccount
  busy: boolean
  dialogOpen: boolean
  notice: SklandRefreshNotice | null
  onOpen: () => void
  onRefresh: () => void
}) {
  const binding = profile.skland_binding
  const invalid = binding?.credential_status === 'invalid'
  const canRefresh = Boolean(binding && !invalid)
  return (
    <div className="mt-4 rounded-lg border border-surface-3 bg-surface-0 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink-primary">森空岛导入</p>
            {binding ? (
              <span className={'rounded-md px-2.5 py-1 text-xs font-semibold ' + (invalid ? 'bg-error/10 text-error' : 'bg-success/10 text-success')}>
                {invalid ? '凭据已失效' : '已绑定'}
              </span>
            ) : (
              <span className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-muted">未绑定</span>
            )}
          </div>
          {binding ? (
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <StatusInfo label="昵称" value={binding.nickname} />
              <StatusInfo label="UID" value={binding.uid} />
              <StatusInfo label="服务器" value={binding.channel_name} />
              <StatusInfo label="绑定时间" value={formatDate(binding.bound_at)} />
              <StatusInfo label="最近刷新" value={formatDate(binding.last_imported_at)} />
              <StatusInfo label="凭据状态" value={invalid ? sklandCredentialInvalidLabel(binding.credential_invalid_reason) : '可用'} danger={invalid} />
            </dl>
          ) : (
            <p className="mt-2 text-sm leading-6 text-ink-secondary">扫码、粘贴凭据或书签脚本都会先预览昵称和 UID，确认后才保存绑定并导入。</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOpen} disabled={busy || dialogOpen} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
            {binding ? '重新绑定森空岛' : '绑定森空岛'}
          </button>
          <button type="button" onClick={onRefresh} disabled={busy || dialogOpen || !canRefresh} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:bg-surface-2 disabled:text-ink-muted">
            {busy ? '正在刷新...' : '刷新森空岛数据'}
          </button>
        </div>
      </div>
      {notice && (
        <div className={'mt-3 rounded-lg border px-3 py-2 text-sm leading-6 ' + (notice.kind === 'error' ? 'border-error/30 bg-error/10 text-error' : 'border-success/30 bg-success/10 text-success')} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <p>{notice.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(notice.recovery_action === 'rebind' || notice.recovery_action === 'bind_first') && (
              <button type="button" onClick={onOpen} disabled={busy || dialogOpen} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted">
                重新绑定森空岛
              </button>
            )}
            {notice.recovery_action === 'retry' && (
              <button type="button" onClick={onRefresh} disabled={busy || dialogOpen || !binding} className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:text-ink-muted">
                再次刷新
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusInfo({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-surface-3 bg-surface-1 px-3 py-2">
      <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
      <dd className={'mt-1 break-words font-medium ' + (danger ? 'text-error' : 'text-ink-primary')}>{value}</dd>
    </div>
  )
}

function OperatorPreviewCard({ operator }: { operator: LicenseOperator }) {
  const avatarRef = useRef<HTMLDivElement | null>(null)
  const [shouldLoadAvatar, setShouldLoadAvatar] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const owned = operator.own !== false
  const level = typeof operator.level === 'number' ? operator.level : typeof operator.level === 'string' ? operator.level : '-'

  useEffect(() => {
    setImageFailed(false)
    setShouldLoadAvatar(false)
  }, [operator.id])

  useEffect(() => {
    const target = avatarRef.current
    if (!target || shouldLoadAvatar) return
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoadAvatar(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setShouldLoadAvatar(true)
        observer.disconnect()
      },
      { root: null, rootMargin: '360px 0px', threshold: 0.01 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [shouldLoadAvatar])

  return (
    <article className={`flex min-w-0 items-center gap-3 rounded-lg border border-surface-3 bg-surface-0 p-3 ${owned ? '' : 'opacity-55 grayscale'}`}>
      <div ref={avatarRef} className="h-14 w-14 flex-none overflow-hidden rounded-lg bg-surface-2">
        {shouldLoadAvatar && !imageFailed ? (
          <img
            src={`/webp96/${operator.id}.webp`}
            alt={operator.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-ink-muted">{operator.name.slice(0, 1)}</div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink-primary">{operator.name}</p>
        <p className="mt-1 text-xs text-ink-muted">精 {operator.elite} / Lv {level}</p>
        {!owned && <p className="mt-1 text-xs font-medium text-ink-muted">未拥有</p>}
      </div>
    </article>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-surface-3 pb-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink-primary">{value}</dd>
    </div>
  )
}

function SectionFallback() {
  return <div className="rounded-xl border border-surface-3 bg-surface-1 p-6 text-sm text-ink-secondary">正在载入配置...</div>
}

function sklandPayloadFromError(caught: unknown): Partial<SklandPayload> | null {
  if (!(caught instanceof ApiError) || !caught.data || typeof caught.data !== 'object') return null
  return caught.data as Partial<SklandPayload>
}

function formatSklandImportNotice(imported: NonNullable<SklandPayload['skland_import']>, verb: string): string {
  const base = `${verb} ${imported.operator_count} 名干员：${imported.nickname}`
  if (imported.inventory_synced && imported.intermediate_inventory) {
    return `${base}。已同步${formatInventoryAmount('Pure Gold', imported.intermediate_inventory['Pure Gold'])}、${formatInventoryAmount('Originium Shard', imported.intermediate_inventory['Originium Shard'])}到基建配置。`
  }
  if (imported.inventory_warning) return `${base}。干员已导入，库存同步失败，可稍后刷新。`
  return base
}

function formatInventoryAmount(product: IntermediateProduct, value: number | undefined): string {
  const label = product === 'Pure Gold' ? '赤金' : '源石碎片'
  const count = Number(value ?? 0)
  return `${label} ${Number.isFinite(count) ? count : 0}`
}

function formatSklandRefreshError(data: Partial<SklandPayload> | null, status: number): string {
  if (data?.code === 'skland_credential_invalid') {
    return data.error || '森空岛凭据已失效。请重新绑定森空岛后再刷新。'
  }
  if (data?.code === 'skland_not_bound') {
    return data.error || '当前账号尚未绑定森空岛。请先完成绑定。'
  }
  if (data?.code === 'skland_depot_refresh_forbidden') {
    return data.error || '仓库分析档案不能刷新工作区，请到仓库价值分析页重新分析。'
  }
  return data?.error || `森空岛刷新失败: ${status}。请稍后重试。`
}

function sklandCredentialInvalidLabel(reason: string | null | undefined): string {
  if (reason === 'credential_format_invalid') return '凭据格式无效，请重新绑定'
  if (reason === 'expired_or_revoked') return '凭据已失效，请重新绑定'
  return '凭据不可用，请重新绑定'
}
