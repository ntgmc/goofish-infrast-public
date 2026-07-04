interface DeferredFeature {
  title: string
  description: string
  status: string
  href?: string
}

const deferredFeatures: DeferredFeature[] = [
  {
    title: '排班表分析',
    description: '上传干员数据和已有排班 JSON，查看红脸风险、日产量和爆仓信息。',
    status: '已开放',
    href: '/tools/schedule-analysis',
  },
  {
    title: '账号同步',
    description: '登录后自动保存干员数据和排班记录。',
    status: '规划中',
  },
  {
    title: '邀请返现',
    description: '后续用于查看邀请链接和收益记录。',
    status: '未开放',
  },
  {
    title: '拼团购买',
    description: '后续用于创建或加入拼团订单。',
    status: '未开放',
  },
]

interface DeferredFeatureMenuProps {
  className?: string
}

export default function DeferredFeatureMenu({ className = '' }: DeferredFeatureMenuProps) {
  return (
    <details className={`group relative z-20 flex-shrink-0 ${className}`}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-surface-3 bg-surface-0 px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:border-surface-4 hover:bg-surface-2 hover:text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500/45 [&::-webkit-details-marker]:hidden">
        更多
        <svg
          className="h-4 w-4 transition-transform duration-150 group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-surface-3 bg-surface-1 shadow-[0_18px_44px_rgba(15,23,42,0.18)]">
        <div className="border-b border-surface-3 px-4 py-3">
          <p className="text-sm font-semibold text-ink-primary">工具与扩展</p>
          <p className="mt-1 text-xs text-ink-muted">已开放的小工具可直接使用。</p>
        </div>
        <div className="divide-y divide-surface-3/70">
          {deferredFeatures.map((feature) => {
            const content = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-ink-primary">{feature.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${feature.href ? 'bg-success/10 text-success' : 'bg-surface-2 text-ink-muted'}`}>
                    {feature.status}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">{feature.description}</p>
              </>
            )

            return feature.href ? (
              <a
                key={feature.title}
                href={feature.href}
                className="block px-4 py-3 transition-colors duration-150 hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/45"
              >
                {content}
              </a>
            ) : (
              <div key={feature.title} className="px-4 py-3">
                {content}
              </div>
            )
          })}
        </div>
      </div>
    </details>
  )
}
