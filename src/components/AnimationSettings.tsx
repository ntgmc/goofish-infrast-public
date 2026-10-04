import { useId } from 'react'
import { copy } from '../copy'
import { useMotionPreference } from '../lib/motion-preference'
import { Switch } from './ui/switch'

export default function AnimationSettings({ className }: { className?: string }) {
  const preference = useMotionPreference()
  const id = useId()
  if (!preference) return null
  const text = copy.dashboard.animation
  return <section className={className}>
    <h3 className="text-base font-semibold text-ink-primary">{text.title}</h3>
    <label htmlFor={id} className="mt-4 flex min-h-11 items-center justify-between gap-4 text-sm font-medium">
      <span>{text.reduce}</span>
      <Switch id={id} checked={preference.reducedMotion} disabled={preference.systemReducedMotion}
        aria-describedby={`${id}-help`} onChange={(event) => preference.setReduceAnimations(event.currentTarget.checked)} />
    </label>
    <p id={`${id}-help`} className="mt-2 text-sm leading-6 text-ink-secondary">{preference.systemReducedMotion ? text.system : text.help}</p>
    {preference.storageError && <p className="mt-2 text-sm text-error" role="status">{text.storageError}</p>}
  </section>
}
