// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { CONFIG_PRESETS } from '../../../lib/config'
import ConfigSection from './ConfigSection'

afterEach(cleanup)

describe('ConfigSection', () => {
  it('does not expose the obsolete configuration restore action', async () => {
    render(
      <ConfigSection
        activeConfig={CONFIG_PRESETS['243']}
        permission="advanced"
        userCanEditConfig
        userCanUseIntermediateAutoConfig={false}
        configChanged
        configPresetLabel="243 均衡"
        configValidation={{ ok: true }}
        configSyncStatus="idle"
        latestResult={null}
        diffRows={[]}
        updateConfig={vi.fn()}
        retryConfigSave={vi.fn()}
      />,
    )

    await screen.findByRole('button', { name: '243 均衡' })
    expect(screen.queryByRole('button', { name: /恢复/ })).not.toBeInTheDocument()
  })

  it('shows preset selection for the free configuration', async () => {
    const user = userEvent.setup()
    const updateConfig = vi.fn()
    render(
      <MemoryRouter>
        <ConfigSection
          activeConfig={CONFIG_PRESETS['243']}
          permission="growth"
          isPreviewProfile
          userCanEditConfig={false}
          userCanUseIntermediateAutoConfig
          configChanged={false}
          configPresetLabel="243 均衡"
          configValidation={{ ok: true }}
          configSyncStatus="idle"
          latestResult={null}
          diffRows={[]}
          updateConfig={updateConfig}
          retryConfigSave={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/当前为 免费预览 权限，可通过中间产物库存自动调整推荐配置/)).toBeInTheDocument()
    expect(screen.queryByText(/当前为 练度提升卡 权限/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '当前免费配置' }))
    await user.click(await screen.findByRole('button', { name: '右满252（经验多）' }))

    expect(updateConfig).toHaveBeenCalledOnce()
  })
})
