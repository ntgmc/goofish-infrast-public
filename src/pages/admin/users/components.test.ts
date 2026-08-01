import { describe, expect, it } from 'vitest'
import { personalUseActionLabel } from './components'

describe('personal-use admin action labels', () => {
  it('labels every protected action explicitly', () => {
    expect(personalUseActionLabel('free_preview_claim')).toBe('领取免费权益')
    expect(personalUseActionLabel('metered_personal_create')).toBe('创建/转换个人按次档案')
    expect(personalUseActionLabel('generated_result_export')).toBe('导出生成结果')
    expect(personalUseActionLabel('optimization_generate')).toBe('生成排班结果')
    expect(personalUseActionLabel('reorder_check')).toBe('调序检查')
  })
})
