import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGroup } from 'motion/react'
import type { Announcement, AuthSuccessResponse, AuthUser, IntermediateProduct, LicenseConfig, LicenseOperator, UserGameAccount, UserWorkspace } from '../../lib/types'
import AnnouncementBanner from '../../components/AnnouncementBanner'
import BrandLogo from '../../components/BrandLogo'
import CompactHeaderMenu from '../../components/CompactHeaderMenu'
import GuidedTour, { useFirstRunTour, type TourDefinition } from '../../components/GuidedTour'
import { AnimatedPresenceRegion, MotionNavIndicator, MotionSkeleton } from '../../components/MotionPrimitives'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import ToolBreadcrumbs from '../../components/ToolBreadcrumbs'
import SklandBindingDialog, { type SklandPayload } from '../../components/SklandBindingDialog'
import { ApiError, apiJson } from '../../lib/api-client'
import { CONFIG_PRESETS, cloneConfig, normalizeConfig, validateConfig } from '../../lib/config'
import { canonicalJson } from '../../lib/crypto'
import { resolveActivePurchaseChannel } from '../../lib/purchase'
import { dashboardPath, profileScopedPath, workspaceSetupPath, type WorkspaceSetupSection } from '../../lib/app-routes'
import { countOwnedOperators, formatDate, getEffectiveProfilePermission, getProfileAccessLabel, isFreePreviewProfile, parseOperatorsText, sortOperatorsForPreview } from './tool-utils'
import { copy } from '../../copy/index'
import { hasCapability } from '../../lib/product-catalog'
import { useSiteFeatures } from '../../lib/site-feature-context'
import { usePublicContent } from '../../lib/public-content-context'
import { NotificationBell } from '../../components/NotificationCenter'
import { upgradeProfileWithCdk } from './profile-redemption'


const WorkspaceConfigSection = lazy(() => import('./workspace/WorkspaceConfigSection'))

