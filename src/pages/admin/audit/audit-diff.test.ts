import { expect, it } from 'vitest'
import { auditChanges } from './audit-diff'

it('finds nested changes, additions and removals without treating object key order as a change', () => {
  expect(auditChanges({ status: 'active', limits: { count: 2 }, removed: true, ordered: { a: 1, b: 2 } }, { status: 'frozen', limits: { count: 0 }, added: null, ordered: { b: 2, a: 1 } })).toEqual([
    { path: '$["added"]', before: undefined, after: null },
    { path: '$["limits"]["count"]', before: 2, after: 0 },
    { path: '$["removed"]', before: true, after: undefined },
    { path: '$["status"]', before: 'active', after: 'frozen' },
  ])
})

it('compares arrays structurally and distinguishes absent, null and false values', () => {
  expect(auditChanges({ a: [{ x: 1, y: 2 }] }, { a: [{ y: 2, x: 1 }] })).toEqual([])
  expect(auditChanges({ list: [1, 2], flag: false }, { list: [2, 1], flag: null })).toEqual([
    { path: '$["flag"]', before: false, after: null },
    { path: '$["list"]', before: [1, 2], after: [2, 1] },
  ])
  expect(auditChanges(null, null)).toEqual([])
  expect(auditChanges(null, { created: true })).toEqual([{ path: '$', before: null, after: { created: true } }])
  expect(auditChanges({ 'a.b': 1, a: { b: 1 } }, { 'a.b': 2, a: { b: 2 } }).map((change) => change.path)).toEqual(['$["a"]["b"]', '$["a.b"]'])
})
