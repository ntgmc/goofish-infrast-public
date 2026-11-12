import { useId } from 'react'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import { copy } from '../../copy'
import { useMotionPreference } from '../../lib/motion-preference'
import GenerationProgressDemo from './GenerationProgressDemo'

export default function AppearanceSettings() {
  const preference = useMotionPreference()
  const id = useId()
  const text = copy.v2.appearance
  return <div className="v2-appearance-settings">
    <section className="v2-appearance-theme">
      <h3>{copy.v2.appearance.theme}</h3>
      <ThemeSwitcher />
    </section>
    {preference && <section>
      <div className="v2-appearance-theme">
        <h3 id={`${id}-title`}>{copy.dashboard.animation.title}</h3>
        <div className="v2-motion-options" role="radiogroup" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}>
          {(['full', 'reduced', 'off'] as const).map((mode) => <label key={mode}>
            <input className="sr-only" type="radio" name={id} value={mode} checked={preference.motionMode === mode}
              disabled={preference.systemReducedMotion && mode !== 'off'}
              onChange={() => preference.setMotionMode(mode)} />
            <span><span aria-hidden="true" className="v2-motion-check">✓</span>{text.motionModes[mode]}</span>
          </label>)}
        </div>
      </div>
      <p id={`${id}-help`} className="mt-2 text-sm leading-6 text-ink-secondary">{preference.systemReducedMotion ? copy.dashboard.animation.system : text.motionHelp}</p>
      {preference.storageError && <p className="mt-2 text-sm text-error" role="status">{copy.dashboard.animation.storageError}</p>}
    </section>}
    <GenerationProgressDemo />
  </div>
}
