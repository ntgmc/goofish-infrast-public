import { useLayoutEffect, useRef, type RefObject } from 'react'
import ReactMarkdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppReducedMotion } from '../../lib/motion-preference'

export default function ExplanationMarkdown({ children, revealed }: { children: string; revealed?: RefObject<number> }) {
  const body = useRef<HTMLDivElement>(null)
  const reducedMotion = useAppReducedMotion()
  useLayoutEffect(() => {
    if (!revealed) return
    if (reducedMotion) body.current?.getAnimations?.({ subtree: true }).forEach((animation) => animation.cancel())
    else {
      const fresh = Array.from(body.current?.querySelectorAll<HTMLElement>('[data-ink-offset]') ?? [])
        .filter((node) => Number(node.dataset.inkOffset) >= revealed.current).slice(-24)
      fresh.forEach((node, index) => node.animate?.([
        { filter: 'blur(4px)', opacity: 0 },
        { filter: 'blur(1px)', opacity: .72, offset: .5 },
        { filter: 'blur(0px)', opacity: 1 },
      ], { duration: 480, delay: Math.min(index * 18, 108), easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' }))
    }
    revealed.current = children.length
  }, [children, reducedMotion, revealed])
  return <div ref={body} className="v2-explanation-body" data-streaming={Boolean(revealed) || undefined}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[explanationText, { streaming: Boolean(revealed) && !reducedMotion }]]} skipHtml unwrapDisallowed
      allowedElements={['p', 'span', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'br']}
      components={{ a: ({ href, children }) => href && /^https?:\/\//i.test(href)
        ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : children }}>{children}</ReactMarkdown>
  </div>
}

type MarkdownElement = NonNullable<ExtraProps['node']>
type MarkdownContent = MarkdownElement['children'][number]

function explanationText({ streaming }: { streaming: boolean }) {
  function fragments(value: string, start: number): MarkdownContent[] {
    if (!streaming) return [{ type: 'text', value }]
    // Keep numbers and Latin words intact; punctuation stays with the preceding CJK pair.
    return Array.from(value.matchAll(/[A-Za-z0-9][A-Za-z0-9.,%:/_-]*|[\u3400-\u9fff]{1,2}[，。！？、；：”’）】》]*|[\s\S]/gu), (match): MarkdownContent =>
      /^\s+$/.test(match[0]) ? { type: 'text', value: match[0] } : {
        type: 'element', tagName: 'span', properties: { 'data-ink-offset': start + match.index },
        children: [{ type: 'text', value: match[0] }],
      })
  }
  return (tree: { children: MarkdownContent[] }) => {
    function visit(parent: { children: MarkdownContent[]; tagName?: string }) {
      if (parent.tagName && ['pre', 'code'].includes(parent.tagName)) return
      parent.children = parent.children.flatMap((node, index): MarkdownContent[] => {
        if (node.type === 'element') visit(node)
        if (node.type !== 'text' || node.position?.start.offset === undefined) return [node]
        const start = node.position.start.offset
        const tail = parent.tagName && ['p', 'li'].includes(parent.tagName) && index === parent.children.length - 1
          ? node.value.match(/[\u3400-\u9fff]{2,4}[。！？；…!?，,）】》”’]*$/u)?.[0] : undefined
        if (!tail) return fragments(node.value, start)
        const split = node.value.length - tail.length
        return [...fragments(node.value.slice(0, split), start), {
          type: 'element', tagName: 'span', properties: { className: ['v2-explanation-tail'] }, children: fragments(tail, start + split),
        }]
      })
    }
    visit(tree)
  }
}
