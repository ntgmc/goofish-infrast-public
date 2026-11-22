import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router'
import { BackIcon as ArrowLeft, NextIcon as ArrowRight, BalanceIcon } from '../../components/icons'
import { Link } from 'react-router'
import GuestAccountLink from '../../components/GuestAccountLink'
import { authPath } from '../../lib/auth-navigation'
import { copy } from '../../copy'
import { useSiteFeatures } from '../../lib/site-feature-context'
import { usePublicContent } from '../../lib/public-content-context'
import type { useOptimizeWorkflow } from '../tool/optimize/useOptimizeWorkflow'
import { isFreePreviewProfile, isSchedulableProfile } from '../tool/tool-utils'
import type { OptimizationTaskCenterController } from '../tool/optimize/useOptimizationTaskCenter'
import type { AuthSuccessResponse } from '../../lib/types'
import type { V2Session } from './OptionsDrawer'
import { sectionLabels, V2_GUEST_SECTIONS, v2Path, v2SectionAvailable, v2SectionPauseNotice, type V2Section } from './navigation'
import { V2SectionLoading } from './V2LoadingScreen'
import FirstScheduleGuide from './FirstScheduleGuide'
import ProfileUpgrade, { ProfileUpgradeEntry } from './ProfileUpgrade'

const Profiles = lazy(() => import('./pages/Accounts'))
const AddAccount = lazy(() => import('./pages/AddAccount'))
const Settings = lazy(() => import('./pages/Settings'))
const Announcements = lazy(() => import('./pages/Announcements'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Balance = lazy(() => import('./pages/Billing').then((module) => ({ default: module.Balance })))
const Commercial = lazy(() => import('./pages/Billing').then((module) => ({ default: module.Commercial })))
const Tools = lazy(() => import('./pages/Tools'))
const ManualTool = lazy(() => import('./pages/Tools').then((module) => ({ default: module.ManualTool })))
const ScheduleComparison = lazy(() => import('./pages/ScheduleComparison'))
const BuildingRatings = lazy(() => import('./pages/BuildingRatings'))
const Cultivation = lazy(() => import('./pages/Cultivation'))
const ThanksRecruitment = lazy(() => import('../ThanksRecruitmentPage'))
const CultivationProjects = lazy(() => import('./pages/CultivationProjects'))
const TrainingRatio = lazy(() => import('../TrainingRatioPage'))
const MaterialDemand = lazy(() => import('./pages/MaterialDemand'))
const Depot = lazy(() => import('./pages/Depot'))
const Skland = lazy(() => import('./pages/Skland'))
const Plans = lazy(() => import('./pages/History'))
const Generation = lazy(() => import('./pages/Generation'))
const Lab = lazy(() => import('./pages/Comparison'))
const PublicInfo = lazy(() => import('./pages/Documents'))
const Updates = lazy(() => import('./pages/Releases'))
const Pricing = lazy(() => import('./pages/Pricing'))
const Purchase = lazy(() => import('./pages/Purchase'))
const Status = lazy(() => import('./pages/ServiceStatus'))
const SiteBenchmark = lazy(() => import('./pages/SiteBenchmark'))
const AppearanceSettings = lazy(() => import('./AppearanceSettings'))

export type V2Workflow = ReturnType<typeof useOptimizeWorkflow> & {
  optimizationTasks?: OptimizationTaskCenterController
}
const descriptions: Partial<Record<V2Section, string>> = {
  generation: copy.v2.generationDescription, plans: copy.v2.plansDescription, benchmarks: copy.siteBenchmark.introduction,
  tools: copy.v2.toolsDescription,
  'add-account': copy.v2.addAccountDescription,
}
const workflowSections: V2Section[] = ['generation', 'plans', 'lab']

export default function WorkspaceSections({ section, session, workflow, generationProgress, onAccountAdded, onToolDirtyChange, onOpenProfile, onUpgradeProfile, onNavigate, onConfig, onOperators, generationDisabledReason, firstSchedule = false, configConfirmed = false }: {
  section: V2Section
  session: V2Session
  workflow?: V2Workflow
  generationProgress?: ReactNode
  onAccountAdded: (payload: AuthSuccessResponse) => Promise<void>
  onToolDirtyChange: (dirty: boolean) => void
  onOpenProfile: (profile: V2Session['profiles'][number]) => Promise<void>
  onUpgradeProfile: (profile: V2Session['profiles'][number]) => Promise<void>
  onNavigate: (section: V2Section) => void
  onConfig: () => void
  onOperators: () => void
  generationDisabledReason?: string | null
  firstSchedule?: boolean
  configConfirmed?: boolean
}) {
  const { features, pauseNotices } = useSiteFeatures()
  const { content } = usePublicContent()
  const [params] = useSearchParams()
  const location = useLocation()
  const upgrading = section === 'add-account' && params.get('mode') === 'upgrade' && Boolean(session.activeProfile && isFreePreviewProfile(session.activeProfile)) && features.cdk_redemption
  const title = upgrading ? copy.v2.profileUpgrade.title : section === 'help' ? content.faq.title : section === 'pricing' ? content.pricing.title : sectionLabels[section]
  const available = v2SectionAvailable(section, features)
  const pause = v2SectionPauseNotice(section, pauseNotices)
  const [openedTools, setOpenedTools] = useState<V2Section[]>([])
  useEffect(() => {
    if (available && ['manual-tool', 'schedule-comparison', 'cultivation', 'thanks-recruitment', 'cultivation-projects', 'training-ratio', 'material-demand', 'depot'].includes(section)) setOpenedTools((current) => current.includes(section) ? current : [...current, section])
  }, [section, available])
  const signedIn = Boolean(session.user)
  const needsLogin = !signedIn && !V2_GUEST_SECTIONS.includes(section)
  const needsWorkspace = workflowSections.includes(section) && !workflow
  const guided = firstSchedule && section === 'generation' && available
  const operatorsReady = Boolean(session.license?.operators.some((operator) => operator.own))
  const step = !signedIn ? 0 : !workflow || !operatorsReady ? 1 : !configConfirmed ? 2 : 3
  return <section hidden={section === 'overview'} className={`v2-feature-content v2-page-section${guided ? ' v2-first-schedule-layout' : ''}`} data-v2-section={section} aria-label={guided ? copy.v2.firstSchedule.title : title}>
    <div className="v2-section-heading"><div><h1>{guided ? copy.v2.firstSchedule.title : title}</h1>{guided ? <p>{copy.v2.firstSchedule.description}</p> : !upgrading && descriptions[section] && <p>{descriptions[section]}</p>}</div>
      {['manual-tool', 'schedule-comparison', 'building-ratings', 'cultivation', 'thanks-recruitment', 'cultivation-projects', 'training-ratio', 'material-demand', 'depot'].includes(section) && <Link className="v2-button v2-button-secondary" to={v2Path('tools', session.activeProfile?.id)}><ArrowLeft size={16} />{copy.v2.backToTools}</Link>}
      {guided && <Link className="v2-button v2-button-secondary" to={v2Path('overview', session.activeProfile?.id)}><ArrowLeft size={16} />{copy.v2.firstSchedule.backToExample}</Link>}
      {section === 'profiles' && <div className="v2-actions">
        {signedIn && <Link className="v2-button v2-button-secondary" to={v2Path('balance', session.activeProfile?.id)}><BalanceIcon size={18} aria-hidden="true" />{copy.balance.nav}<ArrowRight size={16} aria-hidden="true" /></Link>}
        {v2SectionAvailable('add-account', features) && <button type="button" className="v2-button v2-button-primary" onClick={() => onNavigate('add-account')}>{copy.v2.addAccount}<ArrowRight size={16} /></button>}
      </div>}
    </div>
    {guided && <FirstScheduleGuide step={step} />}
    <div className="v2-section-body">
      <Suspense fallback={<V2SectionLoading label={section === 'inventory' ? copy.inventory.loading : undefined} />}>
        {section === 'overview' ? null : pause ? <div className="v2-panel v2-section-loading v2-feature-pause-notice" role="status"><h2>{copy.features.paused_title}</h2><p>{pause}</p></div>
          : !available ? <p className="v2-panel v2-section-loading" role="status">{section === 'balance' ? copy.balance.unavailable : copy.v2.featureUnavailable}</p>
          : section === 'generation' && !signedIn ? <div className="v2-first-schedule-task">
            <GuestAccountLink label={features.registration ? copy.v2.guestAccount.firstSchedule : copy.auth.components_AuthForm_008} description={copy.v2.guestAccount.firstScheduleHelp} />
          </div>
          : needsLogin ? <Navigate to={authPath('login', `${location.pathname}${location.search}${location.hash}`, undefined, location.state?.authBackTo)} replace />
            : needsWorkspace ? section === 'generation' && session.activeProfile && isSchedulableProfile(session.activeProfile)
              ? <div className="v2-panel v2-section-loading"><p>{copy.v2.generationImport}</p><button className="v2-button v2-button-primary" type="button" onClick={onOperators}>{copy.public.pages_LandingPage_001}</button></div>
              : section === 'generation' && session.cdkProfiles.length === 0 && v2SectionAvailable('add-account', features)
                ? <>{!guided && <p className="v2-lead">{copy.v2.profileRequired}</p>}<AddAccount userId={session.user!.id} guided={guided} onAdded={onAccountAdded} onInventory={() => onNavigate('inventory')} /></>
                : <div className="v2-panel v2-section-loading"><p>{copy.v2.profileRequired}</p><button className="v2-button v2-button-primary" type="button" onClick={() => onNavigate('profiles')}>{copy.v2.account}</button></div>
              : <>
                {section === 'profiles' && <Profiles session={session} onOpen={onOpenProfile} onUpgrade={onUpgradeProfile} />}
                {section === 'add-account' && (upgrading ? <ProfileUpgrade key={session.activeProfile!.id} session={session} onUpgraded={onAccountAdded} /> : <>
                  {session.activeProfile && <ProfileUpgradeEntry profile={session.activeProfile} />}
                  <AddAccount userId={session.user!.id} onAdded={onAccountAdded} onInventory={() => onNavigate('inventory')} />
                </>)}
                {section === 'settings' && (signedIn ? <Settings session={session} /> : <div className="v2-guest-settings"><AppearanceSettings /></div>)}
                {section === 'announcements' && <Announcements session={session} />}
                {section === 'skland' && <Skland key={session.activeProfile?.id} session={session} onOpenProfile={onOpenProfile} onProfiles={() => onNavigate('profiles')} onConfig={onConfig} />}
                {section === 'inventory' && <Inventory session={session} onProfiles={() => onNavigate('profiles')} />}
                {section === 'balance' && <Balance userId={session.user!.id} activeProfileId={session.activeProfile?.id ?? null} redemptionEnabled={features.cdk_redemption} />}
                {section === 'commercial' && <Commercial userId={session.user!.id} activeProfileId={session.activeProfile?.id ?? null} onOpen={onOpenProfile} />}
                {section === 'tools' && <Tools profileId={session.activeProfile?.id} />}
                {section === 'building-ratings' && <BuildingRatings session={session} />}
                {(['help', 'terms', 'privacy', 'disclaimer', 'support'] as V2Section[]).includes(section) && <PublicInfo page={section === 'help' ? 'faq' : section as 'terms' | 'privacy' | 'disclaimer' | 'support'} />}
                {section === 'pricing' && <Pricing session={session} />}
                {section === 'purchase' && <Purchase profile={session.authStatus === 'authenticated' ? session.activeProfile : null} />}
                {section === 'status' && <Status />}
                {section === 'benchmarks' && <SiteBenchmark />}
                {section === 'updates' && <Updates />}
                {section === 'plans' && workflow && <Plans workflow={workflow} />}
                {section === 'generation' && workflow && <Generation workflow={workflow} progress={generationProgress} disabledReason={generationDisabledReason}
                  preparationStep={guided ? step : undefined} onOperators={onOperators} onNavigate={onNavigate} onConfig={onConfig} />}
                {section === 'lab' && workflow && <Lab workflow={workflow} onConfig={onConfig} />}
              </>}
      </Suspense>
    </div>
    {openedTools.map((tool) => <div key={tool} className="v2-section-body" hidden={section !== tool} inert={section !== tool}>
      <Suspense fallback={<V2SectionLoading />}>
        {tool === 'manual-tool' && v2SectionAvailable(tool, features) && <ManualTool session={session} workflow={workflow} onDirtyChange={onToolDirtyChange} onOpenProfile={onOpenProfile} onNavigate={onNavigate} />}
        {tool === 'schedule-comparison' && v2SectionAvailable(tool, features) && <ScheduleComparison session={session} onOpenProfile={onOpenProfile} />}
        {tool === 'cultivation' && v2SectionAvailable(tool, features) && <Cultivation session={session} upgradeSuggestions={workflow?.suggestions} />}
        {tool === 'thanks-recruitment' && v2SectionAvailable(tool, features) && <ThanksRecruitment session={session} />}
        {tool === 'cultivation-projects' && v2SectionAvailable(tool, features) && <CultivationProjects session={session} onConfig={onConfig} />}
        {tool === 'training-ratio' && v2SectionAvailable(tool, features) && <TrainingRatio session={session} />}
        {tool === 'material-demand' && v2SectionAvailable(tool, features) && <MaterialDemand />}
        {tool === 'depot' && v2SectionAvailable(tool, features) && <Depot session={session} />}
      </Suspense>
    </div>)}
  </section>
}
