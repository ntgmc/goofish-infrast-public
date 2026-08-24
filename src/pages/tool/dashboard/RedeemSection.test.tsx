// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tourStorageKey } from '../../../components/GuidedTour'
import RedeemSection from './RedeemSection'

afterEach(() => cleanup())

describe('RedeemSection guided tour', () => {
  it('explains both paths without submitting or opening the Skland dialog', async () => {
    window.localStorage.removeItem(tourStorageKey('dashboard-redeem', 1))
    const user = userEvent.setup()
    const onRedeemed = vi.fn()
    render(<RedeemSection onRedeemed={onRedeemed} />)

    expect(await screen.findByRole('heading', { name: '选择添加账号的方式' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByRole('heading', { name: '兑换 CDK' })).toBeInTheDocument()
    expect(screen.getByLabelText('CDK', { selector: 'input', exact: true })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByRole('heading', { name: '领取免费个人排班' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '通过森空岛领取免费个人排班', hidden: true })).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(onRedeemed).not.toHaveBeenCalled()
  })
})
