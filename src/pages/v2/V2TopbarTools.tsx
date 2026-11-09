import { useEffect, useState, type ReactNode } from 'react'
import { MoreIcon } from '../../components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { copy } from '../../copy'

export default function V2TopbarTools({ children }: { children: ReactNode }) {
  const [mobile, setMobile] = useState(() => Boolean(window.matchMedia?.('(max-width: 40rem)').matches))
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 40rem)')
    if (!query) return
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  if (!mobile) return <div className="v2-topbar-tools">{children}</div>
  return <Popover>
    <PopoverTrigger asChild><button type="button" className="v2-icon-button" aria-label={copy.v2.topbar.more}><MoreIcon size={20} aria-hidden="true" /></button></PopoverTrigger>
    <PopoverContent align="end" className="v2-dialog v2-mobile-tools" aria-label={copy.v2.topbar.actions}
      onInteractOutside={(event) => {
        // Keep the opener mounted while its dialog owns focus.
        if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"]')) event.preventDefault()
      }}>{children}</PopoverContent>
  </Popover>
}