export type { WorkspaceSetupSection } from '../../lib/app-routes'
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
  const { features } = useSiteFeatures()
  const { content, isFallback } = usePublicContent()
  const activePurchaseChannel = isFallback ? undefined : resolveActivePurchaseChannel(content.cdk_purchase.xianyu_url)
  const onSectionChangeRef = useRef(onSectionChange)
  onSectionChangeRef.current = onSectionChange
  const setupTour = useFirstRunTour({ id: 'workspace-setup', version: 1 })
  const setupTourDefinition = useMemo<TourDefinition>(() => ({
    id: 'workspace-setup',
    version: 1,
    steps: [
      { target: 'workspace-setup-nav', title: copy.workspace.pages_tool_WorkspaceSetupPage_tour_002, body: copy.workspace.pages_tool_WorkspaceSetupPage_tour_003 },
      { target: 'config-preset-actions', title: copy.workspace.pages_tool_WorkspaceSetupPage_tour_004, body: copy.workspace.pages_tool_WorkspaceSetupPage_tour_005, onEnter: () => onSectionChangeRef.current('config') },
      { target: 'workspace-config-editor', title: copy.workspace.pages_tool_WorkspaceSetupPage_tour_006, body: copy.workspace.pages_tool_WorkspaceSetupPage_tour_007 },
      { target: 'workspace-start-scheduling', title: copy.workspace.pages_tool_WorkspaceSetupPage_tour_008, body: copy.workspace.pages_tool_WorkspaceSetupPage_tour_009 },
    ],
  }), [])
  const [operators, setOperators] = useState<LicenseOperator[] | null>(workspace?.operators ?? null)
  const [operatorFileName, setOperatorFileName] = useState<string | null>(null)
  const [operatorSearch, setOperatorSearch] = useState('')
  const [config, setConfig] = useState<LicenseConfig>(() => normalizeConfig(workspace?.config ?? cloneConfig(CONFIG_PRESETS['243'])))
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [operatorUploading, setOperatorUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sklandDialogOpen, setSklandDialogOpen] = useState(false)
  const [sklandRefreshing, setSklandRefreshing] = useState(false)
  const [sklandRefreshNotice, setSklandRefreshNotice] = useState<SklandRefreshNotice | null>(null)

  const normalizedConfig = useMemo(() => normalizeConfig(config), [config])
  const configValidation = useMemo(() => validateConfig(normalizedConfig), [normalizedConfig])
  const isPreviewProfile = isFreePreviewProfile(profile)
  const effectivePermission = getEffectiveProfilePermission(profile)
  const canEditConfig = hasCapability({ permission: effectivePermission }, 'edit_full_config')
  const canEditLimitedConfig = !canEditConfig && (isPreviewProfile || hasCapability({ permission: effectivePermission }, 'edit_limited_config'))
  const freePreviewNeedsBinding = isPreviewProfile && !profile.skland_binding
  const canManualEditOperators = !isPreviewProfile
  const ownedOperatorCount = useMemo(() => countOwnedOperators(operators), [operators])
  const configChanged = workspace?.config ? canonicalJson(normalizedConfig) !== canonicalJson(workspace.config) : true
  const filteredOperators = useMemo(() => {
    const keyword = operatorSearch.trim().toLowerCase()
    const source = sortOperatorsForPreview((operators ?? []).filter((operator) => operator.own !== false))
    return keyword ? source.filter((operator) => operator.name.toLowerCase().includes(keyword)) : source
  }, [operatorSearch, operators])
  const setupSections: Array<{ id: WorkspaceSetupSection; label: string; ready?: boolean }> = [
    { id: 'operators', label: copy.workspace.pages_tool_WorkspaceSetupPage_001, ready: Boolean(operators) },
    { id: 'config', label: copy.workspace.pages_tool_WorkspaceSetupPage_002, ready: configValidation.ok },
    ...(features.cdk_redemption ? [{ id: 'cdk' as const, label: copy.workspace.pages_tool_WorkspaceSetupPage_003 }] : []),
  ]

  const updateConfig = useCallback((mutate: (config: LicenseConfig) => void) => {
    const next = normalizeConfig(normalizedConfig)
    mutate(next)
    setConfig(next)
  }, [normalizedConfig])

  const handleOperatorsFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    setError(null)
    setStatus(null)
    setSklandRefreshNotice(null)
    if (isPreviewProfile) {
      setOperatorFileName(null)
      setError(copy.workspace.pages_tool_WorkspaceSetupPage_004)
      input.value = ''
      return
    }
    if (!file) return
    setOperatorUploading(true)
    try {
      const importedOperators = parseOperatorsText(await file.text())
      const data = await apiJson<AuthSuccessResponse>('/api/user/workspace', {
        method: 'PATCH',
        json: { profile_id: profile.id, operators: importedOperators },
        fallbackMessage: copy.workspace.pages_tool_WorkspaceSetupPage_096,
      })
      if (!data.user) throw new Error(copy.workspace.pages_tool_WorkspaceSetupPage_096)
      setOperators(data.workspace?.operators ?? importedOperators)
      setOperatorFileName(file.name)
      setStatus(copy.workspace.pages_tool_WorkspaceSetupPage_097)
      onSynced(data)
    } catch (caught) {
      setOperatorFileName(null)
      setError((caught as Error).message)
    } finally {
      setOperatorUploading(false)
      input.value = ''
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
        fallbackMessage: copy.workspace.pages_tool_WorkspaceSetupPage_005,
      })
      if (!data.user) throw new Error(copy.workspace.pages_tool_WorkspaceSetupPage_006)
      applySklandPayload(data)
      setSklandRefreshNotice({
        kind: 'success',
        message: data.skland_import
          ? formatSklandImportNotice(data.skland_import, copy.workspace.pages_tool_WorkspaceSetupPage_007)
          : copy.workspace.pages_tool_WorkspaceSetupPage_008,
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
      setError(copy.workspace.pages_tool_WorkspaceSetupPage_009)
      return
    }
    if (freePreviewNeedsBinding) {
      setError(copy.workspace.pages_tool_WorkspaceSetupPage_010)
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
          ...(!isPreviewProfile ? { operators } : {}),
          config: normalizedConfig,
          elite_overrides: workspace?.elite_overrides ?? {},
        },
        fallbackMessage: copy.workspace.pages_tool_WorkspaceSetupPage_011,
      })
      if (!data.user) throw new Error(copy.workspace.pages_tool_WorkspaceSetupPage_012)
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
            <p className="text-sm font-semibold text-brand-500">{copy.workspace.pages_tool_WorkspaceSetupPage_013}</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{user.email}</p>
            <p className="mt-3 truncate text-sm font-medium text-ink-primary">{profile.display_name}</p>
          </div>
        </div>
        <LayoutGroup id="workspace-desktop">
          <nav className="mt-5 space-y-1 border-t border-surface-3 pt-5" aria-label={copy.workspace.pages_tool_WorkspaceSetupPage_014} data-tour-target="workspace-setup-nav">
            {setupSections.map((section) => (
              <button key={section.id} type="button" onClick={() => onSectionChange(section.id)} aria-current={activeSection === section.id ? 'page' : undefined} className="tool-nav-link flex w-full items-center justify-between px-3 text-left text-sm font-medium">
                {activeSection === section.id && <MotionNavIndicator layoutId="workspace-active" />}
                <span className="relative z-10">{section.label}</span>
                {section.ready !== undefined && <span className={`relative z-10 text-xs font-medium ${section.ready ? 'text-success' : 'text-ink-muted'}`}>{section.ready ? copy.workspace.pages_tool_WorkspaceSetupPage_015 : copy.workspace.pages_tool_WorkspaceSetupPage_016}</span>}
              </button>
            ))}
          </nav>
        </LayoutGroup>
        <nav className="absolute bottom-5 left-4 right-4 grid grid-cols-2 gap-2" aria-label={copy.workspace.pages_tool_WorkspaceSetupPage_018_account_actions}>
          <button type="button" onClick={onBack} className="tool-secondary-action w-full">{copy.workspace.pages_tool_WorkspaceSetupPage_017}</button>
          <button type="button" onClick={onLogout} className="tool-danger-action w-full">{copy.workspace.pages_tool_WorkspaceSetupPage_018}</button>
        </nav>
      </aside>

      <main className="lg:pl-64" tabIndex={-1} data-route-focus>
        <header className="tool-header sticky top-0 z-20 px-4 py-1.5 lg:px-8 lg:py-4">
          <div className="mx-auto flex h-11 max-w-7xl items-center justify-between gap-2 lg:hidden">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <BrandLogo size="sm" />
              <CompactHeaderMenu
                ariaLabel={copy.common.components_CompactHeaderMenu_001}
                triggerLabel={setupSections.find((item) => item.id === activeSection)?.label}
                align="start"
                tourTargets={['workspace-setup-nav']}
                className="min-w-0 flex-1 justify-between"
                metadata={{ title: profile.display_name, description: copy.workspace.pages_tool_WorkspaceSetupPage_020 }}
                items={[
                  ...setupSections.map((item) => ({
                    type: 'button' as const,
                    id: item.id,
                    label: item.label,
                    current: activeSection === item.id,
                    badge: item.ready === undefined ? undefined : item.ready ? copy.workspace.pages_tool_WorkspaceSetupPage_015 : copy.workspace.pages_tool_WorkspaceSetupPage_016,
                    tourTarget: 'workspace-setup-nav',
                    onSelect: () => onSectionChange(item.id),
                  })),
                  { type: 'separator' as const, id: 'actions' },
                  { type: 'button' as const, id: 'tour', label: copy.workspace.pages_tool_WorkspaceSetupPage_tour_001, onSelect: setupTour.start },
                  { type: 'button' as const, id: 'back', label: copy.workspace.pages_tool_WorkspaceSetupPage_021, onSelect: onBack },
                  { type: 'button' as const, id: 'logout', label: copy.workspace.pages_tool_WorkspaceSetupPage_022, intent: 'danger' as const, onSelect: onLogout },
                ]}
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <NotificationBell iconOnly />
              <ThemeSwitcher iconOnly />
            </div>
          </div>

          <div className="mx-auto hidden max-w-7xl items-center justify-between gap-4 lg:flex">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0">
                <ToolBreadcrumbs
                  className="mb-2"
                  items={[
                    { id: 'home', label: copy.common.components_ToolBreadcrumbs_002, to: '/' },
                    { id: 'profiles', label: copy.common.components_ToolBreadcrumbs_003, to: dashboardPath('profiles') },
                    { id: 'profile', label: profile.display_name, to: profileScopedPath(dashboardPath('profiles'), profile.id) },
                    { id: 'workspace', label: copy.workspace.pages_tool_WorkspaceSetupPage_014, to: profileScopedPath(workspaceSetupPath('operators'), profile.id) },
                    { id: 'current', label: setupSections.find((item) => item.id === activeSection)?.label ?? setupSections[0].label },
                  ]}
                />
                <h1 className="display-title mt-1 text-xl text-ink-primary">{copy.workspace.pages_tool_WorkspaceSetupPage_019}</h1>
                <p className="mt-1 text-sm text-ink-muted">{copy.workspace.pages_tool_WorkspaceSetupPage_020}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={setupTour.start} className="tool-secondary-action">
                {copy.workspace.pages_tool_WorkspaceSetupPage_tour_001}
              </button>
              <NotificationBell />
              <ThemeSwitcher />
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl space-y-4 px-5 py-6 sm:px-8">
          <AnnouncementBanner announcement={announcement} />
          <AnimatedPresenceRegion motionKey={activeSection}>
            {activeSection === 'cdk' ? (
              <ProfileCdkPaths
                profile={profile}
                purchaseChannel={activePurchaseChannel}
                onUpgraded={onSynced}
                onRedeemNewProfile={onRedeemNewProfile}
              />
            ) : (
              <form onSubmit={handleSave}>
                <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
                  <div className="space-y-5">
                    {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
                    {status && <div className="tool-alert tool-alert--success" role="status" aria-live="polite">{status}</div>}

                    {activeSection === 'operators' && (
                      <section className="tool-panel p-5 sm:p-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h2 className="text-lg font-semibold text-ink-primary">{copy.workspace.pages_tool_WorkspaceSetupPage_024}</h2>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">{copy.workspace.pages_tool_WorkspaceSetupPage_025}</p>
                          </div>
                          {operators && <span className="tool-status tool-status--success">{copy.workspace.pages_tool_WorkspaceSetupPage_026}</span>}
                        </div>

                        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                          <label className="tool-secondary-action inline-flex cursor-pointer items-center justify-center">
                            {operatorFileName ? `${copy.workspace.pages_tool_WorkspaceSetupPage_027}${operatorFileName}` : operators ? `${copy.workspace.pages_tool_WorkspaceSetupPage_028}${ownedOperatorCount}${copy.workspace.pages_tool_WorkspaceSetupPage_029}` : copy.workspace.pages_tool_WorkspaceSetupPage_030}
                            <input type="file" accept=".json,.txt,application/json,text/plain" onChange={handleOperatorsFile} disabled={!canManualEditOperators || operatorUploading} className="hidden" />
                          </label>
                          {operators && <span className="text-sm text-brand-400">{copy.workspace.pages_tool_WorkspaceSetupPage_031}{ownedOperatorCount} {copy.workspace.pages_tool_WorkspaceSetupPage_032}</span>}
                        </div>

                        {features.skland && <SklandStatusCard
                          profile={profile}
                          busy={sklandRefreshing}
                          dialogOpen={sklandDialogOpen}
                          notice={sklandRefreshNotice}
                          onOpen={() => setSklandDialogOpen(true)}
                          onRefresh={handleRefreshSkland}
                        />}

                        {operators && (
                          <div className="mt-5">
                            <input value={operatorSearch} onChange={(event) => setOperatorSearch(event.currentTarget.value)} className="tool-field mb-4" placeholder={copy.workspace.pages_tool_WorkspaceSetupPage_033} aria-label={copy.workspace.pages_tool_WorkspaceSetupPage_034} />
                            <div className="grid max-h-[560px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                              {filteredOperators.map((operator) => <OperatorPreviewCard key={operator.id} operator={operator} />)}
                            </div>
                          </div>
                        )}
                      </section>
                    )}

                    {activeSection === 'config' && (
                      <div data-tour-target="workspace-config-editor">
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
                      </div>
                    )}
                  </div>

                  <aside className="space-y-5">
                    <section className="tool-panel p-5">
                      <h2 className="text-base font-semibold text-ink-primary">{copy.workspace.pages_tool_WorkspaceSetupPage_035}</h2>
                      <dl className="mt-4 space-y-3 text-sm">
                        <InfoRow label={copy.workspace.pages_tool_WorkspaceSetupPage_036} value={getProfileAccessLabel(profile)} />
                        <InfoRow label={copy.workspace.pages_tool_WorkspaceSetupPage_037} value={operators ? `${ownedOperatorCount}${copy.workspace.pages_tool_WorkspaceSetupPage_038}` : copy.workspace.pages_tool_WorkspaceSetupPage_039} />
                        <InfoRow label={copy.workspace.pages_tool_WorkspaceSetupPage_040} value={operators ? `${ownedOperatorCount}${copy.workspace.pages_tool_WorkspaceSetupPage_041}` : '-'} />
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-ink-muted">{copy.workspace.pages_tool_WorkspaceSetupPage_042}</dt>
                          <dd className={`font-medium ${configValidation.ok ? 'text-success' : 'text-error'}`}>{configValidation.ok ? (configChanged ? copy.workspace.pages_tool_WorkspaceSetupPage_043 : copy.workspace.pages_tool_WorkspaceSetupPage_044) : copy.workspace.pages_tool_WorkspaceSetupPage_045}</dd>
                        </div>
                      </dl>
                    </section>
                    <button type="submit" disabled={saving || freePreviewNeedsBinding || !operators || !configValidation.ok} className="tool-primary-action w-full" data-tour-target="workspace-start-scheduling">
                      {saving ? copy.workspace.pages_tool_WorkspaceSetupPage_046 : copy.workspace.pages_tool_WorkspaceSetupPage_047}
                    </button>
                  </aside>
                </div>
              </form>
            )}
          </AnimatedPresenceRegion>
        </div>
      </main>

      {features.skland && <SklandBindingDialog
        open={sklandDialogOpen}
        profile={profile}
        context="workspace"
        onOpenChange={setSklandDialogOpen}
        onPayload={applySklandPayload}
      />}
      <GuidedTour definition={setupTourDefinition} open={setupTour.open} onFinish={setupTour.finish} onSkip={setupTour.skip} />
    </div>
  )
}

