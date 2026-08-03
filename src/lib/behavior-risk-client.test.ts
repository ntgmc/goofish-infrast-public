// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import * as behaviorRiskClient from './behavior-risk-client'

const { categorizeBehaviorRiskPath } = behaviorRiskClient

describe('behavior risk client', () => {
  it('does not expose a client-controlled device identifier', () => {
    expect('getBehaviorRiskBrowserInstance' in behaviorRiskClient).toBe(false)
    expect('BEHAVIOR_RISK_BROWSER_HEADER' in behaviorRiskClient).toBe(false)
  })

  it('maps full paths to the approved coarse categories', () => {
    expect(categorizeBehaviorRiskPath('/tool/profiles?secret=value')).toBe('profiles')
    expect(categorizeBehaviorRiskPath('/tool/setup/config')).toBe('workspace')
    expect(categorizeBehaviorRiskPath('/tool/optimize/result')).toBe('result')
    expect(categorizeBehaviorRiskPath('/privacy')).toBe('public_info')
  })
})
