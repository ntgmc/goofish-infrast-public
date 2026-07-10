import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const DEFAULT_LIMIT_BYTES = 256 * 1024
const DEPOT_LIMIT_BYTES = 1024 * 1024
const bundleDir = resolve('.cache/check-http-body-limit')
const bundlePath = resolve(bundleDir, 'http-server.mjs')
const originalConsoleError = console.error
let server

console.error = (...args) => {
  if (String(args[0] ?? '').startsWith('depot value error:')) return
  originalConsoleError(...args)
}

try {
  await mkdir(bundleDir, { recursive: true })
  await esbuild.build({
    entryPoints: ['server/http-server.ts'],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['pg', 'qrcode'],
    logLevel: 'silent',
  })

  const { createApiServer } = await import(pathToFileURL(bundlePath).href)
  server = createApiServer()
  await listen(server)
  const address = server.address()
  assert(address && typeof address === 'object', 'server did not expose a TCP address')
  const port = address.port

  const defaultBoundary = await sendRequest(port, {
    path: '/api/not-found',
    body: Buffer.alloc(DEFAULT_LIMIT_BYTES, 'x'),
  })
  assert.equal(defaultBoundary.status, 404, 'default boundary request should reach routing')

  const declaredTooLarge = await sendRequest(port, {
    path: '/api/not-found',
    headers: { 'Content-Length': String(DEFAULT_LIMIT_BYTES + 1) },
  })
  assertPayloadTooLarge(declaredTooLarge, 'declared oversized request')

  const chunkedTooLarge = await sendRequest(port, {
    path: '/api/not-found',
    chunks: [
      Buffer.alloc(DEFAULT_LIMIT_BYTES / 2, 'x'),
      Buffer.alloc(DEFAULT_LIMIT_BYTES / 2, 'x'),
      Buffer.from('x'),
    ],
  })
  assertPayloadTooLarge(chunkedTooLarge, 'chunked oversized request')

  const depotAboveDefault = await sendRequest(port, {
    path: '/api/depot-value',
    body: Buffer.alloc(DEFAULT_LIMIT_BYTES + 1, 'x'),
  })
  assert.equal(depotAboveDefault.status, 400, 'depot request above the default limit should reach its handler')

  const depotBoundary = await sendRequest(port, {
    path: '/api/depot-value',
    body: Buffer.alloc(DEPOT_LIMIT_BYTES, 'x'),
  })
  assert.equal(depotBoundary.status, 400, 'depot request at 1 MiB should reach its handler')

  const depotTooLarge = await sendRequest(port, {
    path: '/api/depot-value',
    headers: { 'Content-Length': String(DEPOT_LIMIT_BYTES + 1) },
  })
  assertPayloadTooLarge(depotTooLarge, 'oversized depot request')

  const healthyAfterRejection = await sendRequest(port, {
    method: 'GET',
    path: '/api/not-found',
  })
  assert.equal(healthyAfterRejection.status, 404, 'server should remain healthy after a 413 response')

  console.log('[check-http-body-limit] request body limits and 413 connection handling passed')
} finally {
  console.error = originalConsoleError
  if (server) {
    server.closeAllConnections?.()
    await close(server)
  }
  await rm(bundleDir, { recursive: true, force: true })
}

function listen(target) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => rejectListen(error)
    target.once('error', onError)
    target.listen(0, '127.0.0.1', () => {
      target.off('error', onError)
      resolveListen()
    })
  })
}

function close(target) {
  return new Promise((resolveClose, rejectClose) => {
    if (!target.listening) {
      resolveClose()
      return
    }
    target.close((error) => error ? rejectClose(error) : resolveClose())
  })
}

function sendRequest(port, options) {
  return new Promise((resolveRequest, rejectRequest) => {
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
      res.on('end', () => {
        resolveRequest({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })

    req.setTimeout(3000, () => req.destroy(new Error(`request timed out: ${options.path}`)))
    req.on('error', rejectRequest)

    if (options.chunks) {
      for (const chunk of options.chunks) req.write(chunk)
      req.end()
      return
    }
    req.end(options.body)
  })
}

function assertPayloadTooLarge(response, label) {
  assert.equal(response.status, 413, `${label} should return 413`)
  assert.equal(response.headers.connection, 'close', `${label} should close the connection`)
  assert.match(String(response.headers['content-type']), /^application\/json\b/, `${label} should return JSON`)
  assert.deepEqual(JSON.parse(response.body), { error: 'Request body too large' })
}
