import { closeSync, openSync, readSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

// Split only the snapshot envelope and homework array; JSON.parse validates each retained value.
export function* readSnapshotEntries(path: string, homeworks: boolean): Generator<[string, unknown]> {
  const file = openSync(path, 'r')
  const bytes = Buffer.allocUnsafe(64 * 1024), decoder = new StringDecoder('utf8')
  let buffer = '', position = 0, ended = false
  const strings = /["\\]/g, structures = /["{}[\]]/g, delimiters = /[ \t\r\n,}\]]/g
  const invalid = () => new SyntaxError('Invalid PRTS snapshot JSON')
  function peek(): string {
    while (position === buffer.length && !ended) {
      const count = readSync(file, bytes)
      buffer = count ? decoder.write(bytes.subarray(0, count)) : decoder.end()
      position = 0
      ended = count === 0
    }
    return buffer[position] ?? ''
  }
  function space() { while (peek() && /[ \t\r\n]/.test(peek())) position++ }
  function expect(value: string) {
    space()
    if (peek() !== value) throw invalid()
    position++
  }
  function value(retain = true): string {
    space()
    const first = peek(), compound = first === '{' || first === '[', quoted = first === '"'
    if (!first) throw invalid()
    const parts: string[] = []
    let start = position, depth = 0, string = false, escaped = false
    while (true) {
      if (position === buffer.length) {
        if (retain) parts.push(buffer.slice(start))
        if (!peek()) { start = position; break }
        start = position
      }
      if (escaped) { position++; escaped = false; continue }
      const tokens = string ? strings : compound || quoted ? structures : delimiters
      tokens.lastIndex = position
      const match = tokens.exec(buffer)
      if (!match) { position = buffer.length; continue }
      position = match.index
      if (!compound && !quoted) break
      position++
      const char = match[0]
      if (string) {
        if (char === '\\') escaped = true
        else { string = false; if (quoted && !compound) break }
      } else if (char === '"') string = true
      else if (char === '{' || char === '[') depth++
      else if (--depth === 0) break
    }
    if (string || depth) throw invalid()
    if (!retain) return ''
    parts.push(buffer.slice(start, position))
    return parts.join('')
  }
  try {
    expect('{')
    const keys = new Set<string>()
    space()
    if (peek() !== '}') while (true) {
      const key: unknown = JSON.parse(value())
      if (typeof key !== 'string' || keys.has(key)) throw invalid()
      keys.add(key)
      expect(':')
      if (key !== 'homeworks') yield [key, JSON.parse(value())]
      else if (!homeworks) {
        space()
        if (peek() !== '[') throw invalid()
        value(false)
        yield [key, []]
      } else {
        expect('[')
        const batch: string[] = []
        space()
        if (peek() !== ']') while (true) {
          batch.push(value())
          if (batch.length === 256) { yield [key, JSON.parse(`[${batch.join(',')}]`)]; batch.length = 0 }
          space()
          if (peek() === ']') break
          expect(',')
        }
        if (batch.length) yield [key, JSON.parse(`[${batch.join(',')}]`)]
        expect(']')
      }
      space()
      if (peek() === '}') break
      expect(',')
    }
    expect('}')
    space()
    if (peek() || !keys.has('homeworks')) throw invalid()
  } finally { closeSync(file) }
}
