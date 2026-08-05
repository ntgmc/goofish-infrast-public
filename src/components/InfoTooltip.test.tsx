// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import InfoTooltip from './InfoTooltip'

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterAll(() => vi.unstubAllGlobals())
afterEach(cleanup)

describe('InfoTooltip', () => {
  it('shows its explanation on hover and exposes an accessible trigger', async () => {
    const user = userEvent.setup()
    render(
      <InfoTooltip label="了解优先计算券">
        券只影响排队顺序，服务端执行失败时会自动退回。
      </InfoTooltip>,
    )

    const trigger = screen.getByRole('button', { name: '了解优先计算券' })
    expect(trigger).toHaveAttribute('data-slot', 'tooltip-trigger')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.hover(trigger)

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveAttribute('data-slot', 'tooltip-content')
    expect(tooltip).toHaveClass('w-[min(20rem,calc(100vw-2rem))]')
    expect(tooltip).toHaveTextContent('券只影响排队顺序')
  })

  it('opens from a touch-style click', async () => {
    const user = userEvent.setup()
    render(<InfoTooltip label="查看说明">折叠说明内容</InfoTooltip>)

    await user.click(screen.getByRole('button', { name: '查看说明' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('折叠说明内容')
  })
})
