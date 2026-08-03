import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { RequestBodyTooLargeError } from './request-body-limits'
import { INTERNAL_CLIENT_IP_HEADER, isTrustedProxyAddress, resolveIncomingClientIp } from './security/client-ip'
import { storeRawRequestBody } from './security/request-validation'

const requestResourceCleanups = new WeakMap<Request, () => void>()

export async function nodeRequestToWebRequest(req: IncomingMessage, bodyLimitBytes: number): Promise<Request> {
  const abortResources = createIncomingRequestAbortController(req)
  try {
    const host = firstHeaderValue(req.headers.host) || '127.0.0.1'
    const protocol = resolveIncomingProtocol(req)
    const url = `${protocol}://${host}${req.url || '/'}`
    const headers = new Headers()

    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item)
      } else if (value !== undefined) {
        headers.set(key, value)
      }
    }
    headers.delete(INTERNAL_CLIENT_IP_HEADER)
    headers.set(INTERNAL_CLIENT_IP_HEADER, resolveIncomingClientIp(req))

    const method = req.method || 'GET'
    const init: RequestInit = { method, headers, signal: abortResources.controller.signal }
    let bodyBytes: Uint8Array | null = null
    if (method !== 'GET' && method !== 'HEAD') {
      if (bodyLimitBytes > 0) {
        bodyBytes = new Uint8Array(await readRequestBody(req, bodyLimitBytes))
        init.body = bodyBytes
      }
    }

    const request = new Request(url, init)
    requestResourceCleanups.set(request, abortResources.cleanup)
    if (bodyBytes) storeRawRequestBody(request, bodyBytes)
    return request
  } catch (error) {
    abortResources.cleanup()
    throw error
  }
}

export function releaseWebRequestResources(request: Request): void {
  requestResourceCleanups.get(request)?.()
  requestResourceCleanups.delete(request)
}

function createIncomingRequestAbortController(req: IncomingMessage): {
  controller: AbortController
  cleanup: () => void
} {
  const controller = new AbortController()
  function cleanup() {
    req.off('aborted', abort)
    req.socket.off('close', abort)
  }
  function abort() {
    cleanup()
    if (!controller.signal.aborted) controller.abort(new Error('Client connection closed'))
  }
  req.once('aborted', abort)
  req.socket.once('close', abort)
  return { controller, cleanup }
}

function resolveIncomingProtocol(req: IncomingMessage): 'http' | 'https' {
  if (Boolean((req.socket as { encrypted?: boolean }).encrypted)) return 'https'
  if (!isTrustedProxyAddress(req.socket.remoteAddress)) return 'http'
  const forwarded = firstHeaderValue(req.headers['x-forwarded-proto'])
  return forwarded?.split(',', 1)[0]?.trim().toLowerCase() === 'https' ? 'https' : 'http'
}

export async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  res.statusMessage = response.statusText
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  if (!response.body) {
    res.end()
    return
  }

  const reader = response.body.getReader()
  let closed = false
  const onClose = () => {
    closed = true
    void reader.cancel('Client connection closed').catch(() => undefined)
  }
  res.once('close', onClose)
  try {
    while (!closed) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (!res.write(chunk.value) && !await waitForDrain(res)) {
        closed = true
        break
      }
    }
    if (!closed && !res.writableEnded) res.end()
  } catch (error) {
    if (!closed && !res.destroyed) res.destroy(error instanceof Error ? error : new Error('Response stream failed'))
    if (!closed) throw error
  } finally {
    res.off('close', onClose)
    if (closed) await reader.cancel('Client connection closed').catch(() => undefined)
  }
}

function waitForDrain(res: ServerResponse): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain)
      res.off('close', onClose)
      res.off('error', onError)
    }
    const onDrain = () => {
      cleanup()
      resolve(true)
    }
    const onClose = () => {
      cleanup()
      resolve(false)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    res.once('drain', onDrain)
    res.once('close', onClose)
    res.once('error', onError)
  })
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function readRequestBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const contentLength = parseContentLength(firstHeaderValue(req.headers['content-length']))
  if (contentLength !== null && contentLength > limitBytes) {
    req.pause()
    return Promise.reject(new RequestBodyTooLargeError(limitBytes))
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let settled = false

    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onAborted)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (buffer.length > limitBytes - totalBytes) {
        req.pause()
        fail(new RequestBodyTooLargeError(limitBytes))
        return
      }
      chunks.push(buffer)
      totalBytes += buffer.length
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks, totalBytes))
    }
    const onError = (error: Error) => fail(error)
    const onAborted = () => fail(new Error('Request aborted'))

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAborted)
  })
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY
}
