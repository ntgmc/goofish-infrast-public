import { Children, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { EmptyIcon, ErrorIcon, InfoIcon, LoadingIcon } from '../../../components/icons'
import { copy } from '../../../copy'

export function Notice({ children, error = false }: { children?: ReactNode; error?: boolean }) {
  const Icon = error ? ErrorIcon : InfoIcon
  return Children.toArray(children).length > 0 ? <div className={`v2-notice ${error ? 'v2-notice-error' : ''}`} role={error ? 'alert' : 'status'}><Icon size={18} aria-hidden="true" /><div>{children}</div></div> : null
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="v2-empty"><EmptyIcon size={24} aria-hidden="true" /><h2>{title}</h2>{children && <p>{children}</p>}{action}</div>
}

export function Loading({ label = copy.v2.loading }: { label?: string }) {
  return <div className="v2-loading" role="status"><LoadingIcon size={20} aria-hidden="true" className="v2-spin" />{label}</div>
}

export function SectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="v2-block-title"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>
}

export function Field({ label, help, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string }) {
  const helpId = useId()
  return <label className="v2-field"><span>{label}</span><input {...props} aria-label={props['aria-label'] ?? label} aria-describedby={props['aria-describedby'] ?? (help ? helpId : undefined)} className={`v2-input ${props.className ?? ''}`} />{help && <small id={helpId}>{help}</small>}</label>
}

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return <dl className="v2-facts">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
