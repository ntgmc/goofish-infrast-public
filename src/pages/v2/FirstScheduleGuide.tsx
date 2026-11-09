import { SuccessIcon as Check, ExpandIcon } from '../../components/icons'
import { copy } from '../../copy'

const text = copy.v2.firstSchedule

export default function FirstScheduleGuide({ step }: { step: number }) {
  const steps = [text.login, text.import, text.config, text.generate]
  return <aside className="v2-first-schedule-guide" aria-label={text.title}>
    <details open={!window.matchMedia?.('(max-width: 40rem)').matches}>
    <summary><span className="v2-first-schedule-progress" role="status">{text.progress(step + 1)}</span><strong>{steps[step]}</strong><ExpandIcon size={16} aria-hidden="true" /></summary>
    <ol>{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} data-complete={index < step}>
      <span className="v2-first-schedule-node" aria-hidden="true">{index < step ? <Check size={16} /> : index + 1}</span>
      <div><strong>{label}</strong>{step === index && <p>{[text.loginHelp, text.importHelp, text.configHelp, text.generateHelp][index]}</p>}</div>
    </li>)}</ol>
    </details>
  </aside>
}
