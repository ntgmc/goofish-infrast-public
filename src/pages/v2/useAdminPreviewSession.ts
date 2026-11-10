import { useEffect, useState } from 'react'
import { adminApiJson, ADMIN_SESSION_EXPIRED_EVENT } from '../../lib/admin-api-client'

export function useAdminPreviewSession() {
  const [authorized, setAuthorized] = useState(false)
  useEffect(() => {
    let active = true, revision = 0
    const hide = () => { revision++; if (active) setAuthorized(false) }
    const check = () => {
      const current = ++revision
      void adminApiJson<{ user?: { username?: unknown } }>('/api/admin/session')
        .then(({ user }) => {
          if (active && revision === current) setAuthorized(typeof user?.username === 'string' && Boolean(user.username))
        }).catch(() => { if (revision === current) hide() })
    }
    check()
    window.addEventListener('focus', check)
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, hide)
    return () => {
      active = false
      window.removeEventListener('focus', check)
      window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, hide)
    }
  }, [])
  return authorized
}
