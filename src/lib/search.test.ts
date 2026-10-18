import { describe, expect, it } from 'vitest'
import { matchesSearch } from './search'

describe('shared search matching', () => {
  it.each([
    ['六星干员调用凭证', '调用', true],
    ['六星干员调用凭证', 'liuxing', true],
    ['六星干员调用凭证', 'GYDYPZ', true],
    ['六星干员调用凭证 可选银灰', '  lx  yh ', true],
    ['能天使', 'nengtianshi', true],
    ['能天使', 'nts', true],
    ['阿米娅', 'AMiY', true],
    ['重庆', 'chongqing', true],
    ['绿野', 'lv', true],
    ['PRTS 作业 main_1001', 'prts 作业 main_1001', true],
    ['干员4', 'ganyuan4', true],
    ['干员5', 'GY5', true],
    ['六星干员调用凭证·2026', 'liuxing2026', true],
    ['干员5', '5gy', false],
    ['库存\n升级', 'kucun 升级', true],
    ['任意文字', '   ', true],
    ['六星干员调用凭证', 'lx 不存在', false],
    ['doc@example.test ID_123', 'example.test id_123', true],
    ['普通档案', '%', false],
    ['普通档案', '_', false],
    ['普通档案', '\\', false],
    ['100% 完成_备份', '% _', true],
  ])('matches %j against %j: %s', (text, query, expected) => {
    expect(matchesSearch(text, query)).toBe(expected)
  })
})
