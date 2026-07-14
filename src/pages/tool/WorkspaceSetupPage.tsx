import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Announcement, AuthSuccessResponse, AuthUser, LicenseConfig, LicenseOperator, UserGameAccount, UserWorkspace } from '../../lib/types'
import AnnouncementBanner from '../../components/AnnouncementBanner'
import BrandLogo from '../../components/BrandLogo'
import SklandBindingDialog, { type SklandPayload } from '../../components/SklandBindingDialog'
import { ApiError, apiJson } from '../../lib/api-client'
import { CONFIG_PRESETS, cloneConfig, normalizeConfig, validateConfig } from '../../lib/config'
import { canonicalJson } from '../../lib/crypto'
import { ACTIVE_PURCHASE_CHANNEL } from '../../lib/purchase'
import type { WorkspaceSetupSection } from '../../lib/app-routes'
import { countOwnedOperators, formatDate, getEffectiveProfilePermission, getProfileAccessLabel, isFreePreviewProfile, isFreePreviewTrialActive, parseOperatorsText, sortOperatorsForPreview } from './tool-utils'

const WorkspaceConfigSection = lazy(() => import('./workspace/WorkspaceConfigSection'))

export type { WorkspaceSetupSection } from '../../lib/app-routes'
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
  activeSection,
  onSectionChange,
  onSaved,
  onSynced,
  onBack,
  onRedeemNewProfile,
  onLogout,
}: {
  user: AuthUser
  profile: UserGameAccount
  workspace: UserWorkspace | null
  announcement: Announcement | null
  activeSection: WorkspaceSetupSection
  onSectionChange: (section: WorkspaceSetupSection) => void
  onSaved: (payload: AuthSuccessResponse) => void
  onSynced: (payload: AuthSuccessResponse) => void
  onBack: () => void
  onRedeemNewProfile: () => void
  onLogout: () => void
}) {
  const [operators, setOperators] = useState<LicenseOperator[] | null>(workspace?.operators ?? null)
  const [operatorFileName, setOperatorFileName] = useState<string | null>(null)
  const [operatorSearch, setOperatorSearch] = useState('')
  const [config, setConfig] = useState<LicenseConfig>(() => normalizeConfig(workspace?.config ?? cloneConfig(CONFIG_PRESETS['243'])))
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sklandDialogOpen, setSklandDialogOpen] = useState(false)
  const [sklandRefreshing, setSklandRefreshing] = useState(false)
  const [sklandRefreshNotice, setSklandRefreshNotice] = useState<SklandRefreshNotice | null>(null)

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
  const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])
  const isPreviewProfile = isFreePreviewProfile(profile)
  const isPreviewTrial = isFreePreviewTrialActive(profile)
  const effectivePermission = getEffectiveProfilePermission(profile)
  const canEditConfig = effectivePermission === 'advanced' || effectivePermission === 'ultimate' || effectivePermission === 'admin'
  const canEditLimitedConfig = !canEditConfig && (isPreviewProfile || effectivePermission === 'recommended' || effectivePermission === 'growth')
  const freePreviewNeedsBinding = isPreviewProfile && !profile.skland_binding
  const canManualEditOperators = !isPreviewProfile || isPreviewTrial
  const ownedOperatorCount = useMemo(() => countOwnedOperators(operators), [operators])
  const configChanged = workspace?.config ? canonicalJson(normalizedConfig) !== canonicalJson(workspace.config) : true
  const filteredOperators = useMemo(() => {
    const keyword = operatorSearch.trim().toLowerCase()
    const source = sortOperatorsForPreview((operators ?? []).filter((operator) => operator.own !== false))
    return keyword ? source.filter((operator) => operator.name.toLowerCase().includes(keyword)) : source
  }, [operatorSearch, operators])
  const setupSections: Array<{ id: WorkspaceSetupSection; label: string; ready?: boolean }> = [
    { id: 'operators', label: '干员数据', ready: Boolean(operators) },
    { id: 'config', label: '基建配置', ready: configValidation.ok },
    { id: 'cdk', label: '档案与 CDK' },
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
    if (isPreviewProfile && !isPreviewTrial) {
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
          ...((isPreviewProfile && !isPreviewTrial) ? {} : { operators }),
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
    <div className="tool-shell">
      <aside className="tool-sidebar fixed inset-y-0 left-0 hidden w-64 px-4 py-5 lg:block">
        <div className="flex items-start gap-3 px-2">
          <BrandLogo size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-500">MAA 工作台</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
            <p className="mt-3 truncate text-sm font-medium text-ink-primary">{profile.display_name}</p>
          </div>
        </div>
        <nav className="mt-5 space-y-1 border-t border-surface-3 pt-5" aria-label="工作区设置">
          {setupSections.map((section) => (
            <button key={section.id} type="button" onClick={() => onSectionChange(section.id)} aria-current={activeSection === section.id ? 'page' : undefined} className="tool-nav-link flex w-full items-center justify-between px-3 text-left text-sm font-medium">
              <span>{section.label}</span>
              {section.ready !== undefined && <span className={`text-xs font-medium ${section.ready ? 'text-success' : 'text-ink-muted'}`}>{section.ready ? '已就绪' : '待完成'}</span>}
            </button>
          ))}
        </nav>
        <button type="button" onClick={onBack} className="tool-secondary-action absolute bottom-16 left-4 right-4">返回账号列表</button>
        <button type="button" onClick={onLogout} className="tool-secondary-action absolute bottom-5 left-4 right-4">退出登录</button>
      </aside>

      <main className="lg:pl-64" tabIndex={-1} data-route-focus>
        <header className="tool-header sticky top-0 z-20 px-5 py-4 sm:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <BrandLogo size="sm" className="lg:hidden" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-400">{profile.display_name}</p>
                <h1 className="mt-1 text-xl font-semibold text-ink-primary">准备账号工作区</h1>
                <p className="mt-1 text-sm text-ink-muted">上传干员识别文件并确认基建配置，保存后进入排班优化。</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onBack} className="tool-secondary-action">返回账号列表</button>
              <button type="button" onClick={onLogout} className="tool-secondary-action lg:hidden">退出登录</button>
            </div>
          </div>
          <nav className="mx-auto mt-4 flex max-w-7xl gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="移动端工作区设置">
            {setupSections.map((section) => (
              <button key={section.id} type="button" onClick={() => onSectionChange(section.id)} aria-current={activeSection === section.id ? 'page' : undefined} className="tool-nav-link shrink-0 whitespace-nowrap px-3 text-sm font-medium">{section.label}</button>
            ))}
          </nav>
          {announcement?.active && <AnnouncementBanner announcement={announcement} className="mt-4" />}
        </header>

        {activeSection === 'cdk' ? (
          <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
            <ProfileCdkPaths profile={profile} onUpgraded={onSynced} onRedeemNewProfile={onRedeemNewProfile} />
          </div>
        ) : (
          <form onSubmit={handleSave} className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
          <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
              {status && <div className="tool-alert tool-alert--success" role="status" aria-live="polite">{status}</div>}

              {activeSection === 'operators' && (
                <section className="tool-panel p-5 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-ink-primary">干员数据</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">上传 MAA 导出的干员识别文件，或使用森空岛扫码导入后预览干员头像、精英化和等级。</p>
                    </div>
                    {operators && <span className="tool-status tool-status--success">已就绪</span>}
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label className="tool-secondary-action inline-flex cursor-pointer items-center justify-center">
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
                      <input value={operatorSearch} onChange={(event) => setOperatorSearch(event.currentTarget.value)} className="tool-field mb-4" placeholder="搜索干员名称" aria-label="搜索干员名称" />
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
              <section className="tool-panel p-5">
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
              <button type="submit" disabled={saving || freePreviewNeedsBinding || !operators || !configValidation.ok} className="tool-primary-action w-full">
                {saving ? '正在保存...' : '保存工作区并开始排班'}
              </button>
            </aside>
          </div>
          </form>
        )}
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

function ProfileCdkPaths({
  profile,
  onUpgraded,
  onRedeemNewProfile,
}: {
  profile: UserGameAccount
  onUpgraded: (payload: AuthSuccessResponse) => void
  onRedeemNewProfile: () => void
}) {
  const [upgradeCdk, setUpgradeCdk] = useState('')
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)
  const isPreviewProfile = isFreePreviewProfile(profile)

  const handleUpgrade = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!isPreviewProfile || upgradeLoading) return
    setUpgradeLoading(true)
    setUpgradeError(null)
    try {
      const data = await apiJson<AuthSuccessResponse>('/api/user/profiles/redeem', {
        method: 'POST',
        json: { profile_id: profile.id, cdk: upgradeCdk },
        fallbackMessage: '免费档案升级失败',
      })
      setUpgradeCdk('')
      onUpgraded(data)
    } catch (caught) {
      setUpgradeError((caught as Error).message)
    } finally {
      setUpgradeLoading(false)
    }
  }

  return (
    <section className="tool-panel p-5 sm:p-6" aria-labelledby="profile-cdk-paths-title">
      <div>
        <h2 id="profile-cdk-paths-title" className="text-lg font-semibold text-ink-primary">档案与 CDK</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
          {isPreviewProfile
            ? '可以用 CDK 原地升级当前免费档案并保留工作区，也可以兑换为新的独立档案。'
            : '当前档案已经使用正式授权；如需管理其他游戏账号，可以继续兑换新的独立档案。'}
        </p>
      </div>

      <div className={`mt-5 grid gap-4 ${isPreviewProfile ? 'lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {isPreviewProfile && (
          <form onSubmit={handleUpgrade} className="tool-inset border-brand-600/30 bg-brand-600/10 p-4">
            <h3 className="text-sm font-semibold text-ink-primary">升级当前免费档案</h3>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">保留干员、森空岛绑定、基建配置与历史记录，直接解锁 CDK 权益。</p>
            <label htmlFor="workspace-upgrade-cdk" className="mt-4 block text-sm font-medium text-ink-secondary">升级 CDK</label>
            <input
              id="workspace-upgrade-cdk"
              value={upgradeCdk}
              onChange={(event) => setUpgradeCdk(event.currentTarget.value)}
              className="tool-field mt-2 font-mono uppercase tracking-wide"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              required
            />
            {upgradeError && <p className="mt-3 text-sm leading-6 text-error" role="alert">{upgradeError}</p>}
            <button
              type="submit"
              disabled={upgradeLoading}
              className="tool-primary-action mt-4 w-full disabled:cursor-wait"
            >
              {upgradeLoading ? '正在升级...' : '升级当前免费档案'}
            </button>
          </form>
        )}

        <div className="tool-inset flex flex-col p-4">
          <h3 className="text-sm font-semibold text-ink-primary">兑换新的 CDK 档案</h3>
          <p className="mt-2 flex-1 text-sm leading-6 text-ink-secondary">前往“添加账号”输入未使用的 CDK，创建独立档案；当前工作区不会改变。</p>
          <button
            type="button"
            onClick={onRedeemNewProfile}
            className="tool-secondary-action mt-4"
          >
            前往兑换新档案
          </button>
        </div>

        {ACTIVE_PURCHASE_CHANNEL && (
          <div className="tool-inset flex flex-col p-4">
            <h3 className="text-sm font-semibold text-ink-primary">还没有 CDK</h3>
            <p className="mt-2 flex-1 text-sm leading-6 text-ink-secondary">通过当前可用的购买渠道获取 CDK，购买后返回此处升级或兑换。</p>
            <a
              href={ACTIVE_PURCHASE_CHANNEL.href ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="tool-secondary-action mt-4"
            >
              {ACTIVE_PURCHASE_CHANNEL.actionLabel}
            </a>
          </div>
        )}
      </div>
    </section>
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
    <div className="tool-inset mt-4 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink-primary">森空岛导入</p>
            {binding ? (
              <span className={'tool-status ' + (invalid ? 'tool-status--error' : 'tool-status--success')}>
                {invalid ? '凭据已失效' : '已绑定'}
              </span>
            ) : (
              <span className="tool-status">未绑定</span>
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
          <button type="button" onClick={onOpen} disabled={busy || dialogOpen} className="tool-primary-action">
            {binding ? '重新绑定森空岛' : '绑定森空岛'}
          </button>
          <button type="button" onClick={onRefresh} disabled={busy || dialogOpen || !canRefresh} className="tool-secondary-action">
            {busy ? '正在刷新...' : '刷新森空岛数据'}
          </button>
        </div>
      </div>
      {notice && (
        <div className={'tool-alert mt-3 ' + (notice.kind === 'error' ? 'tool-alert--error' : 'tool-alert--success')} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live={notice.kind === 'error' ? undefined : 'polite'}>
          <p>{notice.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(notice.recovery_action === 'rebind' || notice.recovery_action === 'bind_first') && (
              <button type="button" onClick={onOpen} disabled={busy || dialogOpen} className="tool-primary-action min-h-9 px-3 py-1.5 text-xs">
                重新绑定森空岛
              </button>
            )}
            {notice.recovery_action === 'retry' && (
              <button type="button" onClick={onRefresh} disabled={busy || dialogOpen || !binding} className="tool-secondary-action min-h-9 px-3 py-1.5 text-xs">
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
    <div className="tool-inset min-w-0 px-3 py-2">
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
    <article className={`tool-inset flex min-w-0 items-center gap-3 p-3 ${owned ? '' : 'opacity-55 grayscale'}`}>
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
  return <div className="tool-panel p-6 text-sm text-ink-secondary">正在载入配置...</div>
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
