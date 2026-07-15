// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LicenseConfig } from '../../../lib/types'
import ScenarioLabSection from './ScenarioLabSection'

vi.mock('../../../lib/scenario-comparison', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/scenario-comparison')>()
  return {
    ...actual,
    expandScenarioComparison: () => ({
      rawCombinationCount: 1,
      skipped: [],
      scenarios: [{ id: 'scenario-1' }],
    }),
  }
})

vi.mock('./scenario-lab/useScenarioComparison', () => ({
  useScenarioComparison: () => ({
    factors: { layouts: [], maaSchedules: [], includeRotation: false, droneStrategies: [] },
    setFactors: vi.fn(),
    result: null,
    error: null,
    loading: false,
    progress: null,
    run: vi.fn(),
  }),
}))

afterEach(cleanup)

describe('ScenarioLabSection', () => {
  it('stacks scenario controls above experiment results at every breakpoint', () => {
    render(
      <ScenarioLabSection
        profileId="profile-1"
        operators={[]}
        activeConfig={{} as LicenseConfig}
        onApplyConfig={vi.fn()}
      />,
    )

    const layout = screen.getByRole('region', { name: '定义比较场景' })
    expect(layout).toHaveClass('grid', 'min-w-0', 'gap-4')
    expect(layout.className).not.toContain('grid-cols')
  })
})
