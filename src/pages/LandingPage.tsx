import { ACTIVE_PURCHASE_CHANNEL } from '../lib/purchase'

interface Props {
  onStart: () => void
}

const resultMetrics = [
  { label: '预计总效率', value: '4169.00%', detail: '自动换班后保持高产出' },
  { label: '制造站产量', value: '117.0 件/日', detail: '赤金 85.6，作战记录 31.4' },
  { label: '预计日产出', value: '74,133 龙门币', detail: '赤金净变动 -47.0' },
  { label: '无人机加速', value: '420.8 架', detail: '折合 1,262 分钟' },
]

const workflow = [
  {
    title: '登录并添加游戏账号',
    description: '用邮箱进入工作台，注册时可填写 CDK，也可以登录后在“兑换 CDK”里添加多个游戏账号。',
  },
  {
    title: '上传干员并确认配置',
    description: '上传 MAA 导出的干员识别文件，选择 243、333 等预设或按套餐权限调整基建参数。',
  },
  {
    title: '生成并下载排班',
    description: '保存工作区后生成排班 JSON，同时查看效率指标和精英化提升建议。',
  },
]

const assurances = [
  '邮箱账号用于管理多个游戏账号',
  'CDK 用于添加正式游戏账号',
  '干员数据来自 MAA 导出的识别文件',
]

const fitPoints = [
  {
    title: '适合已有大量干员的账号',
    body: '不用手动拆技能组合，工具会根据当前干员池和基建房间重新计算。',
  },
  {
    title: '适合想集中管理账号的流程',
    body: '工作台围绕账号、干员数据、基建配置和排班结果组织，后续更新不用重新梳理入口。',
  },
  {
    title: '适合 MAA 的后续导入',
    body: '结果直接面向 MAA 的自定义基建配置，减少在游戏外来回抄配置。',
  },
]

export default function LandingPage({ onStart }: Props) {
  const purchaseHref = ACTIVE_PURCHASE_CHANNEL?.href

  return (
    <main className="landing-shell min-h-screen overflow-hidden bg-surface-0 text-white">
      <section className="mx-auto grid min-h-screen w-full max-w-7xl items-center gap-12 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[0.86fr_1.14fr] lg:px-10 lg:pb-20 lg:pt-8">
        <div className="relative z-10 min-w-0">
          <nav className="mb-12 flex items-center justify-between gap-4">
            <a href="/" className="flex min-h-11 items-center gap-3 rounded-lg pr-3 text-left">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-300 text-brand-950">
                <FileIcon />
              </span>
              <span>
                <span className="block text-sm font-semibold text-white">MAA 基建排班优化器</span>
              <span className="block text-xs text-brand-100/64">账号，CDK，生成排班</span>
              </span>
            </a>
            <a
              href="/announcements"
              className="hidden min-h-11 items-center rounded-lg border border-white/12 px-4 text-sm font-medium text-white/74 transition duration-150 hover:border-brand-200/40 hover:bg-white/[0.05] hover:text-white sm:inline-flex"
            >
              查看公告
            </a>
          </nav>

          <div className="max-w-2xl">
            <p className="mb-5 inline-flex items-center gap-2 rounded-lg border border-brand-200/24 bg-brand-200/[0.08] px-3 py-2 text-sm font-medium text-brand-100">
              <span className="h-2 w-2 rounded-full bg-brand-300" aria-hidden="true" />
              为明日方舟玩家准备的短时结果型工具
            </p>
            <h1 className="max-w-2xl text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-5xl lg:text-6xl">
              登录账号，按当前干员池生成 MAA 基建排班
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-brand-50/74">
              在工作台里添加 CDK 游戏账号，上传 MAA 导出的干员识别文件，确认基建配置后即可生成可导入 MAA 的排班 JSON，并查看练度提升建议。
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
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
              <HeroFact value="账号工作台" label="统一管理入口" />
              <HeroFact value="CDK" label="添加游戏账号" />
              <HeroFact value="MAA JSON" label="导入目标" />
            </dl>
          </div>
        </div>

        <div className="relative z-10 min-w-0">
          <ProductPreview onStart={onStart} />
        </div>
      </section>

      <section id="workflow" className="border-y border-white/8 bg-white/[0.035] px-5 py-16 sm:px-8 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.72fr_1fr]">
          <div>
            <p className="text-sm font-semibold text-brand-100">流程</p>
            <h2 className="mt-3 max-w-lg text-3xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
              页面只保留完成任务需要的路径。
            </h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-brand-50/68">
              登录后添加 CDK 游戏账号，上传干员识别文件并保存工作区，最终回到可导入 MAA 的排班结果。
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
          <figure className="landing-image-frame order-2 overflow-hidden rounded-xl bg-surface-1 lg:order-1">
            <picture>
              <source srcSet="/assets/previews/optimize-result-dark.png" media="(prefers-color-scheme: dark)" />
              <img
                src="/assets/previews/optimize-result-light.png"
                alt="排班方案结果页，展示下载排班 JSON、效率指标和精英化建议"
                className="block aspect-[16/10] w-full object-cover object-top"
                loading="lazy"
              />
            </picture>
          </figure>
          <div className="order-1 lg:order-2">
            <p className="text-sm font-semibold text-brand-100">结果预览</p>
            <h2 className="mt-3 max-w-xl text-3xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
              生成结果不只是一份 JSON，还包括可判断的收益指标。
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-brand-50/68">
              结果页直接给出可导入 MAA 的排班 JSON、关键效率数据和练度建议。需要更新干员或调整策略时，回到同一个游戏账号工作区继续处理。
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
        <span className="rounded-md bg-brand-300/12 px-2.5 py-1 text-xs font-medium text-brand-100">
          MAA 就绪
        </span>
      </div>

      <div className="grid gap-5 p-4 sm:p-5">
          <figure className="overflow-hidden rounded-lg border border-white/10 bg-surface-0">
            <picture>
              <source srcSet="/assets/previews/upload-entry-dark.png" media="(prefers-color-scheme: dark)" />
              <img
                src="/assets/previews/upload-entry-light.png"
              alt="工作台页面，包含登录注册、CDK 兑换、干员数据上传和基建配置入口"
                className="block aspect-[16/9] w-full object-cover object-top"
              />
            </picture>
          </figure>

        <div className="grid gap-3 sm:grid-cols-[1fr_0.82fr]">
          <div className="rounded-lg bg-white/[0.045] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-white">生成进度</span>
                <span className="text-xs font-medium text-success">可下载</span>
            </div>
            <div className="mt-4 space-y-3">
                  <ProgressLine label="读取干员识别文件" width="100%" />
                  <ProgressLine label="校验基建配置" width="88%" />
                  <ProgressLine label="生成排班 JSON" width="76%" />
            </div>
          </div>

          <div className="rounded-lg bg-warning p-4 text-brand-950">
            <p className="text-sm font-semibold">下一步</p>
            <p className="mt-2 text-sm leading-6 text-brand-950">
              下载排班 JSON，在 MAA 的自定义基建配置里选择该文件。
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

function HeroFact({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3">
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

function ProgressLine({ label, width }: { label: string; width: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-brand-50/62">
        <span>{label}</span>
        <span>{width}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <span className="block h-full rounded-full bg-brand-300" style={{ width }} />
      </div>
    </div>
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

function FileIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 3.75h6.15L18 8.6v11.65H7V3.75Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M13 4v5h5M9.5 13h5M9.5 16h3.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}