function ProfileCdkPaths({
  profile,
  purchaseChannel,
  onUpgraded,
  onRedeemNewProfile,
}: {
  profile: UserGameAccount
  purchaseChannel: ReturnType<typeof resolveActivePurchaseChannel>
  onUpgraded: (payload: AuthSuccessResponse) => void
  onRedeemNewProfile: () => void
}) {
  const [upgradeCdk, setUpgradeCdk] = useState('')
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)
  const upgradeRequestRef = useRef<{ cdk: string; idempotencyKey: string } | null>(null)
  const isPreviewProfile = isFreePreviewProfile(profile)

  const handleUpgrade = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!isPreviewProfile || upgradeLoading) return
    const normalizedCdk = upgradeCdk.trim()
    const pendingRequest = upgradeRequestRef.current?.cdk === normalizedCdk
      ? upgradeRequestRef.current
      : { cdk: normalizedCdk, idempotencyKey: crypto.randomUUID() }
    upgradeRequestRef.current = pendingRequest
    setUpgradeLoading(true)
    setUpgradeError(null)
    try {
      const data = await upgradeProfileWithCdk({
        profileId: profile.id,
        cdk: upgradeCdk,
        idempotencyKey: pendingRequest.idempotencyKey,
        fallbackMessage: copy.workspace.pages_tool_WorkspaceSetupPage_048,
      })
      upgradeRequestRef.current = null
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
        <h2 id="profile-cdk-paths-title" className="text-lg font-semibold text-ink-primary">{copy.workspace.pages_tool_WorkspaceSetupPage_049}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
          {isPreviewProfile
            ? copy.workspace.pages_tool_WorkspaceSetupPage_050
            : copy.workspace.pages_tool_WorkspaceSetupPage_051}
        </p>
      </div>

      <div className={`mt-5 grid gap-4 ${isPreviewProfile ? 'lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {isPreviewProfile && (
          <form onSubmit={handleUpgrade} className="tool-inset border-brand-600/30 bg-brand-600/10 p-4">
            <h3 className="text-sm font-semibold text-ink-primary">{copy.workspace.pages_tool_WorkspaceSetupPage_052}</h3>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.workspace.pages_tool_WorkspaceSetupPage_053}</p>
            <label htmlFor="workspace-upgrade-cdk" className="mt-4 block text-sm font-medium text-ink-secondary">{copy.workspace.pages_tool_WorkspaceSetupPage_054}</label>
            <input
              id="workspace-upgrade-cdk"
              value={upgradeCdk}
              onChange={(event) => {
                upgradeRequestRef.current = null
                setUpgradeCdk(event.currentTarget.value)
              }}
              className="tool-field mt-2 font-mono uppercase tracking-wide"
              maxLength={256}
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
              {upgradeLoading ? copy.workspace.pages_tool_WorkspaceSetupPage_055 : copy.workspace.pages_tool_WorkspaceSetupPage_056}
            </button>
          </form>
        )}

        <div className="tool-inset flex flex-col p-4">
          <h3 className="text-sm font-semibold text-ink-primary">{copy.workspace.pages_tool_WorkspaceSetupPage_057}</h3>
          <p className="mt-2 flex-1 text-sm leading-6 text-ink-secondary">{copy.workspace.pages_tool_WorkspaceSetupPage_058}</p>
          <button
            type="button"
            onClick={onRedeemNewProfile}
            className="tool-secondary-action mt-4"
          >
            {copy.workspace.pages_tool_WorkspaceSetupPage_059}</button>
        </div>

        {purchaseChannel && (
          <div className="tool-inset flex flex-col p-4">
            <h3 className="text-sm font-semibold text-ink-primary">{copy.workspace.pages_tool_WorkspaceSetupPage_060}</h3>
            <p className="mt-2 flex-1 text-sm leading-6 text-ink-secondary">{copy.workspace.pages_tool_WorkspaceSetupPage_061}</p>
            <a
              href={purchaseChannel.href ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="tool-secondary-action mt-4"
            >
              {purchaseChannel.actionLabel}
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
            <p className="text-sm font-semibold text-ink-primary">{copy.workspace.pages_tool_WorkspaceSetupPage_062}</p>
            {binding ? (
              <span className={'tool-status ' + (invalid ? 'tool-status--error' : 'tool-status--success')}>
                {invalid ? copy.workspace.pages_tool_WorkspaceSetupPage_063 : copy.workspace.pages_tool_WorkspaceSetupPage_064}
              </span>
            ) : (
              <span className="tool-status">{copy.workspace.pages_tool_WorkspaceSetupPage_065}</span>
            )}
          </div>
          {binding ? (
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <StatusInfo label={copy.workspace.pages_tool_WorkspaceSetupPage_066} value={binding.nickname} />
              <StatusInfo label="UID" value={binding.uid} />
              <StatusInfo label={copy.workspace.pages_tool_WorkspaceSetupPage_067} value={binding.channel_name} />
              <StatusInfo label={copy.workspace.pages_tool_WorkspaceSetupPage_068} value={formatDate(binding.bound_at)} />
              <StatusInfo label={copy.workspace.pages_tool_WorkspaceSetupPage_069} value={formatDate(binding.last_imported_at)} />
              <StatusInfo label={copy.workspace.pages_tool_WorkspaceSetupPage_070} value={invalid ? sklandCredentialInvalidLabel(binding.credential_invalid_reason) : copy.workspace.pages_tool_WorkspaceSetupPage_071} danger={invalid} />
            </dl>
          ) : (
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.workspace.pages_tool_WorkspaceSetupPage_072}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOpen} disabled={busy || dialogOpen} className="tool-primary-action">
            {binding ? copy.workspace.pages_tool_WorkspaceSetupPage_073 : copy.workspace.pages_tool_WorkspaceSetupPage_074}
          </button>
          <button type="button" onClick={onRefresh} disabled={busy || dialogOpen || !canRefresh} className="tool-secondary-action">
            {busy ? copy.workspace.pages_tool_WorkspaceSetupPage_075 : copy.workspace.pages_tool_WorkspaceSetupPage_076}
          </button>
        </div>
      </div>
      {notice && (
        <div className={'tool-alert mt-3 ' + (notice.kind === 'error' ? 'tool-alert--error' : 'tool-alert--success')} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live={notice.kind === 'error' ? undefined : 'polite'}>
          <p>{notice.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(notice.recovery_action === 'rebind' || notice.recovery_action === 'bind_first') && (
              <button type="button" onClick={onOpen} disabled={busy || dialogOpen} className="tool-primary-action min-h-9 px-3 py-1.5 text-xs">
                {copy.workspace.pages_tool_WorkspaceSetupPage_077}</button>
            )}
            {notice.recovery_action === 'retry' && (
              <button type="button" onClick={onRefresh} disabled={busy || dialogOpen || !binding} className="tool-secondary-action min-h-9 px-3 py-1.5 text-xs">
                {copy.workspace.pages_tool_WorkspaceSetupPage_078}</button>
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
        <p className="mt-1 text-xs text-ink-muted">{copy.workspace.pages_tool_WorkspaceSetupPage_079}{operator.elite} / Lv {level}</p>
        {!owned && <p className="mt-1 text-xs font-medium text-ink-muted">{copy.workspace.pages_tool_WorkspaceSetupPage_080}</p>}
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
  return <MotionSkeleton label={copy.workspace.pages_tool_WorkspaceSetupPage_081} rows={4} />
}

function sklandPayloadFromError(caught: unknown): Partial<SklandPayload> | null {
  if (!(caught instanceof ApiError) || !caught.data || typeof caught.data !== 'object') return null
  return caught.data as Partial<SklandPayload>
}

function formatSklandImportNotice(imported: NonNullable<SklandPayload['skland_import']>, verb: string): string {
  const base = `${verb} ${imported.operator_count}${copy.workspace.pages_tool_WorkspaceSetupPage_082}${imported.nickname}`
  if (imported.inventory_synced && imported.intermediate_inventory) {
    return `${base}${copy.workspace.pages_tool_WorkspaceSetupPage_083}${formatInventoryAmount('Pure Gold', imported.intermediate_inventory['Pure Gold'])}、${formatInventoryAmount('Originium Shard', imported.intermediate_inventory['Originium Shard'])}、${formatInventoryAmount('Orirock Cube', imported.intermediate_inventory['Orirock Cube'])}${copy.workspace.pages_tool_WorkspaceSetupPage_084}`
  }
  if (imported.inventory_warning) return `${base}${copy.workspace.pages_tool_WorkspaceSetupPage_085}`
  return base
}

function formatInventoryAmount(product: IntermediateProduct, value: number | undefined): string {
  const label = product === 'Pure Gold'
    ? copy.workspace.pages_tool_WorkspaceSetupPage_086
    : product === 'Originium Shard'
      ? copy.workspace.pages_tool_WorkspaceSetupPage_087
      : copy.common.components_ConfigEditor_080
  const count = Number(value ?? 0)
  return `${label} ${Number.isFinite(count) ? count : 0}`
}

function formatSklandRefreshError(data: Partial<SklandPayload> | null, status: number): string {
  if (data?.code === 'skland_credential_invalid') {
    return data.error || copy.workspace.pages_tool_WorkspaceSetupPage_088
  }
  if (data?.code === 'skland_not_bound') {
    return data.error || copy.workspace.pages_tool_WorkspaceSetupPage_089
  }
  if (data?.code === 'skland_depot_refresh_forbidden') {
    return data.error || copy.workspace.pages_tool_WorkspaceSetupPage_090
  }
  return data?.error || `${copy.workspace.pages_tool_WorkspaceSetupPage_091}${status}${copy.workspace.pages_tool_WorkspaceSetupPage_092}`
}

function sklandCredentialInvalidLabel(reason: string | null | undefined): string {
  if (reason === 'credential_format_invalid') return copy.workspace.pages_tool_WorkspaceSetupPage_093
  if (reason === 'expired_or_revoked') return copy.workspace.pages_tool_WorkspaceSetupPage_094
  return copy.workspace.pages_tool_WorkspaceSetupPage_095
}
