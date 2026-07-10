import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getRequestBodyLimitBytes, RequestBodyTooLargeError } from './request-body-limits'
import { INTERNAL_CLIENT_IP_HEADER, resolveIncomingClientIp } from './security/client-ip'

export async function nodeRequestToWebRequest(req: IncomingMessage): Promise<Request> {
  const host = firstHeaderValue(req.headers.host) || '127.0.0.1'
  const protocol = firstHeaderValue(req.headers['x-forwarded-proto']) || 'http'
  const url = req.url?.startsWith('http') ? req.url : `${protocol}://${host}${req.url || '/'}`
  const headers = new Headers()

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else if (value !== undefined) {
      headers.set(key, value)
    }
  }
  headers.set(INTERNAL_CLIENT_IP_HEADER, resolveIncomingClientIp(req))

  const method = req.method || 'GET'
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') {
    const bodyLimitBytes = getRequestBodyLimitBytes(new URL(url).pathname)
    init.body = new Uint8Array(await readRequestBody(req, bodyLimitBytes))
  }

  return new Request(url, init)
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

  const body = Buffer.from(await response.arrayBuffer())
  res.end(body)
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
