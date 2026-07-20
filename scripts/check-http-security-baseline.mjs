import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

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
const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains'
const EXPECTED_HEADERS = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': PERMISSIONS_POLICY,
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
}
const bundleDir = resolve('.cache/check-http-security-baseline')
const bundlePath = resolve(bundleDir, 'http-server.mjs')
let server

try {
  await mkdir(bundleDir, { recursive: true })
  await esbuild.build({
    entryPoints: ['server/http-server.ts'],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@node-rs/argon2', 'pg', 'qrcode'],
    logLevel: 'silent',
  })

  const { createApiServer } = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)
  server = createApiServer()
  assert.equal(server.headersTimeout, 10_000)
  assert.equal(server.requestTimeout, 30_000)
  assert.equal(server.keepAliveTimeout, 5_000)
  assert.equal(server.maxHeadersCount, 100)
  assert.equal(server.maxRequestsPerSocket, 100)
  await listen(server)
  const address = server.address()
  assert(address && typeof address === 'object')
  const port = address.port

  const notFound = await sendRequest(port, { method: 'GET', path: '/api/not-found' })
  assert.equal(notFound.status, 404)
  assertSecurityHeaders(notFound, false, 'HTTP 404')

  const preflight = await sendRequest(port, {
    method: 'OPTIONS',
    path: '/api/admin/session',
    headers: {
      Origin: 'https://attacker.example',
      'Access-Control-Request-Method': 'POST',
    },
  })
  assert.equal(preflight.status, 405)
  assert.equal(preflight.headers.allow, 'DELETE, GET, POST')
  assertSecurityHeaders(preflight, false, 'OPTIONS')

  const authenticationFailure = await sendRequest(port, {
    method: 'POST',
    path: '/api/admin/session',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Proto': 'https',
    },
    body: Buffer.from(JSON.stringify({ username: 'x', password: 'invalid-password' })),
  })
  assert.equal(authenticationFailure.status, 401)
  assertSecurityHeaders(authenticationFailure, true, 'HTTPS authentication failure')

  const unsupportedMediaType = await sendRequest(port, {
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'text/plain' },
    body: Buffer.from('{}'),
  })
  assert.equal(unsupportedMediaType.status, 415)
  assert.equal(JSON.parse(unsupportedMediaType.body).code, 'unsupported_media_type')

  const unknownField = await sendRequest(port, {
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify({ email: 'x@example.com', password: 'password', admin: true })),
  })
  assert.equal(unknownField.status, 400)
  assert.equal(JSON.parse(unknownField.body).code, 'invalid_request')

  const crossSite = await sendRequest(port, {
    method: 'POST',
    path: '/api/auth/login',
    headers: {
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'cross-site',
    },
    body: Buffer.from(JSON.stringify({ email: 'x@example.com', password: 'password' })),
  })
  assert.equal(crossSite.status, 403)
  assert.equal(JSON.parse(crossSite.body).code, 'cross_origin_rejected')

  const payloadTooLarge = await sendRequest(port, {
    method: 'POST',
    path: '/api/auth/login',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(16 * 1024 + 1),
      'X-Forwarded-Proto': 'https',
    },
  })
  assert.equal(payloadTooLarge.status, 413)
  assertSecurityHeaders(payloadTooLarge, true, 'HTTPS 413')

  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    const internalError = await sendRequest(port, {
      method: 'GET',
      path: '/api/not-found',
      headers: {
        Host: '[',
        'X-Forwarded-Proto': 'https',
      },
    })
    assert.equal(internalError.status, 400)
    assertSecurityHeaders(internalError, true, 'HTTPS invalid Host')
  } finally {
    console.error = originalConsoleError
  }

  await assertNginxBaseline()
  await assertNginxTransportHardening()
  await assertStaticNginxBaseline()
  await assertNoServerCorsHeaders()
  await assertNoRawRequestParsing()
  await assertDeploymentDocumentation()

  console.log('[check-http-security-baseline] same-origin API and security header baseline passed')
} finally {
  if (server) {
    server.closeAllConnections?.()
    await close(server)
  }
  await rm(bundleDir, { recursive: true, force: true })
}

function assertSecurityHeaders(response, expectHsts, label) {
  for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
    assert.equal(response.headers[name], value, `${label} should include ${name}`)
  }
  assert.equal(
    response.headers['strict-transport-security'],
    expectHsts ? STRICT_TRANSPORT_SECURITY : undefined,
    `${label} HSTS mismatch`,
  )
  for (const name of Object.keys(response.headers)) {
    assert.equal(name.startsWith('access-control-'), false, `${label} must not include ${name}`)
  }
  assert.equal(CONTENT_SECURITY_POLICY.includes("script-src 'self' 'unsafe-inline'"), false)
  assert.equal(CONTENT_SECURITY_POLICY.includes("'unsafe-eval'"), false)
}

async function assertNginxBaseline() {
  const nginx = await readFile('deploy/nginx/goofish-security-headers.conf', 'utf8')
  const nginxHeaders = {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Strict-Transport-Security': STRICT_TRANSPORT_SECURITY,
  }
  for (const [name, value] of Object.entries(nginxHeaders)) {
    assert(nginx.includes(`proxy_hide_header ${name};`), `Nginx should hide upstream ${name}`)
    assert(nginx.includes(`add_header ${name} "${value}" always;`), `Nginx ${name} mismatch`)
  }
  assert.equal(nginx.includes('preload'), false, 'HSTS preload must remain disabled')
  assert.equal(nginx.includes('Content-Security-Policy-Report-Only'), false)
}

