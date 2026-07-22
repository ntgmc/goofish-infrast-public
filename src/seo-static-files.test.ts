import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectFile = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))

describe('static SEO files', () => {
  it('provides complete homepage metadata and structured data', async () => {
    const html = await readFile(projectFile('index.html'), 'utf8')

    expect(html).toContain('<meta name="description"')
    expect(html).toContain('<meta name="robots" content="index, follow"')
    expect(html).toContain('<link rel="canonical" href="https://maatool.com/"')
    expect(html).toContain('<meta property="og:title"')
    expect(html).toContain('<meta name="twitter:card" content="summary"')
    expect(html).toContain('<script type="application/ld+json">')
    expect(html).toContain('"@type": "WebApplication"')
  })

  it('publishes crawler directives and only indexable routes in the sitemap', async () => {
    const [robots, sitemap] = await Promise.all([
      readFile(projectFile('public/robots.txt'), 'utf8'),
      readFile(projectFile('public/sitemap.xml'), 'utf8'),
    ])

    expect(robots).toContain('Disallow: /api/')
    expect(robots).toContain('Disallow: /tool/')
    expect(robots).toContain('Sitemap: https://maatool.com/sitemap.xml')
    expect(sitemap).toContain('https://maatool.com/tools/depot-value')
    expect(sitemap).toContain('https://maatool.com/thanks')
    expect(sitemap).not.toContain('https://maatool.com/tool/')
    expect(sitemap).not.toContain('https://maatool.com/admin/')
  })
})
