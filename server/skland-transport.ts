const REQUEST_TIMEOUT_MS = 25_000
const HEALTH_TIMEOUT_MS = 3_000
const HEALTH_CACHE_MS = 10_000

export const SKLAND_UPSTREAM_ORIGINS = ['https://as.hypergryph.com', 'https://zonai.skland.com'] as const

export function getSklandConnectorConfiguration(): { url: string; token: string } | null {
  const url = process.env.SKLAND_CONNECTOR_URL?.trim()
  const token = process.env.SKLAND_CONNECTOR_TOKEN?.trim()
  if (!url && !token && process.env.NODE_ENV !== 'production') return null
  if (!url || !token || token.length < 32 || /\s/.test(token)) throw new Error('森空岛连接服务配置无效。')
  const parsed = new URL(url)
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/'
    || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(parsed.hostname)))) {
    throw new Error('森空岛连接服务必须使用 HTTPS 或本机加密隧道。')
  }
  return { url: parsed.origin, token }
}

export class SklandConnectorError extends Error {
  constructor() {
    super('森空岛登录与导入服务暂时不可用，请稍后重试。')
    this.name = 'SklandConnectorError'
  }
}

export async function fetchSkland(url: string, init: RequestInit): Promise<Response> {
  const connector = getSklandConnectorConfiguration()
  if (!connector) return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  try {
    const response = await fetch(`${connector.url}/request`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${connector.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, method: init.method, headers: Object.fromEntries(new Headers(init.headers)), body: init.body }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS + 3_000),
    })
    // Connector authentication failures must never invalidate a user's Skland credential.
    if (response.headers.get('X-Skland-Upstream') !== 'true') {
      await response.body?.cancel()
      throw new SklandConnectorError()
    }
    return response
  } catch {
    throw new SklandConnectorError()
  }
}

let connectorHealth: { key: string; expiresAt: number; promise: Promise<boolean> } | undefined

export async function isSklandConnectorReady(): Promise<boolean> {
  try {
    const connector = getSklandConnectorConfiguration()
    if (!connector) return false
    const key = `${connector.url}\n${connector.token}`
    if (connectorHealth?.key === key && connectorHealth.expiresAt > Date.now()) return connectorHealth.promise
    const promise = fetch(`${connector.url}/health/ready`, {
      headers: { Authorization: `Bearer ${connector.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS + 1_000),
    }).then(async (response) => {
      if (!response.ok) return false
      const data = await response.json()
      return data?.ok === true && data?.role === 'skland-connector'
    }).catch(() => false)
    connectorHealth = { key, expiresAt: Date.now() + HEALTH_CACHE_MS, promise }
    return promise
  } catch {
    return false
  }
}

export async function checkSklandUpstreams(): Promise<boolean> {
  const results = await Promise.all(SKLAND_UPSTREAM_ORIGINS.map(async (origin) => {
    try {
      // Unauthenticated probes check connectivity without creating a login or touching an account.
      const response = await fetch(origin, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
      await response.body?.cancel()
      return response.status < 500 && response.status !== 429
    } catch {
      return false
    }
  }))
  return results.every(Boolean)
}
