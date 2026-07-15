interface DeferredFeature {
  title: string
  description: string
  status: string
  href?: string
}

const deferredFeatures: DeferredFeature[] = [
  {
    title: '仓库价值分析器',
    description: '上传 MAA 仓库 JSON，生成“击败 X% 博士”的免费分享图。',
    status: '已开放',
    href: '/tools/depot-value',
  },
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
      <summary className="tool-secondary-action flex min-h-11 cursor-pointer list-none gap-2 px-3 text-sm [&::-webkit-details-marker]:hidden">
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
      <div className="tool-panel absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden shadow-[0_18px_44px_rgba(15,23,42,0.18)]">
        <div className="tool-panel-header px-4 py-3">
          <p className="text-sm font-semibold text-ink-primary">工具与扩展</p>
          <p className="mt-1 text-xs text-ink-muted">已开放的小工具可直接使用。</p>
        </div>
        <div className="divide-y divide-surface-3/70">
          {deferredFeatures.map((feature) => {
            const content = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-ink-primary">{feature.title}</p>
                  <span className={`tool-status ${feature.href ? 'tool-status--success' : ''}`}>
                    {feature.status}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">{feature.description}</p>
              </>
            )

            return feature.href ? (
              <Link
                key={feature.title}
                to={feature.href}
                className="block px-4 py-3 transition-colors duration-150 hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/45"
              >
                {content}
              </Link>
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
import { Link } from 'react-router-dom'
