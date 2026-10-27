import { copy } from '../copy'
import ProductIcon from '../components/ProductIcon'
import { BalancedResourcesIcon as Check } from '../components/icons'
import type { useTrainingRatio } from './useTrainingRatio'

const text = copy.trainingRatio
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
export default function TrainingRatioAccount({ model: m, accountName }: { model: ReturnType<typeof useTrainingRatio>; accountName: string }) {
  const required = m.requirements
  const balance = m.accountBalance
  if (!m.data) return <p role="status">{m.busy ? text.importing : text.noInventory}</p>
  if (m.account.isPending) return <p role="status">{text.targetsLoading}</p>
  if (m.account.isError) return <div role="alert"><p>{m.account.error.message}</p><button className="tool-secondary-action" type="button" onClick={() => void m.account.refetch()}>{text.retryTargets}</button></div>
  if (!required || !m.accountData) return null
  return <>
    <p className="training-ratio-source">{text.importedSource}</p>
    {balance ? <div className="training-ratio-verdict"><span className="training-ratio-verdict-icon" aria-hidden="true">{balance.focus === 'lmd' || balance.focus === 'exp' ? <ProductIcon product={balance.focus === 'lmd' ? 'LMD' : 'Battle Record'} size={44} /> : <Check size={28} />}</span><div><strong>{text.accountFocus[balance.focus]}</strong><p>{text.accountExplanation[balance.focus]}</p></div></div>
      : <p role="status">{text.incomplete}</p>}
    {balance && <p className="training-ratio-target-count">{text.targetCount(required.operators)}</p>}
    <div className="training-ratio-demand">{(['lmd', 'exp'] as const).map((key) => {
      const stock = m.accountData!.inventory[key]
      const coverage = required[key] ? Math.min(100, stock / required[key] * 100) : 100
      return <div key={key} className={`training-ratio-demand-card training-ratio-stock--${key}`}>
        <div className="training-ratio-demand-heading"><ProductIcon product={key === 'lmd' ? 'LMD' : 'Battle Record'} size={32} /><strong>{text[key]}</strong></div>
        <dl><div><dt>{text.required}</dt><dd>{balance ? number(required[key]) : '—'}</dd></div><div><dt>{text.available}</dt><dd>{number(stock)}</dd></div><div className="training-ratio-missing"><dt>{text.missing}</dt><dd>{balance ? number(balance.missing[key]) : '—'}</dd></div></dl>
        {balance && <><div className="training-ratio-coverage" role="meter" aria-label={text[key]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage}><span style={{ width: `${coverage}%` }} /></div><small>{text.coverage(number(coverage))}</small></>}
      </div>
    })}</div>
    {balance && required.moduleLmd > 0 && <p className="training-ratio-module-total">{text.moduleCost}<strong>{number(required.moduleLmd)}</strong></p>}
    {required.issues.length > 0 && <div className="training-ratio-issues" role="alert">{(['levels', 'modules', 'costs', 'common'] as const).map((reason) => {
      const names = [...new Set(required.issues.filter((issue) => issue.reason === reason).map((issue) => issue.name))]
      return names.length > 0 && <details key={reason}><summary>{text.issueReasons[reason]}</summary><p>{names.join('、')}</p></details>
    })}</div>}
    {balance && balance.focus !== 'ready' && <div className="training-ratio-supplement"><h3>{text.supplement}</h3>
      {m.incomeLoading ? <p role="status">{text.recoveryLoading}</p> : <>
        {m.accountDays !== null && <><p className="training-ratio-value">{text.recoveryDays(number(m.accountDays))}</p><p>{text.accountRecoveryPlan}</p></>}
        {m.income ? <><p>{text.baseIncome(number(m.income.lmd), number(m.income.exp))}</p><p>{text.baseSource(accountName, m.incomeName ?? '')}</p></> : <p>{m.incomeFailed ? text.baseIncomeFailed : text.noBaseIncome}</p>}
        <p>{text.farmingBudget} {text.ceCalendar}</p><p>{text.accountScope}</p>
      </>}
    </div>}
    {required.modules.length > 0 && <details className="training-ratio-module-list"><summary>{text.selectedModules(required.modules.length)}</summary><ul>{required.modules.map((module, index) => <li key={index}><div><strong>{module.operator} · {module.name}</strong><span>{text.moduleUpgrade(module.from, module.to)}</span></div><span>{number(module.lmd)}</span></li>)}</ul></details>}
    {m.accountData.warnings.map((warning) => <p role="status" key={warning}>{warning}</p>)}
  </>
}
