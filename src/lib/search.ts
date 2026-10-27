import PinyinMatch from 'pinyin-match'

export function matchesSearch(text: string, query: string): boolean {
  const source = text.toLowerCase()
  return query.trim().toLowerCase().split(/\s+/).every((term) => {
    if (!term || source.includes(term) || PinyinMatch.match(text, term)) return true
    const parts = term.match(/[a-zü]+|[^a-zü]+/g) ?? []
    if (parts.length < 2) return false
    let offset = 0
    return parts.every((part) => {
      const match = PinyinMatch.match(text.slice(offset), part)
      if (!match) return false
      offset += match[1] + 1
      return true
    })
  })
}

export function filterSearch<T>(items: T[], query: string, getText: (item: T) => string): T[] {
  let candidates = items.map((item) => {
    const text = getText(item)
    return { item, text, source: text.toLowerCase() }
  })
  for (const term of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const direct = candidates.map(({ text, source }) => source.includes(term) || Boolean(PinyinMatch.match(text, term)))
    const parts = term.match(/[a-zü]+|[^a-zü]+/g) ?? []
    const offsets: number[] = candidates.map((_, index) => direct[index] || parts.length < 2 ? -1 : 0)
    // pinyin-match only caches the last query; batch each part to avoid repeatedly rebuilding its syllable combinations.
    for (const part of parts.length < 2 ? [] : parts) {
      offsets.forEach((offset, index) => {
        if (offset < 0) return
        const match = PinyinMatch.match(candidates[index].text.slice(offset), part)
        offsets[index] = match ? offset + match[1] + 1 : -1
      })
    }
    candidates = candidates.filter((_, index) => direct[index] || offsets[index] >= 0)
  }
  return candidates.map(({ item }) => item)
}
