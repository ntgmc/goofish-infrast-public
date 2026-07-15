import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "worker-src 'none'",
  'upgrade-insecure-requests',
].join('; ')
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'bluetooth=()',
  'browsing-topics=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'serial=()',
  'usb=()',
].join(', ')
const EXPECTED_SECURITY_HEADERS = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': PERMISSIONS_POLICY,
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
}
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export async function runPublicHttpSmoke(baseUrl, options = {}) {
  const origin = normalizeOrigin(baseUrl)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  assert.equal(typeof fetchImpl, 'function', 'a fetch implementation is required')

  const home = await fetchPath(fetchImpl, origin, '/', 'GET')
  assert.equal(home.status, 200, 'GET / should return 200')
  assertSecurityHeaders(home, 'GET /')
  assert.match(home.headers.get('content-type') ?? '', /^text\/html\b/i, 'GET / should return HTML')
  const homeHtml = await home.text()

  const tool = await fetchPath(fetchImpl, origin, '/tool', 'GET')
  assert.equal(tool.status, 200, 'GET /tool should return 200')
  assertSecurityHeaders(tool, 'GET /tool')
  assert.match(tool.headers.get('content-type') ?? '', /^text\/html\b/i, 'GET /tool should return HTML')

  const health = await fetchPath(fetchImpl, origin, '/api/health', 'GET')
  assert.equal(health.status, 200, 'GET /api/health should return 200')
  assertSecurityHeaders(health, 'GET /api/health')
  const healthBody = await health.json()
  assert.equal(healthBody?.ok, true, 'GET /api/health should return ok=true')

  for (const healthPath of ['/api/health/live', '/api/health/ready']) {
    const response = await fetchPath(fetchImpl, origin, healthPath, 'GET')
    assert.equal(response.status, 200, `GET ${healthPath} should return 200`)
    assertSecurityHeaders(response, `GET ${healthPath}`)
    assert.equal((await response.json())?.ok, true, `GET ${healthPath} should return ok=true`)
  }

  for (const path of ['/', '/tool']) {
    const response = await fetchPath(fetchImpl, origin, path, 'HEAD')
    assert.equal(response.status, 200, `HEAD ${path} should return 200`)
    assertSecurityHeaders(response, `HEAD ${path}`)
  }

  const assets = extractAssetPaths(homeHtml)
  for (const extension of ['css', 'js']) {
    const path = assets.find((assetPath) => assetPath.endsWith(`.${extension}`))
    assert(path, `GET / should reference an /assets/*.${extension} file`)
    const response = await fetchPath(fetchImpl, origin, path, 'GET')
    assert.equal(response.status, 200, `GET ${path} should return 200`)
    assertSecurityHeaders(response, `GET ${path}`)
    assert.equal(response.headers.get('cache-control'), IMMUTABLE_CACHE_CONTROL, `${path} cache policy mismatch`)
  }

  const missingAssetPath = `/assets/public-http-smoke-missing-${Date.now()}-${Math.random().toString(16).slice(2)}.css`
  const missingAsset = await fetchPath(fetchImpl, origin, missingAssetPath, 'GET')
  assert.equal(missingAsset.status, 404, 'missing CSS asset should return 404 instead of the SPA document')
  assertSecurityHeaders(missingAsset, 'missing CSS asset')
  assert.equal(missingAsset.headers.has('cache-control'), false, 'missing CSS asset must not receive an immutable cache policy')
}

function normalizeOrigin(baseUrl) {
  assert(baseUrl, 'PUBLIC_BASE_URL is required')
  const origin = new URL(baseUrl)
  assert(['http:', 'https:'].includes(origin.protocol), 'PUBLIC_BASE_URL must use HTTP or HTTPS')
  return new URL('/', origin)
}

async function fetchPath(fetchImpl, origin, path, method) {
  return fetchImpl(new URL(path, origin), {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
}

function assertSecurityHeaders(response, label) {
  for (const [name, expected] of Object.entries(EXPECTED_SECURITY_HEADERS)) {
    assert.equal(response.headers.get(name), expected, `${label} security header mismatch: ${name}`)
  }
}

function extractAssetPaths(html) {
  return [...new Set(
    [...html.matchAll(/\b(?:src|href)=["'](\/assets\/[^"'?#]+\.(?:css|js))(?:\?[^"']*)?["']/gi)]
      .map((match) => match[1]),
  )]
}

async function runSelfTest() {
  await withFixture('valid', async (baseUrl) => runPublicHttpSmoke(baseUrl))
  await withFixture('missing-security-header', async (baseUrl) => {
    await assert.rejects(() => runPublicHttpSmoke(baseUrl), /content-security-policy/)
  })
  await withFixture('incorrect-asset-cache', async (baseUrl) => {
    await assert.rejects(() => runPublicHttpSmoke(baseUrl), /cache policy mismatch/)
  })
  await withFixture('spa-asset-fallback', async (baseUrl) => {
    await assert.rejects(() => runPublicHttpSmoke(baseUrl), /missing CSS asset should return 404/)
  })
  console.log('[check-public-http-smoke] public HTTPS smoke fixture checks passed')
}

async function withFixture(mode, check) {
  const server = createFixtureServer(mode)
  await listen(server)
  const address = server.address()
  assert(address && typeof address === 'object', 'fixture server did not expose a TCP address')
  try {
    await check(`http://127.0.0.1:${address.port}`)
  } finally {
    await close(server)
  }
}

function createFixtureServer(mode) {
  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.test').pathname
    const headers = mode === 'missing-security-header' && path === '/'
      ? omitHeader(EXPECTED_SECURITY_HEADERS, 'content-security-policy')
      : EXPECTED_SECURITY_HEADERS

    if (path === '/' || path === '/tool') {
      writeResponse(response, request.method, 200, {
        ...headers,
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
      }, '<link href="/assets/app.css"><script src="/assets/app.js"></script>')
      return
    }

    if (path === '/api/health' || path === '/api/health/live' || path === '/api/health/ready') {
      writeResponse(response, request.method, 200, {
        ...headers,
        'content-type': 'application/json',
      }, JSON.stringify({ ok: true, state: 'ready' }))
      return
    }

    if (path === '/assets/app.css' || path === '/assets/app.js') {
      const cacheControl = mode === 'incorrect-asset-cache' && path === '/assets/app.js'
        ? 'no-cache'
        : IMMUTABLE_CACHE_CONTROL
      writeResponse(response, request.method, 200, {
        ...headers,
        'content-type': path.endsWith('.css') ? 'text/css' : 'application/javascript',
        'cache-control': cacheControl,
      }, '')
      return
    }

    if (path.startsWith('/assets/')) {
      const status = mode === 'spa-asset-fallback' ? 200 : 404
      writeResponse(response, request.method, status, {
        ...headers,
        'content-type': 'text/html; charset=utf-8',
        ...(status === 200 ? { 'cache-control': 'no-cache' } : {}),
      }, '<html>not found</html>')
      return
    }

    writeResponse(response, request.method, 404, headers, '')
  })
}

function omitHeader(headers, name) {
  return Object.fromEntries(Object.entries(headers).filter(([header]) => header !== name))
}

function writeResponse(response, method, status, headers, body) {
  response.writeHead(status, headers)
  response.end(method === 'HEAD' ? undefined : body)
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolveListen()
    })
  })
}

function close(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose())
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--self-test') {
    await runSelfTest()
  } else {
    await runPublicHttpSmoke(process.argv[2])
    console.log(`[check-public-http-smoke] ${process.argv[2]} passed`)
  }
}
