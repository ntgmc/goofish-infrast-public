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
