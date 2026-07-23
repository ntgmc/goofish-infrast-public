// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import RouteMetadata from './RouteMetadata'

afterEach(() => {
  cleanup()
  document.head.innerHTML = ''
})

describe('RouteMetadata', () => {
  it('updates public route metadata without leaving duplicate tags behind', async () => {
    const router = createRouter('/')
    render(<RouterProvider router={router} />)

    await waitFor(() => expect(document.title).toBe('MAA 基建排班优化器 | MaaTool'))
    expect(metaByName('description')).toBe('基于森空岛或 MAA 数据，为明日方舟生成适配当前干员的基建排班，查看日产出、等效理智、练度建议与仓库估值。')
    expect(document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe(currentUrl('/'))

    await act(async () => router.navigate('/tools/depot-value?source=homepage'))

    expect(document.title).toBe('仓库价值分析器 | MaaTool')
    expect(metaByName('description')).toBe('上传 MAA 仓库 JSON，按等效理智估算明日方舟仓库资产并生成分享图。')
    expect(metaByProperty('og:url')).toBe(currentUrl('/tools/depot-value'))
    expect(metaByName('twitter:title')).toBe('仓库价值分析器 | MaaTool')
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(document.head.querySelectorAll('meta[property="og:url"]')).toHaveLength(1)
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
  })

  it('keeps public information pages indexable and excludes private routes', async () => {
    const router = createRouter('/terms')
    render(<RouterProvider router={router} />)

    await waitFor(() => expect(document.title).toBe('用户服务协议 | MaaTool'))
    expect(metaByName('robots')).toBe('index, follow')

    await act(async () => router.navigate('/thanks'))
    expect(document.title).toBe('致谢 | MaaTool')
    expect(metaByName('robots')).toBe('index, follow')

    await act(async () => router.navigate('/changelog'))
    expect(document.title).toBe('更新日志 | MaaTool')
    expect(metaByName('description')).toBe('查看 MaaTool 各版本的功能更新、体验优化与问题修复。')
    expect(metaByName('robots')).toBe('index, follow')
    expect(metaByProperty('og:url')).toBe(currentUrl('/changelog'))

    await act(async () => router.navigate('/tool/profiles'))

    expect(document.title).toBe('MaaTool 工作台')
    expect(metaByName('robots')).toBe('noindex, nofollow')
    expect(metaByProperty('og:url')).toBe(currentUrl('/tool/profiles'))
  })
})

function createRouter(initialEntry: string) {
  return createMemoryRouter([
    { path: '*', element: <RouteMetadata /> },
  ], { initialEntries: [initialEntry] })
}

function currentUrl(pathname: string): string {
  return new URL(pathname, window.location.origin).href
}

function metaByName(name: string): string | null {
  return document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null
}

function metaByProperty(property: string): string | null {
  return document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.content ?? null
}
