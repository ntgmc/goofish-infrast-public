import { describe, expect, it } from 'vitest'
import { CURRENT_PERSONAL_USE_DECLARATION, isCurrentPersonalUseDeclarationEffective, toPublicPersonalUseDeclaration } from './personal-use-declaration'

describe('personal use declaration V1.1', () => {
  it('exposes the immutable V1.1 document without its server storage body', () => {
    const publicDeclaration = toPublicPersonalUseDeclaration()

    expect(CURRENT_PERSONAL_USE_DECLARATION.id).toBe('personal_use_v1_1')
    expect(CURRENT_PERSONAL_USE_DECLARATION.version).toBe('V1.1')
    expect(CURRENT_PERSONAL_USE_DECLARATION.effectiveDate).toBe('2026-07-31')
    expect(CURRENT_PERSONAL_USE_DECLARATION.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(CURRENT_PERSONAL_USE_DECLARATION.content).toContain('为第三方有偿或无偿代注册')
    expect(publicDeclaration).not.toHaveProperty('content')
    expect(publicDeclaration.sections).toHaveLength(5)
  })

  it('does not apply the declaration before its effective date', () => {
    expect(isCurrentPersonalUseDeclarationEffective(new Date('2026-07-30T15:59:59.999Z'))).toBe(false)
    expect(isCurrentPersonalUseDeclarationEffective(new Date('2026-07-30T16:00:00.000Z'))).toBe(true)
  })
})
