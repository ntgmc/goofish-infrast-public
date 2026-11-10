import AnimationSettings from '../../components/AnimationSettings'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import { copy } from '../../copy'
import GenerationProgressDemo from './GenerationProgressDemo'

export default function AppearanceSettings() {
  return <div className="v2-appearance-settings">
    <section className="v2-appearance-theme">
      <h3>{copy.v2.appearance.theme}</h3>
      <ThemeSwitcher />
    </section>
    <AnimationSettings />
    <GenerationProgressDemo />
  </div>
}
