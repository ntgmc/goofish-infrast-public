import { Link, useNavigate } from 'react-router'
import { ArrowRight, Check, CircleHelp, RefreshCw, Scale, Wallet } from 'lucide-react'
import BrandLogo from '../components/BrandLogo'
import ThemeSwitcher from '../components/ThemeSwitcher'
import ProductIcon from '../components/ProductIcon'
import { Tabs } from '../components/ui/tabs'
import { copy } from '../copy'
import { calculateTrainingCost } from '../lib/training-ratio'
import { useSiteFeatures } from '../lib/site-feature-context'
import { profileScopedPath } from '../lib/app-routes'
import { useToolSession } from './tool/useToolSession'
import { trainingAmount, useTrainingRatio } from './useTrainingRatio'
import { v2Path } from './v2/navigation'
import './training-ratio.css'

const text = copy.trainingRatio
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const examples = [{ rarity: 4, targetLevel: 40 }, { rarity: 5, targetLevel: 50 }, { rarity: 6, targetLevel: 1 }, { rarity: 6, targetLevel: 60 }, { rarity: 6, targetLevel: 90 }]
type Session = ReturnType<typeof useToolSession>

function ResourceStock({ inventory }: { inventory: { lmd: number; exp: number } }) {
  return <dl className="training-ratio-stock">{(['lmd', 'exp'] as const).map((resource) => <div key={resource} className={`training-ratio-stock--${resource}`}>
    <ProductIcon product={resource === 'lmd' ? 'LMD' : 'Battle Record'} size={40} />
    <dt>{text[resource]}</dt><dd>{number(inventory[resource])}</dd>
  </div>)}</dl>
}

export default function TrainingRatioPage({ session, embedded = false }: { session?: Session; embedded?: boolean } = {}) {
  return session ? <TrainingRatioContent key={`${session.user?.id}:${session.activeProfile?.id}`} session={session} embedded={embedded} /> : <StandaloneTrainingRatio />
}
function StandaloneTrainingRatio() {
  const session = useToolSession()
  return <TrainingRatioPage session={session} />
}

