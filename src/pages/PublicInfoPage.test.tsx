// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import LandingPage from './LandingPage'
import { type PublicInfoPageKind } from './PublicInfoPage'
import { SUPPORT_QQ_GROUP_URL } from '../components/PublicFooter'
import { ThemeProvider } from '../lib/theme'

afterEach(() => cleanup())

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

    const supportLink = screen.getByRole('link', { name: /加入 QQ 群.*891655477/ })
    expect(supportLink).toHaveAttribute('href', SUPPORT_QQ_GROUP_URL)
    expect(supportLink).toHaveAttribute('target', '_blank')
    expect(supportLink).toHaveAttribute('rel', 'noopener noreferrer')
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
    expect(screen.getByText(/免费档案不提供 JSON 下载/)).toBeInTheDocument()
    expect(screen.getByText(/游戏内轮换会生成两班设施预设队列/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /加入 QQ 群.*891655477/ }).length).toBeGreaterThan(0)
  })
})
