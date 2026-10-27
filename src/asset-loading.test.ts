// @vitest-environment node
import { build } from 'vite'
import { expect, it } from 'vitest'

it('keeps lazy page catalogs and admin styles out of the entry dependencies', async () => {
  const result = await build({
    logLevel: 'silent',
    build: { write: false, reportCompressedSize: false },
  })
  if (Array.isArray(result) || !('output' in result)) throw new Error('Expected a single frontend build')
  const chunks = result.output.filter((output) => output.type === 'chunk')
  const entry = chunks.find((chunk) => chunk.isEntry)
  expect(entry).toBeDefined()
  const eager = new Set<string>()
  function visit(filename: string) {
    if (eager.has(filename)) return
    eager.add(filename)
    const chunk = chunks.find((candidate) => candidate.fileName === filename)
    for (const dependency of chunk?.imports ?? []) visit(dependency)
  }
  visit(entry!.fileName)
  const modules = chunks.filter((chunk) => eager.has(chunk.fileName))
    .flatMap((chunk) => Object.entries(chunk.modules)
      .filter(([, module]) => module.renderedLength > 0).map(([id]) => id.replace(/\\/g, '/')))
  for (const domain of ['admin', 'auth', 'dashboard', 'workspace', 'optimize', 'tools', 'inventory', 'balance', 'metered', 'status', 'v2', 'training-ratio', 'cultivation-projects']) {
    expect(modules.some((id) => id.endsWith(`/copy/zh-CN/${domain}.ts`)), domain).toBe(false)
  }
  expect(chunks.some((chunk) => !eager.has(chunk.fileName)
    && Object.keys(chunk.modules).some((id) => id.endsWith('/copy/zh-CN/optimize.ts')))).toBe(true)

  const html = result.output.find((output) => output.type === 'asset' && output.fileName === 'index.html')
  if (html?.type !== 'asset' || typeof html.source !== 'string') throw new Error('Expected an HTML entry')
  const entryStyles = [...html.source.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)]
    .map((match) => match[1].replace(/^\//, ''))
  expect(entryStyles.length).toBeGreaterThan(0)
  const adminStyles = result.output.filter((output) => output.type === 'asset'
    && output.fileName.endsWith('.css') && String(output.source).includes('.admin-sidebar'))
  expect(adminStyles).toHaveLength(1)
  expect(entryStyles).not.toContain(adminStyles[0].fileName)
}, 30_000)
