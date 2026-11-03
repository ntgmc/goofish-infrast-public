import { describe, expect, it } from 'vitest'
import { CONFIG_PRESETS } from '../../src/lib/config'
import { licenseConfigSchema } from '../../src/lib/workspace-validation'
import { resolveConfigForPermission, resolveFreePreviewConfig } from './license-utils'

describe('Orundum preference across saved config and permission boundaries', () => {
  it.each(['production', 'economy'] as const)('preserves %s for preset and free profiles', (preference) => {
    const config = licenseConfigSchema.parse({ ...structuredClone(CONFIG_PRESETS['333']), orundum_planning: { preference } })
    for (const resolved of [resolveConfigForPermission('recommended', config), resolveFreePreviewConfig(config)]) {
      expect(resolved.ok).toBe(true)
      if (resolved.ok) expect(resolved.config.orundum_planning?.preference).toBe(preference)
    }
  })
})