function TrainingRatioContent({ session, embedded }: { session: Session; embedded: boolean }) {
  const m = useTrainingRatio(session)
  const navigate = useNavigate()
  const { features } = useSiteFeatures()
  const profile = session.activeProfile
  const field = (label: string, key: 'lmd' | 'exp') => <label className={`training-ratio-field training-ratio-field--${key}`}><span><ProductIcon product={key === 'lmd' ? 'LMD' : 'Battle Record'} size={24} />{label}</span><input className="tool-field" type="number" min={0} max={1e12} step={1} value={m.draft[key]} aria-invalid={!trainingAmount(m.draft[key])} onChange={(event) => m.setDraft((draft) => ({ ...draft, [key]: event.target.value }))} /></label>
  const inventoryRatio = m.balance?.ratio === null ? m.inventory && m.inventory.lmd > 0 ? text.noExp : text.noResources
    : m.balance ? m.balance.focus === 'lmd' && number(m.balance.ratio) === '1.2' ? text.belowRange
      : m.balance.focus === 'exp' && number(m.balance.ratio) === '1.4' ? text.aboveRange : `${number(m.balance.ratio)}∶1` : ''
  const Root = embedded ? 'div' : 'main'
  return <div className={`training-ratio${embedded ? ' training-ratio--embedded' : ' training-ratio--standalone'}`}>
    {!embedded && <header className="training-ratio-header"><Link to="/tool/tools" aria-label={text.back}><BrandLogo /></Link><div><Link to="/tool/tools">{text.back}</Link><ThemeSwitcher /></div></header>}
    <Root>
      {!embedded && <h1>{text.title}</h1>}
      <p className="training-ratio-lead">{text.description}</p>
      <section className="training-ratio-reference" aria-label={text.reference}><div><span>{text.reference}</span><strong><ProductIcon product="LMD" size={40} />{text.referenceValue}<ProductIcon product="Battle Record" size={40} /></strong><span className="training-ratio-range"><Scale size={16} aria-hidden="true" />{text.referenceRange}</span></div><p>{text.referenceHint}</p></section>
      <div className="training-ratio-columns">
        <section className="training-ratio-inputs tool-panel" aria-label={text.inventory}>
          <h2><Wallet size={20} aria-hidden="true" />{text.inventory}</h2>
          <Tabs.Root value={m.source} onValueChange={(value) => m.setSource(value === 'manual' ? 'manual' : 'imported')}>
          <Tabs.List className="training-ratio-tabs" aria-label={text.sources}>
            <Tabs.Trigger value="imported"><Wallet size={16} aria-hidden="true" />{text.accountInventory}</Tabs.Trigger>
            <Tabs.Trigger value="manual">{text.manual}</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="imported" forceMount hidden={m.source !== 'imported'}>
          {session.user && session.profiles.length > 0 && <label className="training-ratio-field"><span>{text.account}</span><select className="tool-field" value={profile?.id ?? ''} onChange={(event) => navigate(embedded ? v2Path('training-ratio', event.target.value) : profileScopedPath('/tools/training-ratio', event.target.value))}><option value="" disabled>{text.account}</option>{session.profiles.filter((row) => row.status === 'active' && !row.archived_at).map((row) => <option key={row.id} value={row.id}>{row.display_name}</option>)}</select></label>}
          {m.canImport ? <div className="training-ratio-actions"><button type="button" className="tool-secondary-action training-ratio-import" disabled={m.busy} onClick={() => void m.load()}><RefreshCw size={16} aria-hidden="true" />{m.busy ? text.importing : m.data ? text.refresh : text.import}</button></div> : session.authLoading ? <p role="status">{text.accountLoading}</p> : <p>{text.loginHint} <Link className="training-ratio-link" to={embedded ? v2Path('profiles', profile?.id) : '/tool/profiles'}>{text.accountEntry}<ArrowRight size={14} /></Link></p>}
          {m.data && <><ResourceStock inventory={m.data.inventory} /><p>{text.importedAt} {new Date(m.data.importedAt).toLocaleString('zh-CN')}</p></>}
          {m.error && <p role="alert" className="training-ratio-error">{m.error}</p>}
          </Tabs.Content>
          <Tabs.Content value="manual" forceMount hidden={m.source !== 'manual'}>
            <form onSubmit={(event) => { event.preventDefault(); m.applyManual() }}>
            <p>{text.inventoryHint}</p>
            <div className="training-ratio-fields">{field(text.lmd, 'lmd')}{!m.draft.useBooks && field(text.exp, 'exp')}</div>
            <label className="training-ratio-check"><input type="checkbox" checked={m.draft.useBooks} onChange={(event) => m.setDraft((draft) => ({ ...draft, useBooks: event.target.checked }))} />{text.books}</label>
            {m.draft.useBooks && <div className="training-ratio-fields">{text.bookNames.map((label, index) => <label className="training-ratio-field" key={label}><span>{label}</span><input className="tool-field" type="number" min={0} max={1e12} step={1} value={m.draft.books[index]} aria-invalid={!trainingAmount(m.draft.books[index])} onChange={(event) => m.setDraft((draft) => ({ ...draft, books: draft.books.map((value, at) => at === index ? event.target.value : value) }))} /></label>)}</div>}
            {!m.manualValid && <p role="alert" className="training-ratio-error">{text.invalidAmount}</p>}
            <button type="submit" className="tool-primary-action" disabled={!m.manualValid}>{text.applyManual}</button>
            </form>
          {m.draftFailed && <p role="status">{text.draftFailed}</p>}
          </Tabs.Content>
          </Tabs.Root>
        </section>
        <section className="training-ratio-results tool-panel" data-focus={m.balance?.focus ?? 'empty'} aria-label={text.result} aria-live="polite">
          <h2><Scale size={20} aria-hidden="true" />{text.result}</h2>
          {m.balance && <p className="training-ratio-source">{m.source === 'manual' ? text.manualSource : text.importedSource}</p>}
          {m.balance && m.inventory ? <>
            <div className="training-ratio-verdict"><span className="training-ratio-verdict-icon" aria-hidden="true">{m.balance.focus === 'lmd' || m.balance.focus === 'exp' ? <ProductIcon product={m.balance.focus === 'lmd' ? 'LMD' : 'Battle Record'} size={44} /> : m.balance.focus === 'balanced' ? <Check size={28} /> : <Scale size={28} />}</span><div><strong>{text.focus[m.balance.focus]}</strong><p>{text.explanation[m.balance.focus]}</p></div></div>
            <ResourceStock inventory={m.inventory} />
            <h3>{text.inventoryRatio}</h3><p className="training-ratio-value">{inventoryRatio}</p>
            {m.balance.supplement > 0 && <div className="training-ratio-supplement"><h3><ProductIcon product={m.balance.focus === 'lmd' ? 'LMD' : 'Battle Record'} size={28} />{text.supplement}</h3><p>{m.balance.focus === 'lmd' ? text.supplementLmd(number(m.balance.supplement)) : text.supplementExp(number(m.balance.supplement))}</p>{m.balance.focus === 'exp' && <p>{text.bookEquivalent(number(Math.ceil(m.balance.supplement / 2000)))}</p>}<p>{text.supplementHint}</p></div>}
          </> : <p role="status">{m.source === 'manual' ? text.noManualInventory : m.busy ? text.importing : text.noInventory}</p>}
        </section>
      </div>
      <details className="training-ratio-evidence tool-panel"><summary><span><CircleHelp size={18} aria-hidden="true" />{text.evidence}</span></summary><p>{text.reason}</p><p>{text.evidenceHint}</p><div className="training-ratio-table"><table><thead><tr>{[text.target, text.lmd, text.exp, text.costRatio].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{examples.map((example, index) => { const cost = calculateTrainingCost({ ...example, currentElite: 0, currentLevel: 1, targetElite: 2 }); return <tr key={index}><th scope="row">{text.evidenceRows[index]}</th><td>{number(cost.lmd)}</td><td>{number(cost.exp)}</td><td>{number(cost.lmd / cost.exp)}∶1</td></tr> })}</tbody></table></div><p>{text.habits}</p><p>{text.scope}</p>{features.cultivation_plan && <Link className="training-ratio-link" to={v2Path('cultivation-projects', profile?.id)}>{text.projectEntry}<ArrowRight size={14} /></Link>}</details>
    </Root>
  </div>
}
