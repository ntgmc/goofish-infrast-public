import { Link } from 'react-router'
import { NextIcon as ArrowRight, HelpHintIcon as CircleHelp } from '../components/icons'
import { Tabs } from '../components/ui/tabs'
import { copy } from '../copy'
import { calculateTrainingCost } from '../lib/training-ratio'

const text = copy.trainingRatio
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const examples = [{ rarity: 4, targetLevel: 40 }, { rarity: 5, targetLevel: 50 }, { rarity: 6, targetLevel: 1 }, { rarity: 6, targetLevel: 60 }, { rarity: 6, targetLevel: 90 }]
// Standard single-module LMD costs by rank; account budgets use the actual module tables.
const moduleExamples = [
  { ...examples[0], label: text.evidenceRows[0], costs: [20000, 25000, 30000] },
  { ...examples[1], label: text.evidenceRows[1], costs: [40000, 50000, 60000] },
  { ...examples[3], label: text.evidenceRows[3], costs: [80000, 100000, 120000] },
]

export default function TrainingRatioEvidence({ accountMode, projectHref }: { accountMode: boolean; projectHref?: string }) {
  return <details className="training-ratio-evidence tool-panel">
    <summary><span><CircleHelp size={18} aria-hidden="true" />{text.evidence}</span></summary>
    <p>{accountMode ? text.accountEvidence : text.reason}</p>
    <Tabs.Root defaultValue="levels">
      <Tabs.List className="training-ratio-tabs training-ratio-evidence-tabs" aria-label={text.exampleGroups}>
        <Tabs.Trigger value="levels">{text.levelExamples}</Tabs.Trigger>
        <Tabs.Trigger value="modules">{text.moduleExamples}</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="levels">
        <p>{text.evidenceHint}</p>
        <div className="training-ratio-table"><table>
          <thead><tr>{[text.target, text.lmd, text.exp, text.costRatio].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{examples.map((example, index) => {
            const cost = calculateTrainingCost({ ...example, currentElite: 0, currentLevel: 1, targetElite: 2 })
            return <tr key={index}><th scope="row">{text.evidenceRows[index]}</th><td>{number(cost.lmd)}</td><td>{number(cost.exp)}</td><td>{number(cost.lmd / cost.exp)}∶1</td></tr>
          })}</tbody>
        </table></div>
      </Tabs.Content>
      <Tabs.Content value="modules">
        <p>{text.moduleEvidenceHint}</p>
        <div className="training-ratio-example-grid">{moduleExamples.map((example) => {
          const cost = calculateTrainingCost({ rarity: example.rarity, targetLevel: example.targetLevel, currentElite: 0, currentLevel: 1, targetElite: 2 })
          return <section className="training-ratio-example-card" key={example.rarity} aria-label={example.label}>
            <header><h3>{example.label}</h3><p>{text.exampleExp(number(cost.exp))}</p></header>
            <table>
              <thead><tr><th scope="col">{text.moduleGoal}</th><th scope="col">{text.totalLmd}</th><th scope="col">{text.shortRatio}</th></tr></thead>
              <tbody>{[0, 1, 2, 3].map((rank) => {
                const moduleLmd = example.costs.slice(0, rank).reduce((sum, value) => sum + value, 0)
                const lmd = cost.lmd + moduleLmd
                return <tr key={rank}>
                  <th scope="row"><span>{rank ? text.moduleLevels[rank - 1] : text.moduleChoices.none}</span>{rank > 0 && <small>{text.extraModuleLmd(number(moduleLmd))}</small>}</th>
                  <td>{number(lmd)}</td><td className="training-ratio-example-ratio">{number(lmd / cost.exp)}∶1</td>
                </tr>
              })}</tbody>
            </table>
          </section>
        })}</div>
        <p>{text.moduleEvidenceScope}</p>
      </Tabs.Content>
    </Tabs.Root>
    <div className="training-ratio-evidence-footer"><p>{text.habits}</p><p>{text.scope}</p>
      {projectHref && <Link className="training-ratio-link" to={projectHref}>{text.projectEntry}<ArrowRight size={14} /></Link>}
    </div>
  </details>
}
