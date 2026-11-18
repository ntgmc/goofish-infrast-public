export async function* readServerSentEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let data: string[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      while (true) {
        const end = buffer.search(/[\r\n]/)
        if (end < 0) break
        // A CRLF separator can itself be split across network chunks.
        if (!done && buffer[end] === '\r' && end === buffer.length - 1) break
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + (buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1))
        size += line.length
        if (size > 65536) throw new Error('event_too_large')
        if (line === '') {
          if (data.length) yield data.join('\n')
          data = []; size = 0
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (size + buffer.length > 65536) throw new Error('event_too_large')
      if (done) break
    }
    // An event without its terminating blank line is incomplete and is not dispatched.
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
