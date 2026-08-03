import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileIfChanged } from './atomic-write.mjs'
import { renderPrice, validateCatalog } from './product-catalog-lib.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const catalogPath = resolve(root, 'product/catalog.json')
const pricePath = resolve(root, 'PRICE.md')
const checkOnly = process.argv.includes('--check')
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))

validateCatalog(catalog)
const generated = renderPrice(catalog)
if (checkOnly) {
  const current = await readFile(pricePath, 'utf8')
  if (normalize(current) !== normalize(generated)) {
    throw new Error('PRICE.md 与 product/catalog.json 不一致，请运行 npm run generate:catalog。')
  }
  console.log('product catalog checks ok')
} else {
  await writeFileIfChanged(pricePath, generated)
  const published = await readFile(pricePath, 'utf8')
  if (normalize(published) !== normalize(generated)) throw new Error('PRICE.md 原子写入后校验失败。')
  console.log('PRICE.md generated from product/catalog.json')
}

function normalize(value) {
  return value.replace(/\r\n/g, '\n').trimEnd()
}
