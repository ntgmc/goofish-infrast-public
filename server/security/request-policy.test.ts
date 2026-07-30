import { describe, expect, it } from 'vitest'
import { requestSchemas } from './request-policy'

const codeHash = 'a'.repeat(64)

describe('admin CDK baseline request policy', () => {
  it('accepts the new baseline action and all trusted sources', () => {
    for (const baselineSource of ['latest', 'workspace', 'next_import']) {
      expect(requestSchemas.adminCdkPatch.safeParse({
        code_hash: codeHash,
        action: 'set_operator_baseline',
        baseline_source: baselineSource,
        reason: '人工核验通过',
      }).success).toBe(true)
    }
  })

  it('accepts the legacy action name longer than 32 characters', () => {
    expect(requestSchemas.adminCdkPatch.safeParse({
      code_hash: codeHash,
      action: 'accept_operator_baseline_and_unfreeze',
      reason: '兼容旧管理后台',
    }).success).toBe(true)
  })

  it('rejects unknown sources and extra fields', () => {
    expect(requestSchemas.adminCdkPatch.safeParse({
      code_hash: codeHash,
      action: 'set_operator_baseline',
      baseline_source: 'uploaded_json',
      reason: '不应接受任意上传',
    }).success).toBe(false)
    expect(requestSchemas.adminCdkPatch.safeParse({
      code_hash: codeHash,
      action: 'set_operator_baseline',
      baseline_source: 'latest',
      reason: '不应信任客户端指纹',
      fingerprint: { hash: 'client-controlled' },
    }).success).toBe(false)
  })
})
