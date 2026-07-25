// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  categorizeBehaviorRiskPath,
  getBehaviorRiskBrowserInstance,
} from './behavior-risk-client'

describe('behavior risk client', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('uses one first-party random browser instance without exposing route details', () => {
    const first = getBehaviorRiskBrowserInstance()
    const second = getBehaviorRiskBrowserInstance()
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
    expect(second).toBe(first)
  })

  it('maps full paths to the approved coarse categories', () => {
    expect(categorizeBehaviorRiskPath('/tool/profiles?secret=value')).toBe('profiles')
    expect(categorizeBehaviorRiskPath('/tool/setup/config')).toBe('workspace')
    expect(categorizeBehaviorRiskPath('/tool/optimize/result')).toBe('result')
    expect(categorizeBehaviorRiskPath('/privacy')).toBe('public_info')
  })
})
