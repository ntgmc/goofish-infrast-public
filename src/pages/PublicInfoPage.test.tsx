// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import App from '../App'
import LandingPage from './LandingPage'
import { type PublicInfoPageKind } from './PublicInfoPage'
import { GITHUB_REPOSITORY_URL, SUPPORT_QQ_GROUP_URL } from '../components/PublicFooter'
import { ThemeProvider } from '../lib/theme'
import { DEFAULT_SITE_FEATURES } from '../lib/site-features'
import * as siteFeatureContext from '../lib/site-feature-context'
import { cloneDefaultPublicContentSettings } from '../lib/public-content'
import * as publicContentContext from '../lib/public-content-context'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const pages: Array<[PublicInfoPageKind, string]> = [
  ['faq', '常见问题'],
  ['support', '联系客服'],
  ['privacy', '隐私政策'],
  ['terms', '用户服务协议'],
  ['disclaimer', '免责声明'],
]

describe('public information pages', () => {
  it.each(pages)('renders the %s route with homepage and support navigation', async (page, heading) => {
    render(<MemoryRouter initialEntries={[`/${page}`]}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
    const supportLinks = screen.getAllByRole('link', { name: /加入 MaaTool 交流群|加入 QQ 群/ })
    expect(supportLinks[0]).toHaveAttribute('href', SUPPORT_QQ_GROUP_URL)
  })

  it('exposes all public information links from the landing page footer', () => {
    render(<ThemeProvider><MemoryRouter><LandingPage onStart={() => undefined} /></MemoryRouter></ThemeProvider>)

    expect(screen.getByRole('link', { name: '常见问题' })).toHaveAttribute('href', '/faq')
    expect(screen.getByRole('link', { name: '用户服务协议' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: '隐私政策' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: '免责声明' })).toHaveAttribute('href', '/disclaimer')
    expect(screen.getByRole('link', { name: '致谢' })).toHaveAttribute('href', '/thanks')
    expect(screen.getByRole('link', { name: '更新日志' })).toHaveAttribute('href', '/changelog')

    const supportLink = screen.getByRole('link', { name: /加入 QQ 群.*891655477/ })
    expect(supportLink).toHaveAttribute('href', SUPPORT_QQ_GROUP_URL)
    expect(supportLink).toHaveAttribute('target', '_blank')
    expect(supportLink).toHaveAttribute('rel', 'noopener noreferrer')

    const githubLink = screen.getByRole('link', { name: 'GitHub 开源仓库' })
    expect(githubLink).toHaveAttribute('href', GITHUB_REPOSITORY_URL)
    expect(githubLink).toHaveAttribute('target', '_blank')
    expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(githubLink).toHaveAttribute('title', 'GitHub 开源仓库')

    const githubIcon = githubLink.querySelector('svg')
    expect(githubIcon).toBeInTheDocument()
    expect(githubIcon).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses the configured Xianyu URL for the landing-page CDK entry', () => {
    mockPublicContent('https://example.com/xianyu-listing')
    render(<ThemeProvider><MemoryRouter><LandingPage onStart={() => undefined} /></MemoryRouter></ThemeProvider>)

    const purchaseLink = screen.getByRole('link', { name: '获取 CDK' })
    expect(purchaseLink).toHaveAttribute('href', 'https://example.com/xianyu-listing')
    expect(purchaseLink).toHaveAttribute('target', '_blank')
    expect(purchaseLink).toHaveAttribute('rel', 'noreferrer')
  })

  it.each([
    { label: 'empty configuration', url: '', isFallback: false },
    { label: 'initial configuration failure', url: 'https://example.com/stale-listing', isFallback: true },
  ])('hides the landing-page CDK entry for $label', ({ url, isFallback }) => {
    mockPublicContent(url, isFallback)
    render(<ThemeProvider><MemoryRouter><LandingPage onStart={() => undefined} /></MemoryRouter></ThemeProvider>)

    expect(screen.queryByRole('link', { name: '获取 CDK' })).not.toBeInTheDocument()
  })

  it('keeps FAQ, support, and home links in the compact public menu', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/privacy']}><App /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: '更多操作' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'FAQ' })).toHaveAttribute('href', '/faq')
    expect(within(menu).getByRole('menuitem', { name: '客服' })).toHaveAttribute('href', '/support')
    expect(within(menu).getByRole('menuitem', { name: '返回首页' })).toHaveAttribute('href', '/')
  })

  it('preserves the disabled landing header CTA while site features are unavailable', () => {
    vi.spyOn(siteFeatureContext, 'useSiteFeatures').mockReturnValue({
      status: 'ready',
      features: { ...DEFAULT_SITE_FEATURES, site: false },
      updatedAt: null,
      retry: vi.fn(),
    })
    const { container } = render(<ThemeProvider><MemoryRouter><LandingPage onStart={() => undefined} /></MemoryRouter></ThemeProvider>)

    const headerCta = container.querySelector<HTMLButtonElement>('.public-nav .tool-primary-action')
    expect(headerCta).toBeDisabled()
    expect(headerCta).toHaveClass('inline-flex', 'items-center', 'justify-center')
  })

  it('highlights the complete FAQ card when its summary receives keyboard focus', async () => {
    render(<MemoryRouter initialEntries={['/faq']}><App /></MemoryRouter>)

    const question = await screen.findByText('使用 MaaTool 需要准备什么？')
    const summary = question.closest('summary')
    const faqCard = summary?.closest('details')
    expect(summary).toHaveClass('focus-visible:outline-none')
    expect(summary).not.toHaveClass('focus:ring-2', 'focus-visible:ring-1')
    expect(faqCard).toHaveClass('has-[summary:focus-visible]:border-brand-500/55', 'has-[summary:focus-visible]:bg-surface-1')
  })

  it('covers the core FAQ workflow and product boundaries', async () => {
    render(<MemoryRouter initialEntries={['/faq']}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: '常见问题' })).toBeInTheDocument()
    const faqList = screen.getByRole('region', { name: 'FAQ 列表' })
    expect(faqList.querySelectorAll('details')).toHaveLength(19)

    const expectedQuestions = [
      'MaaTool 账号、游戏账号档案和 CDK 分别是什么？',
      '使用森空岛导入需要提供《明日方舟》游戏密码吗？',
      '免费档案和单账号终身版有什么区别？',
      '游戏数据变化后，排班会自动实时更新吗？',
      '为什么结果页没有 MAA JSON 下载？',
      'MAA 排班和游戏内轮换有什么区别？',
      '绑定后可以自行更换游戏 UID 吗？',
      'MaaTool 如何保护账号和授权数据？',
      '联系客服时需要提供哪些信息？',
      '如何加入 MaaTool QQ 交流群？',
    ]

    for (const question of expectedQuestions) {
      expect(screen.getByText(question)).toBeInTheDocument()
    }
    expect(screen.getByText(/免费档案按有效高级体验期或导出体验券规则使用/)).toBeInTheDocument()
    expect(screen.getAllByText(/完整计算 JSON.*不应导入 MAA/).length).toBeGreaterThan(0)
    expect(screen.getByText(/游戏内轮换会生成两班设施预设队列/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /加入 QQ 群.*891655477/ }).length).toBeGreaterThan(0)
  })

  it('states the current risk-data retention policy without rollout details', async () => {
    render(<MemoryRouter initialEntries={['/privacy']}><App /></MemoryRouter>)

    expect(await screen.findByText(/异常使用记录及相关复核材料最长保留 90 天/)).toBeInTheDocument()
    expect(screen.queryByText(/不回填上线前历史/)).not.toBeInTheDocument()
  })
})

function mockPublicContent(xianyuUrl: string, isFallback = false): void {
  const content = cloneDefaultPublicContentSettings()
  content.cdk_purchase.xianyu_url = xianyuUrl
  vi.spyOn(publicContentContext, 'usePublicContent').mockReturnValue({
    status: 'ready',
    isFallback,
    content,
    refresh: vi.fn(),
  })
}
