import assert from 'node:assert/strict'
import test from 'node:test'
import { tableCell } from './product-catalog-lib.mjs'

test('escapes Markdown table control characters without interpreting inline code', () => {
  assert.equal(tableCell('A | B\\C\r\n`code`'), 'A \\| B\\\\C<br>`code`')
})
