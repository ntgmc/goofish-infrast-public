import { describe, expect, it } from 'vitest'
import { noStoreResponse } from './optimization'

describe('optimization job status responses', () => {
  it('prevents browsers and intermediaries from caching status', () => {
    const response = noStoreResponse(new Response('{}', {
      headers: { 'Cache-Control': 'public, max-age=60' },
    }))

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
