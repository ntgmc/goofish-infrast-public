// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '../../../test/query-render'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ServiceStatus from './ServiceStatus'

const history = {
  from: '2026-11-07T00:00:00.000Z',
  to: '2026-11-14T00:00:00.000Z',
  interval: 'hour',
  complete: false,
  buckets: [{ component_id: 'optimization', bucket_start: '2026-11-13T22:00:00.000Z', status: 'overloaded', sample_count: 12, availability_percent: 75 }],
}
const payload = {
  generated_at: '2026-11-14T00:00:00.000Z', status: 'available', queue: null,
  components: [{ id: 'optimization', status: 'available' }, { id: 'skland_import', status: 'unavailable' }],
  history, incidents: [],
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function renderStatus() {
  render(<ServiceStatus />)
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled())
}

describe('V2 service status history', () => {
  it('exposes hour details on selection and moves one grid tab stop across hours and days', async () => {
    await renderStatus()
    const grid = screen.getByRole('grid')
    const buttons = within(grid).getAllByRole('button')
    expect(buttons).toHaveLength(168)
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([buttons[167]])

    buttons[167].focus()
    fireEvent.keyDown(buttons[167], { key: 'ArrowLeft' })
    expect(buttons[166]).toHaveFocus()
    expect(document.getElementById('v2-service-hour-detail')).toHaveTextContent('排队过多，记录数 12，可用率 75%')
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([buttons[166]])

    fireEvent.keyDown(buttons[166], { key: 'ArrowUp' })
    expect(buttons[142]).toHaveFocus()
    fireEvent.keyDown(buttons[142], { key: 'Home' })
    expect(buttons[120]).toHaveFocus()
    fireEvent.keyDown(buttons[120], { key: 'End' })
    expect(buttons[143]).toHaveFocus()
    fireEvent.keyDown(buttons[143], { key: 'Home', ctrlKey: true })
    expect(buttons[0]).toHaveFocus()
    fireEvent.keyDown(buttons[0], { key: 'ArrowLeft' })
    expect(buttons[0]).toHaveFocus()
    fireEvent.keyDown(buttons[0], { key: 'End', ctrlKey: true })
    expect(buttons[167]).toHaveFocus()
    fireEvent.keyDown(buttons[167], { key: 'ArrowRight' })
    expect(buttons[167]).toHaveFocus()
    fireEvent.click(buttons[166])
    expect(buttons[166].closest('[role="gridcell"]')).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('v2-service-hour-detail')).toHaveTextContent('排队过多')
  })

  it('keeps component states independent and retains history after a failed refresh', async () => {
    await renderStatus()
    expect(screen.getByRole('heading', { name: '森空岛导入' }).closest('article')).toHaveTextContent('不可用')
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network error'))
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法获取服务状态')
    expect(screen.getByRole('heading', { name: '当前服务运行正常。' })).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell')).toHaveLength(168)
  })

  it('uses an unknown state when status cannot be fetched without reporting an outage', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('network error'))
    await renderStatus()
    const summary = screen.getByRole('heading', { name: '状态暂时无法获取' }).closest('section')
    expect(summary).toHaveAttribute('data-level', 'unknown')
    expect(summary).not.toHaveTextContent('暂不可用')
    expect(document.getElementById('v2-service-hour-detail')).toHaveTextContent('状态未知')
  })
})
