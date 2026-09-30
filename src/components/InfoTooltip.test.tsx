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
  it('opens from a touch-style click', async () => {
    const user = userEvent.setup()
    render(<InfoTooltip label="查看说明">折叠说明内容</InfoTooltip>)

    await user.click(screen.getByRole('button', { name: '查看说明' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('折叠说明内容')
  })
})
