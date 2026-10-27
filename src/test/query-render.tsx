import type { ComponentType, ReactNode } from 'react'
import { render as renderUi, renderHook as renderReactHook, type RenderOptions, type RenderHookOptions } from '@testing-library/react'
import QueryProvider from '../lib/query-provider'

export * from '@testing-library/react'

function withQueries(Wrapper?: ComponentType<{ children: ReactNode }>) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryProvider>{Wrapper ? <Wrapper>{children}</Wrapper> : children}</QueryProvider>
  }
}

export function render(ui: ReactNode, options?: RenderOptions) {
  return renderUi(ui, { ...options, wrapper: withQueries(options?.wrapper) })
}

export function renderHook<Result, Props>(callback: (props: Props) => Result, options?: RenderHookOptions<Props>) {
  return renderReactHook(callback, { ...options, wrapper: withQueries(options?.wrapper) })
}
