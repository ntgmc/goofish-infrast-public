import { Check } from 'lucide-react'
import { copy } from '../../copy'

const text = copy.v2.firstSchedule

export default function FirstScheduleGuide({ step }: { step: number }) {
  const steps = [text.login, text.import, text.config, text.generate]
  return <aside className="v2-first-schedule-guide" aria-label={text.title}>
    <h2>{text.checklist}</h2>
    <p className="v2-first-schedule-progress" role="status">{text.progress(step + 1)}</p>
    <ol>{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} data-complete={index < step}>
      <span className="v2-first-schedule-node" aria-hidden="true">{index < step ? <Check size={16} /> : index + 1}</span>
      <div><strong>{label}</strong>{step === index && <p>{[text.loginHelp, text.importHelp, text.configHelp, text.generateHelp][index]}</p>}</div>
    </li>)}</ol>
  </aside>
}