async function assertNginxTransportHardening() {
  const [zones, proxy, server, production, development] = await Promise.all([
    readFile('deploy/nginx/goofish-rate-limit-zones.conf', 'utf8'),
    readFile('deploy/nginx/goofish-proxy-common.conf', 'utf8'),
    readFile('deploy/nginx/goofish-server-hardening.conf', 'utf8'),
    readFile('deploy/nginx/goofish-api-production.conf', 'utf8'),
    readFile('deploy/nginx/goofish-api-development.conf', 'utf8'),
  ])
  for (const expected of [
    'zone=goofish_auth_sensitive_ip:10m rate=10r/m',
    'zone=goofish_credential_ip:10m rate=30r/m',
    'zone=goofish_compute_ip:10m rate=30r/m',
    'limit_conn_zone $binary_remote_addr zone=goofish_api_conn:10m',
  ]) assert(zones.includes(expected), `missing Nginx zone: ${expected}`)
  for (const expected of [
    'client_body_timeout 15s;',
    'send_timeout 30s;',
    'proxy_request_buffering on;',
    'proxy_set_header Connection "";',
    'limit_conn goofish_api_conn 20;',
  ]) assert(proxy.includes(expected), `missing API proxy hardening: ${expected}`)
  for (const expected of [
    'server_tokens off;',
    'client_header_timeout 10s;',
    'keepalive_timeout 15s;',
    'keepalive_requests 100;',
    'large_client_header_buffers 2 8k;',
  ]) assert(server.includes(expected), `missing server hardening: ${expected}`)
  for (const api of [production, development]) {
    assert(api.includes('zone=goofish_auth_sensitive_ip burst=5 nodelay'))
    assert(api.includes('zone=goofish_credential_ip burst=10 nodelay'))
    assert(api.includes('zone=goofish_compute_ip burst=10 nodelay'))
    assert(api.includes('include /etc/nginx/snippets/goofish-proxy-common.conf;'))
  }
}

async function assertStaticNginxBaseline() {
  const nginx = await readFile('deploy/nginx/goofish-static-files.conf', 'utf8')
  assert(nginx.includes('location ^~ /assets/ {'), 'Nginx should reserve /assets/ for static files')
  assert(nginx.includes('try_files $uri =404;'), 'missing /assets/ files must return 404')
  assert(nginx.includes('add_header Cache-Control "public, max-age=31536000, immutable";'))
  assert.equal(nginx.includes('add_header Cache-Control "public, max-age=31536000, immutable" always;'), false)
  assert(nginx.includes('location / {'), 'Nginx should retain an SPA fallback location')
  assert(nginx.includes('try_files $uri $uri/ /index.html;'), 'SPA routes must fall back to index.html')
  assert(nginx.includes('add_header Cache-Control "no-cache";'))
  assert(nginx.includes('location ~ /\\.(?!well-known/) {'), 'Nginx should deny unexpected dotfiles')
  const securityIncludes = nginx.match(/include \/etc\/nginx\/snippets\/goofish-security-headers\.conf;/g) ?? []
  assert.equal(securityIncludes.length, 2, 'static Nginx locations must restore security headers after add_header')
}

async function assertNoServerCorsHeaders() {
  const paths = await readdir('server', { recursive: true })
  const sourcePaths = paths
    .map((path) => String(path).replaceAll('\\', '/'))
    .filter((path) => path.endsWith('.ts') && !path.startsWith('dist/'))
  const sources = await Promise.all(sourcePaths.map((path) => readFile(`server/${path}`, 'utf8')))
  assert.equal(sources.join('\n').includes('Access-Control-Allow-'), false)
}

async function assertDeploymentDocumentation() {
  for (const path of [
    'README.md',
    'docs/production-deploy.md',
    'docs/dev-deploy.md',
    'docs/netlify-migration-plan.md',
  ]) {
    const contents = await readFile(path, 'utf8')
    assert(contents.includes('goofish-security-headers.conf'), `${path} should install the security header snippet`)
    assert(contents.includes('goofish-static-files.conf'), `${path} should install the static Nginx snippet`)
    assert(/HTTPS|TLS/i.test(contents), `${path} should limit the security snippet to TLS`)
  }
  for (const path of ['README.md', 'docs/production-deploy.md', 'docs/dev-deploy.md']) {
    const contents = await readFile(path, 'utf8')
    assert(contents.includes('goofish-server-hardening.conf'), `${path} should install and include server hardening`)
  }
}

async function assertNoRawRequestParsing() {
  const paths = await readdir('server', { recursive: true })
  const sourcePaths = paths
    .map((path) => String(path).replaceAll('\\', '/'))
    .filter((path) => path.endsWith('.ts') && !path.startsWith('dist/') && !path.endsWith('.test.ts'))
  const sources = await Promise.all(sourcePaths.map(async (path) => ({
    path,
    source: await readFile(`server/${path}`, 'utf8'),
  })))
  for (const { path, source } of sources) {
    assert.equal(/\breq\.(?:json|text)\s*\(/.test(source), false, `${path} must use the validated request cache`)
  }
  const httpServer = sources.find(({ path }) => path === 'http-server.ts')?.source ?? ''
  for (const prefix of ['/api/auth/', '/api/user/', '/api/admin/']) {
    assert(httpServer.includes(`'${prefix}'`), `${prefix} responses must disable caching`)
  }
  const routes = sources.find(({ path }) => path === 'routes.ts')?.source ?? ''
  assert.equal(routes.includes("req.method === 'OPTIONS'"), false, 'route dispatch must not bypass the HTTP OPTIONS policy')
}

function sendRequest(port, options) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      method: options.method ?? 'POST',
      path: options.path,
      headers: options.headers,
      agent: false,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()))
}
