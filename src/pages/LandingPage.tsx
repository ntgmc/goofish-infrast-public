import BrandLogo from '../components/BrandLogo'
import { Link } from 'react-router-dom'
import { ACTIVE_PURCHASE_CHANNEL } from '../lib/purchase'

interface Props {
  onStart: () => void
}

const resultMetrics = [
  { label: '预计总效率', value: '4169.00%', detail: '自动换班后保持高产出' },
  { label: '制造站产量', value: '117.0 件/日', detail: '赤金 85.6，作战记录 31.4' },
  { label: '预计日产出', value: '74,133 龙门币', detail: '赤金净变动 -47.0' },
  { label: '日产出等效理智', value: '337.1 理智/日', detail: '制造 191.1 + 贸易 266.9 - 消耗 120.9' },
]

const workflow = [
  {
    title: '添加账号并绑定森空岛',
    description: '用邮箱进入工作台，CDK 添加正式游戏账号，森空岛扫码后先确认游戏昵称和 UID。',
  },
  {
    title: '导入干员与养成库存',
    description: '森空岛读取干员和养成库存；无法扫码时，也可以使用凭据或 MAA 干员识别文件继续处理。',
  },
  {
    title: '生成排班与收益指标',
    description: '生成可导入 MAA 的 JSON，并展示日产出等效理智、练度建议和练度成本等效理智。',
  },
]

const assurances = [
  '森空岛账号确认后再导入',
  'CDK 管理正式游戏账号',
  '练度成本按库存与估价折算',
]

const fitPoints = [
  {
    title: '适合已有大量干员的账号',
    body: '森空岛导入后不用手动拆技能组合，工具会根据当前干员池和基建房间重新计算。',
  },
  {
    title: '适合想少手动上传的流程',
    body: '扫码或凭据导入可以同步干员与养成库存，MAA 文件路径继续作为无法扫码时的补充方式。',
  },
  {
    title: '适合同时看收益和练度成本',
    body: '结果直接面向 MAA 的自定义基建配置，同时用等效理智判断日产出和练度提升成本。',
  },
]

