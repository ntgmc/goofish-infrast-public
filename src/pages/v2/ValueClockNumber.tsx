import { useLayoutEffect, useRef, type CSSProperties } from 'react'

export default function ValueClockNumber({ value, animated = true }: { value: number | undefined; animated?: boolean }) {
  if (value === undefined) return <>—</>
  const [integer, fraction] = value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split('.')
  return <span className="value-clock-number"><span className="value-clock-number-integer">{animated ? Array.from(integer, (character, index) => /\d/.test(character)
    ? <Digit key={index} character={character} index={index} /> : <span key={index}>{character}</span>) : integer}</span><span className="value-clock-number-fraction">.{fraction}</span></span>
}

function Digit({ character, index }: { character: string; index: number }) {
  const glyph = useRef<HTMLSpanElement>(null)
  const previous = useRef(character)
  useLayoutEffect(() => {
    if (previous.current === character) return
    previous.current = character
    const animation = glyph.current?.animate?.([
      { opacity: .7, transform: 'translateY(.03em)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 220, easing: 'cubic-bezier(.2, 0, .2, 1)' })
    return () => animation?.cancel()
  }, [character])
  return <span className="value-clock-digit" style={{ '--value-clock-digit-index': index } as CSSProperties}><span ref={glyph} className="value-clock-digit-glyph">{character}</span></span>
}
