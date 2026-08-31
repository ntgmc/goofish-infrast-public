// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
})
