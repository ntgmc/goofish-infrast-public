import { afterEach, describe, expect, it } from 'vitest'
import { describeServerError, sanitizeServerLogText } from './error-reporting'

const originalTestApiKey = process.env.ERROR_REPORTING_TEST_API_KEY

afterEach(() => {
  if (originalTestApiKey === undefined) delete process.env.ERROR_REPORTING_TEST_API_KEY
  else process.env.ERROR_REPORTING_TEST_API_KEY = originalTestApiKey
})

describe('server error reporting', () => {
  it('keeps diagnostic error fields and an application stack location', () => {
    const error = Object.assign(new Error('upstream connection failed'), { code: 'ECONNRESET' })
    error.stack = 'Error: upstream connection failed\n    at importCredential (D:/repo/server/handlers/user-skland.ts:100:5)\n    at node:internal/process/task_queues:1:1'

    expect(describeServerError(error)).toEqual({
      name: 'Error',
      message: 'upstream connection failed',
      code: 'ECONNRESET',
      location: 'at importCredential (D:/repo/server/handlers/user-skland.ts:100:5)',
    })
  })

  it('redacts configured secrets, credentials, bearer tokens, and URL passwords', () => {
    process.env.ERROR_REPORTING_TEST_API_KEY = 'actual-api-key-value'
    const raw = [
      'ERROR_REPORTING_TEST_API_KEY=actual-api-key-value',
      'credential_text=raw-credential-value',
      'Bearer bearer-token-value',
      'postgresql://user:database-password@localhost/example',
    ].join(' ')

    const sanitized = sanitizeServerLogText(raw)

    expect(sanitized).not.toContain('actual-api-key-value')
    expect(sanitized).not.toContain('raw-credential-value')
    expect(sanitized).not.toContain('bearer-token-value')
    expect(sanitized).not.toContain('database-password')
    expect(sanitized).toContain('<redacted>')
  })

  it('reports a sanitized cause without recursively dumping error objects', () => {
    const cause = Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' })
    const error = new Error('森空岛请求失败', { cause })

    expect(describeServerError(error)).toMatchObject({
      message: '森空岛请求失败',
      cause: {
        name: 'Error',
        message: 'socket closed',
        code: 'UND_ERR_SOCKET',
      },
    })
  })
})
