import { createContext, useContext, type ComponentProps } from 'react'
import { Link } from 'react-router'

const InternalHrefContext = createContext<(href: string) => string>((href) => href)
export const InternalLinkProvider = InternalHrefContext.Provider
export function useInternalHref() { return useContext(InternalHrefContext) }

export default function InternalLink({ to, ...props }: ComponentProps<typeof Link>) {
  const resolve = useContext(InternalHrefContext)
  return <Link {...props} to={typeof to === 'string' ? resolve(to) : to} />
}