export default function LandingPage({ onStart }: Props) {
  const purchaseHref = ACTIVE_PURCHASE_CHANNEL?.href

  return (
    <main className="landing-shell min-h-screen overflow-hidden bg-surface-0 text-white" tabIndex={-1} data-route-focus>
      <section className="mx-auto grid min-h-screen w-full max-w-7xl items-center gap-12 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[0.86fr_1.14fr] lg:px-10 lg:pb-20 lg:pt-8">
        <div className="relative z-10 min-w-0">
          <nav className="landing-hero-enter mb-12 flex items-center justify-between gap-4">
            <Link to="/" className="flex min-h-11 items-center gap-3 rounded-lg pr-3 text-left">
              <BrandLogo size="md" />
              <span>
                <span className="block text-sm font-semibold text-white">MAA 基建排班优化器</span>
                <span className="block text-xs text-brand-100/64">森空岛，等效理智，MAA JSON</span>
              </span>
            </Link>
            <Link
              to="/announcements"
              className="hidden min-h-11 items-center rounded-lg border border-white/12 px-4 text-sm font-medium text-white/74 transition duration-150 hover:border-brand-200/40 hover:bg-white/[0.05] hover:text-white sm:inline-flex"
            >
              查看公告
            </Link>
          </nav>

          <div className="max-w-2xl">
            <p className="landing-hero-enter landing-enter-delay-1 mb-5 inline-flex items-center gap-2 rounded-lg border border-brand-200/24 bg-brand-200/[0.08] px-3 py-2 text-sm font-medium text-brand-100">
              <span className="h-2 w-2 rounded-full bg-brand-300" aria-hidden="true" />
              森空岛导入 + MAA 排班的短时结果型工具
            </p>
            <h1 className="landing-hero-enter landing-enter-delay-2 max-w-2xl text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-5xl lg:text-6xl">
              绑定森空岛，按当前干员池生成 MAA 基建排班
            </h1>
            <p className="landing-hero-enter landing-enter-delay-3 mt-6 max-w-xl text-lg leading-8 text-brand-50/74">
              在工作台里添加 CDK 游戏账号，用森空岛扫码导入干员与养成库存，也保留 MAA 干员识别文件路径。确认基建配置后即可生成可导入 MAA 的排班 JSON，并查看日产出等效理智和练度提升建议。
            </p>

            <div className="landing-hero-enter landing-enter-delay-4 mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/tools/depot-value"
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-white px-5 py-3 text-sm font-semibold text-brand-950 transition duration-150 hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-surface-0"
              >
                免费仓库估值
              </Link>
              <button
                type="button"
                onClick={onStart}
                className="landing-cta inline-flex min-h-12 cursor-pointer items-center justify-center rounded-lg bg-brand-300 px-5 py-3 text-sm font-semibold text-brand-950 transition duration-150 hover:bg-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:ring-offset-2 focus:ring-offset-surface-0 active:scale-[0.99]"
              >
                进入工作台
              </button>
              {purchaseHref && (
                <a
                  href={purchaseHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/14 px-5 py-3 text-sm font-semibold text-white/82 transition duration-150 hover:border-brand-200/42 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-100 focus:ring-offset-2 focus:ring-offset-surface-0"
                >
                  购买 CDK
                </a>
              )}
            </div>

            <dl className="mt-10 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
              <HeroFact value="森空岛导入" label="干员与库存来源" className="landing-enter-delay-5" />
              <HeroFact value="等效理智" label="日产出口径" className="landing-enter-delay-6" />
              <HeroFact value="练度提升" label="成本也可折算" className="landing-enter-delay-7" />
            </dl>
          </div>
        </div>

        <div className="landing-hero-enter landing-enter-delay-5 relative z-10 min-w-0">
          <ProductPreview onStart={onStart} />
        </div>
      </section>

      <section id="workflow" className="border-y border-white/8 bg-white/[0.035] px-5 py-16 sm:px-8 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.72fr_1fr]">
          <div>
            <p className="text-sm font-semibold text-brand-100">流程</p>
            <h2 className="mt-3 max-w-lg text-3xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
              从森空岛到 MAA，只保留完成任务需要的路径。
            </h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-brand-50/68">
              登录后添加 CDK 游戏账号，绑定或导入森空岛数据，确认基建配置后回到可导入 MAA 的排班结果和练度建议。
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {workflow.map((item, index) => (
              <StepItem key={item.title} index={index + 1} title={item.title} description={item.description} />
            ))}
          </div>
        </div>
      </section>

      <section id="preview" className="px-5 py-16 sm:px-8 lg:px-10 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <figure className="landing-image-frame relative order-2 overflow-hidden rounded-xl bg-surface-1 lg:order-1">
            <picture>
              <source srcSet="/assets/previews/optimize-result-dark.png" media="(prefers-color-scheme: dark)" />
              <img
                src="/assets/previews/optimize-result-light.png"
                alt="排班方案结果页，展示下载排班 JSON、等效理智、效率指标和练度成本"
                className="block aspect-[16/10] w-full object-cover object-top"
                loading="lazy"
              />
            </picture>
            <figcaption className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-lg border border-brand-200/24 bg-surface-0/90 px-3 py-2 shadow-2xl shadow-black/30 backdrop-blur sm:bottom-4 sm:left-4 sm:right-auto sm:w-[min(22rem,calc(100%-2rem))]">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-brand-100">练度建议 · 示例 1,840 理智</span>
                <span className="text-brand-50/64">实际以生成页为准</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-brand-50/64">
                森空岛库存 + 一图流估价折算
              </p>
            </figcaption>
          </figure>
          <div className="order-1 lg:order-2">
            <p className="text-sm font-semibold text-brand-100">结果预览</p>
            <h2 className="mt-3 max-w-xl text-3xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
              生成结果不只是一份 JSON，还包括等效理智和练度成本。
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-brand-50/68">
              结果页直接给出可导入 MAA 的排班 JSON、日产出等效理智、关键效率数据和练度建议。绑定森空岛后，练度成本也会按库存与估价折算成等效理智。
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {resultMetrics.map((metric) => (
                <MetricTile key={metric.label} {...metric} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 pb-16 sm:px-8 lg:px-10 lg:pb-20">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
          {fitPoints.map((point) => (
            <article key={point.title} className="rounded-xl border border-white/10 bg-white/[0.045] p-6">
              <h3 className="text-lg font-semibold text-white">{point.title}</h3>
              <p className="mt-3 text-sm leading-6 text-brand-50/64">{point.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-8 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-8 rounded-xl border border-brand-200/18 bg-brand-200/[0.08] p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.02em] text-white sm:text-3xl">
              有账号或 CDK 后，进入工作台开始。
            </h2>
            <ul className="mt-5 grid gap-3 text-sm leading-6 text-brand-50/72 sm:grid-cols-3">
              {assurances.map((item) => (
                <li key={item} className="flex gap-3">
                  <CheckIcon />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={onStart}
            className="landing-cta inline-flex min-h-12 cursor-pointer items-center justify-center rounded-lg bg-white px-5 py-3 text-sm font-semibold text-brand-950 transition duration-150 hover:bg-brand-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#0b2428] active:scale-[0.99]"
          >
            打开工作台
          </button>
        </div>
      </section>
    </main>
  )
}

function ProductPreview({ onStart }: { onStart: () => void }) {
  return (
    <div className="landing-preview-frame relative max-w-full overflow-hidden rounded-xl bg-surface-1">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-error/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </div>
        <span className="landing-ready-pill inline-flex min-h-7 items-center justify-center overflow-hidden rounded-md px-2.5 py-1 text-xs font-medium">
          <span className="sr-only">演示状态：可下载</span>
          <span className="landing-ready-pending" aria-hidden="true">生成中</span>
          <span className="landing-ready-done" aria-hidden="true">可下载</span>
        </span>
      </div>

      <div className="grid gap-5 p-4 sm:p-5">
        <figure className="landing-preview-slot relative overflow-hidden rounded-lg border border-white/10 bg-surface-0">
          <picture>
            <source srcSet="/assets/previews/upload-entry-dark.png" media="(prefers-color-scheme: dark)" />
            <img
              src="/assets/previews/upload-entry-light.png"
              alt="工作台页面，包含登录注册、CDK 兑换、森空岛导入、干员数据上传和基建配置入口"
              className="block aspect-[16/9] w-full object-cover object-top"
            />
          </picture>
        </figure>

        <div className="grid gap-3 sm:grid-cols-[1fr_0.82fr]">
          <div className="landing-generate-card rounded-lg bg-white/[0.045] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-white">生成进度</span>
              <span className="landing-result-reveal text-xs font-medium text-success">已完成</span>
            </div>
            <div className="mt-4 space-y-3">
              <ProgressLine label="确认森空岛账号" width="100%" delayClass="landing-flow-delay-1" />
              <ProgressLine label="导入干员与养成库存" width="92%" delayClass="landing-flow-delay-2" />
              <ProgressLine label="生成排班与练度建议" width="78%" delayClass="landing-flow-delay-3" />
            </div>
          </div>

          <div className="landing-download-card rounded-lg bg-warning p-4 text-brand-950">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">下一步</p>
              <span className="landing-download-icon flex h-8 w-8 items-center justify-center rounded-lg bg-brand-950/10" aria-hidden="true">
                <DownloadIcon />
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-brand-950">
              查看等效理智与练度成本后，下载排班 JSON，在 MAA 的自定义基建配置里选择该文件。
            </p>
            <button
              type="button"
              onClick={onStart}
              className="mt-4 inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg bg-surface-0 px-4 text-sm font-semibold text-white transition duration-150 hover:bg-brand-900 focus:outline-none focus:ring-2 focus:ring-brand-950 focus:ring-offset-2 focus:ring-offset-warning"
            >
              进入工作台
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HeroFact({ value, label, className }: { value: string; label: string; className: string }) {
  return (
    <div className={`landing-hero-enter rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3 ${className}`}>
      <dt className="text-lg font-semibold text-white">{value}</dt>
      <dd className="mt-1 text-xs leading-5 text-brand-50/58">{label}</dd>
    </div>
  )
}

function StepItem({ index, title, description }: { index: number; title: string; description: string }) {
  return (
    <article className="relative rounded-xl border border-white/10 bg-surface-1 p-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-300 text-sm font-semibold text-brand-950">
        {index}
      </span>
      <h3 className="mt-5 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-brand-50/64">{description}</p>
    </article>
  )
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
      <p className="text-sm text-brand-50/58">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-brand-50/52">{detail}</p>
    </div>
  )
}

function ProgressLine({ label, width, delayClass }: { label: string; width: string; delayClass: string }) {
  return (
    <div className={`landing-flow-row rounded-md bg-white/[0.035] px-2 py-2 ${delayClass}`}>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-brand-50/62">
        <span className="inline-flex items-center gap-2">
          <span className="landing-flow-dot h-1.5 w-1.5 rounded-full bg-brand-300" aria-hidden="true" />
          {label}
        </span>
        <span>{width}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <span className="landing-progress-fill block h-full rounded-full bg-brand-300" style={{ width }} />
      </div>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 3.75v8.1m0 0 3.15-3.15M10 11.85 6.85 8.7M4.5 14.75h11"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="mt-1 h-4 w-4 flex-none text-brand-200" fill="none" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.75 10.35 8.35 13.8l6.9-7.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}
