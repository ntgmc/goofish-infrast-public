import type { ComponentProps } from 'react'

export function Switch({ className = '', ...props }: Omit<ComponentProps<'input'>, 'type' | 'role'>) {
  return <input {...props} type="checkbox" role="switch" className={`tool-switch ${className}`} />
}
