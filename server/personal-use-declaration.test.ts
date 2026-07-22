import { describe, expect, it } from 'vitest'
import { CURRENT_PERSONAL_USE_DECLARATION, isCurrentPersonalUseDeclarationEffective, toPublicPersonalUseDeclaration } from './personal-use-declaration'

describe('personal use declaration V1.0', () => {
  it('exposes the immutable V1.0 document without its server storage body', () => {
    const publicDeclaration = toPublicPersonalUseDeclaration()

    expect(CURRENT_PERSONAL_USE_DECLARATION.id).toBe('personal_use_v1')
    expect(CURRENT_PERSONAL_USE_DECLARATION.version).toBe('V1.0')
    expect(CURRENT_PERSONAL_USE_DECLARATION.effectiveDate).toBe('2026-07-23')
    expect(CURRENT_PERSONAL_USE_DECLARATION.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(CURRENT_PERSONAL_USE_DECLARATION.content).toContain('为第三方有偿或无偿代注册')
    expect(publicDeclaration).not.toHaveProperty('content')
    expect(publicDeclaration.sections).toHaveLength(5)
  })

  it('does not apply the declaration before its effective date', () => {
    expect(isCurrentPersonalUseDeclarationEffective(new Date('2026-07-22T15:59:59.999Z'))).toBe(false)
    expect(isCurrentPersonalUseDeclarationEffective(new Date('2026-07-22T16:00:00.000Z'))).toBe(true)
  })
})
