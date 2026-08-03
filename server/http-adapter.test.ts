import { createServer, get as httpGet, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nodeRequestToWebRequest, writeWebResponse } from './http-adapter'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
})

describe('Node HTTP adapter', () => {
  it('streams a Web response without materializing the full array buffer', async () => {
    let arrayBufferSpy: ReturnType<typeof vi.spyOn> | null = null
    const server = createServer(async (_request, response) => {
      const webResponse = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('first-'))
          controller.enqueue(new TextEncoder().encode('second'))
          controller.close()
        },
      }), { headers: { 'Content-Type': 'text/plain' } })
      arrayBufferSpy = vi.spyOn(webResponse, 'arrayBuffer')
      await writeWebResponse(response, webResponse)
    })
    servers.push(server)
    const port = await listen(server)

    const response = await fetch(`http://127.0.0.1:${port}/stream`)

    await expect(response.text()).resolves.toBe('first-second')
    expect(arrayBufferSpy).not.toBeNull()
    expect(arrayBufferSpy).not.toHaveBeenCalled()
  })

  it('aborts the Web request when the client connection closes', async () => {
    let resolveCreated!: () => void
    const created = new Promise<void>((resolve) => { resolveCreated = resolve })
    let resolveAborted!: () => void
    const aborted = new Promise<void>((resolve) => { resolveAborted = resolve })
    const server = createServer(async (request) => {
      const webRequest = await nodeRequestToWebRequest(request, 0)
      webRequest.signal.addEventListener('abort', () => resolveAborted(), { once: true })
      resolveCreated()
    })
    servers.push(server)
    const port = await listen(server)
    const request = httpGet(`http://127.0.0.1:${port}/abort`)
    request.on('error', () => undefined)
    await created

    request.destroy()

    await expect(aborted).resolves.toBeUndefined()
  })
})

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Expected an IP listener'))
      resolve(address.port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.()
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}
