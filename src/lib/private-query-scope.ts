import { createContext, useContext } from 'react'
import type { AdminCapability } from '../pages/admin/contracts'

export const UserQueryScope = createContext<string | null>(null)
export const AdminQueryScope = createContext<{ username: string | null; capabilities: AdminCapability[]; active: boolean }>({ username: null, capabilities: [], active: false })

export function usePrivateQueryScope(scope: 'user' | 'admin', active = true) {
  const userId = useContext(UserQueryScope)
  const admin = useContext(AdminQueryScope)
  const identity = scope === 'admin' ? admin.username : userId
  const enabled = active && Boolean(identity) && (scope === 'user' || admin.active)
  return { identity, enabled, key: scope === 'admin'
    ? ['admin', enabled ? identity : null, 'panels', admin.capabilities]
    : ['user', enabled ? identity : null, null] }
}
