import { copy } from '../copy'
import type { useTrainingRatio } from './useTrainingRatio'

const text = copy.trainingRatio
export default function TrainingRatioGoals({ model: m }: { model: ReturnType<typeof useTrainingRatio> }) {
  return <div className="training-ratio-goals">
    <h3>{text.goals}</h3><p>{text.goalsHint}</p>
    {(['low', 'four', 'five', 'six'] as const).map((key) => {
      const count = m.accountData?.operators.filter((operator) => key === 'low' ? operator.rarity <= 3 : operator.rarity === ({ four: 4, five: 5, six: 6 }[key])).length
      return <fieldset className="training-ratio-goal-row" key={key}>
        <legend><strong>{text.rarities[key]}</strong>{count !== undefined && <span>{text.owned(count)}</span>}</legend>
        <div className="training-ratio-options">{(key === 'low' ? ['none', 'max'] as const : ['none', 'practical', 'max'] as const).map((value) => <label key={value}>
          <input type="radio" name={`training-goal-${key}`} value={value} checked={m.settings[key] === value} onChange={() => m.setSettings((settings) => ({ ...settings, [key]: value }))} />
          <span>{value === 'practical' && key !== 'low' ? text.practicalLevels[key] : value === 'max' && key === 'low' ? text.goalChoices.lowMax : text.goalChoices[value]}</span>
        </label>)}</div>
      </fieldset>
    })}
    <fieldset className="training-ratio-goal-row training-ratio-module-options"><legend><strong>{text.modules}</strong></legend>
      <div className="training-ratio-options">{(['none', 'common', 'all'] as const).map((value) => <label key={value}>
        <input type="radio" name="training-modules" value={value} checked={m.settings.modules === value} onChange={() => m.setSettings((settings) => ({ ...settings, modules: value }))} />
        <span>{text.moduleChoices[value]}</span>
      </label>)}</div>
      <p>{text.moduleHint}{m.settings.modules === 'common' && ` ${text.commonHint}`}</p>
    </fieldset>
    {m.settings.modules !== 'none' && <fieldset className="training-ratio-goal-row"><legend><strong>{text.moduleLevel}</strong></legend>
      <div className="training-ratio-options">{text.moduleLevels.map((label, index) => <label key={label}>
        <input type="radio" name="training-module-level" value={index + 1} checked={m.settings.moduleLevel === index + 1} onChange={() => m.setSettings((settings) => ({ ...settings, moduleLevel: index + 1 }))} /><span>{label}</span>
      </label>)}</div>
    </fieldset>}
  </div>
}
