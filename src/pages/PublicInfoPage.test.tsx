// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import LandingPage from './LandingPage'
import { type PublicInfoPageKind } from './PublicInfoPage'
import { SUPPORT_QQ_GROUP_URL } from '../components/PublicFooter'

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
    render(<MemoryRouter><LandingPage onStart={() => undefined} /></MemoryRouter>)

    expect(screen.getByRole('link', { name: '常见问题' })).toHaveAttribute('href', '/faq')
    expect(screen.getByRole('link', { name: '用户服务协议' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: '隐私政策' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: '免责声明' })).toHaveAttribute('href', '/disclaimer')

    const supportLink = screen.getByRole('link', { name: '加入 QQ 群' })
    expect(supportLink).toHaveAttribute('href', SUPPORT_QQ_GROUP_URL)
    expect(supportLink).toHaveAttribute('target', '_blank')
    expect(supportLink).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
