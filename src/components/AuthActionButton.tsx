import type { ComponentProps } from 'react'
import { copy } from '../copy'
import './AuthActionButton.css'

type Props = ComponentProps<'button'> & {
  phase: 'idle' | 'loading' | 'success' | 'error'
  children: string
}

export default function AuthActionButton({ phase, children, className = '', ...props }: Props) {
  const status = phase === 'loading' ? copy.auth.components_AuthForm_019 : phase === 'success' ? copy.auth.actionCompleted : phase === 'error' ? copy.auth.actionFailed : ''
  return <div className="auth-action">
    <button {...props} className={`${className} auth-action-button`} data-phase={phase} aria-label={status || children} aria-busy={phase === 'loading'}>
      <span className="auth-action-label" aria-hidden="true">{children}</span>
      <svg className="auth-action-spinner" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /></svg>
      <svg className="auth-action-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-8" pathLength="1" /></svg>
      <svg className="auth-action-cross" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12" pathLength="1" /><path d="m18 6-12 12" pathLength="1" /></svg>
    </button>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{status}</span>
  </div>
}
