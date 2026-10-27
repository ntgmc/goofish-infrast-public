import type { ComponentType, ReactNode } from 'react'
import { render as renderQuery, renderHook as renderQueryHook, type RenderOptions, type RenderHookOptions } from './query-render'
import { AdminQueryScope, UserQueryScope } from '../lib/private-query-scope'
import type { AdminCapability } from '../pages/admin/contracts'
const capabilities: AdminCapability[] = ['usage_view', 'user_view', 'user_manage', 'admin_manage', 'optimization_view', 'optimization_manage', 'risk_view', 'risk_review', 'risk_config', 'sensitive_data_view', 'user_delete']

export * from './query-render'

function scopes(Wrapper?: ComponentType<{ children: ReactNode }>) {
  return function PrivateScopes({ children }: { children: ReactNode }) {
    return <UserQueryScope.Provider value="test-user"><AdminQueryScope.Provider value={{ username: 'test-admin', capabilities, active: true }}>
      {Wrapper ? <Wrapper>{children}</Wrapper> : children}
    </AdminQueryScope.Provider></UserQueryScope.Provider>
  }
}

export function render(ui: ReactNode, options?: RenderOptions) {
  return renderQuery(ui, { ...options, wrapper: scopes(options?.wrapper) })
}
export function renderHook<Result, Props>(callback: (props: Props) => Result, options?: RenderHookOptions<Props>) {
  return renderQueryHook(callback, { ...options, wrapper: scopes(options?.wrapper) })
}
