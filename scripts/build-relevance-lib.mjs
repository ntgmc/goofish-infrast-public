const documentationExtensions = ['.md', '.mdx', '.rst', '.adoc']
const documentationBasename = /^(readme|changelog|contributing|license)(\.[^/]+)?$/i
const buildRelevantDocumentation = new Set([
  'docs/dev-deploy.md',
  'docs/production-deploy.md',
  'docs/worker-deploy.md',
])

export function isDocumentationFile(file) {
  const normalized = file.trim().replace(/\\/g, '/')
  if (!normalized) return false

  const lower = normalized.toLowerCase()
  if (buildRelevantDocumentation.has(lower)) return false
  if (lower.startsWith('docs/')) return true
  if (documentationExtensions.some((extension) => lower.endsWith(extension))) return true

  const basename = normalized.split('/').at(-1)
  return documentationBasename.test(basename)
}

export function isDocumentationOnly(files) {
  return files.length > 0 && files.every(isDocumentationFile)
}
