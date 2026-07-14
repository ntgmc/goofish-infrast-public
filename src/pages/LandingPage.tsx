import { Link } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import PublicFooter from '../components/PublicFooter'
import { ACTIVE_PURCHASE_CHANNEL } from '../lib/purchase'

interface Props {
  onStart: () => void
}

const workflow = [
  {
    title: '确认数据来源',
    description: '添加游戏账号后，先预览森空岛昵称和 UID；也可导入 MAA 干员识别文件。',
  },
  {
    title: '检查基建配置',
    description: '只填写计算需要的房间和规则；系统会标出无法生成结果的缺项。',
  },
  {
    title: '带走可执行结果',
    description: '查看收益和练度建议后，下载可导入 MAA 的排班 JSON。',
  },
]

const metrics = [
  { label: '预计总效率', value: '4,169.00%', detail: '基于当前干员与房间配置' },
  { label: '制造站产量', value: '117.0 件/日', detail: '赤金与作战记录分项可查' },
  { label: '预计日产出', value: '74,133 龙门币', detail: '以实际生成结果为准' },
  { label: '等效理智', value: '337.1 / 日', detail: '收益与培养成本放在同一口径' },
]

export default function LandingPage({ onStart }: Props) {
  const purchaseHref = ACTIVE_PURCHASE_CHANNEL?.href

  return (
    <main className="landing-shell min-h-screen" tabIndex={-1} data-route-focus>
      <section className="mx-auto w-full max-w-7xl px-5 pb-16 pt-5 sm:px-8 lg:px-10 lg:pb-24 lg:pt-7">
        <nav className="flex min-h-12 items-center justify-between gap-4 border-b border-surface-3 pb-5">
          <Link to="/" className="flex min-w-0 items-center gap-3 rounded-lg text-left focus-visible:outline-none">
            <BrandLogo size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink-primary">MAA 基建排班优化器</span>
              <span className="mt-0.5 block truncate text-xs text-ink-muted">森空岛导入 · 等效理智 · MAA JSON</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <Link to="/announcements" className="hidden min-h-11 items-center px-3 text-sm font-medium text-ink-secondary transition-colors hover:text-ink-primary sm:inline-flex">
              公告
            </Link>
            <button type="button" onClick={onStart} className="tool-primary-action inline-flex items-center justify-center">
              进入工作台
            </button>
          </div>
        </nav>

        <div className="grid gap-12 py-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(28rem,1.05fr)] lg:items-center lg:py-24">
          <div className="max-w-2xl">
            <p className="tool-eyebrow">为当前干员池生成可执行排班</p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.035em] text-ink-primary sm:text-5xl lg:text-6xl">
              生成排班，确认收益，下载 JSON。
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-ink-secondary sm:text-lg sm:leading-8">
              这是一个短时、结果导向的工具：导入干员与库存，确认基建配置，获得适配当前账号的 MAA 基建排班和透明的收益建议。
            </p>
            <p className="mt-4 max-w-xl text-sm leading-6 text-ink-muted">
              不要求游戏账号密码。绑定森空岛前会先展示昵称与 UID，由你确认后才保存和导入数据。
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={onStart} className="tool-primary-action inline-flex items-center justify-center">
                开始准备排班
              </button>
              <Link to="/tools/depot-value" className="tool-secondary-action inline-flex items-center justify-center">
                免费仓库估值
              </Link>
              {purchaseHref && (
                <a href={purchaseHref} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center px-3 text-sm font-medium text-ink-secondary transition-colors hover:text-ink-primary">
                  获取 CDK
                </a>
              )}
            </div>

            <dl className="mt-10 grid gap-px overflow-hidden rounded-xl border border-surface-3 bg-surface-3 sm:grid-cols-3">
              <Fact label="数据来源" value="森空岛 / MAA" />
              <Fact label="核心输出" value="排班 JSON" />
              <Fact label="决策口径" value="等效理智" />
            </dl>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section className="border-y border-surface-3 bg-surface-1/55 px-5 py-16 sm:px-8 lg:px-10 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1fr)]">
          <div>
            <p className="tool-eyebrow">三步完成</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-ink-primary sm:text-4xl">
              只保留完成任务所需的路径。
            </h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-ink-secondary">
              工具不要求每天维护，也不会用任务或弹窗阻碍离开。生成结果后，你可以直接下载、保存工作文件或结束会话。
            </p>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-xl border border-surface-3 bg-surface-3 md:grid-cols-3">
            {workflow.map((item, index) => <WorkflowStep key={item.title} index={index + 1} {...item} />)}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)] lg:px-10 lg:py-24">
        <figure className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
          <picture>
            <source srcSet="/assets/previews/optimize-result-dark.png" media="(prefers-color-scheme: dark)" />
            <img
              src="/assets/previews/optimize-result-light.png"
              alt="排班结果页，展示 JSON 下载、等效理智、效率指标和练度成本。"
              className="block aspect-[16/10] w-full object-cover object-top"
              loading="lazy"
            />
          </picture>
          <figcaption className="border-t border-surface-3 px-4 py-3 text-xs leading-5 text-ink-muted sm:px-5">
            结果页优先呈现可下载方案与关键收益；算法依据和房间明细按需展开。
          </figcaption>
        </figure>

        <div className="lg:py-4">
          <p className="tool-eyebrow">结果优先</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-ink-primary sm:text-4xl">
            一份方案，同时说明它为什么值得采用。
          </h2>
          <p className="mt-4 text-base leading-7 text-ink-secondary">
            除了排班 JSON，结果会清楚展示日产出、等效理智、练度成本和回本依据，让培养决策能够被复核。
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {metrics.map((metric) => <MetricTile key={metric.label} {...metric} />)}
          </div>
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-8 lg:px-10 lg:pb-24">
        <div className="mx-auto grid max-w-7xl gap-6 rounded-xl border border-surface-3 bg-surface-1 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="tool-eyebrow">准备开始</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink-primary sm:text-3xl">
              用当前账号数据，得到下一份可执行的排班。
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-secondary">
              可随时返回账号列表、保存本地工作文件或退出登录。你的操作路径和数据边界始终清晰可见。
            </p>
          </div>
          <button type="button" onClick={onStart} className="tool-primary-action inline-flex items-center justify-center whitespace-nowrap">
            打开工作台
          </button>
        </div>
      </section>

      <PublicFooter />
    </main>
  )
}

function ProductPreview() {
  return (
    <section className="landing-preview overflow-hidden" aria-label="排班生成结果示意">
      <div className="landing-preview-window flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-primary">排班方案已就绪</p>
          <p className="mt-0.5 text-xs text-ink-muted">基于当前干员、库存与基建配置</p>
        </div>
        <span className="tool-status tool-status--success shrink-0">可下载</span>
      </div>
      <div className="grid gap-4 p-4 sm:p-5">
        <div className="tool-inset overflow-hidden">
          <picture>
            <source srcSet="/assets/previews/upload-entry-dark.png" media="(prefers-color-scheme: dark)" />
            <img
              src="/assets/previews/upload-entry-light.png"
              alt="工作台包含森空岛导入、干员数据、基建配置与生成入口。"
              className="block aspect-[16/9] w-full object-cover object-top"
            />
          </picture>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="tool-inset p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-primary">生成状态</p>
              <span className="text-xs font-semibold text-success">已完成</span>
            </div>
            <ol className="mt-4 space-y-3 text-sm text-ink-secondary">
              <PreviewStep label="确认账号与数据来源" />
              <PreviewStep label="计算排班与收益指标" />
              <PreviewStep label="整理可导入的 JSON 结果" current />
            </ol>
          </div>
          <div className="tool-inset flex min-w-48 flex-col justify-between p-4">
            <div>
              <p className="text-xs font-medium text-ink-muted">下一步</p>
              <p className="mt-2 text-sm font-semibold text-ink-primary">下载排班 JSON</p>
              <p className="mt-2 text-xs leading-5 text-ink-muted">在 MAA 的自定义基建配置中选择该文件。</p>
            </div>
            <span className="mt-4 inline-flex items-center text-xs font-semibold text-brand-300">结果已可导出</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-1 px-4 py-4">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-ink-primary">{value}</dd>
    </div>
  )
}

function WorkflowStep({ index, title, description }: { index: number; title: string; description: string }) {
  return (
    <li className="bg-surface-1 p-5 sm:p-6">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-brand-500/40 bg-brand-500/10 text-sm font-semibold text-brand-200">
        {index}
      </span>
      <h3 className="mt-5 text-base font-semibold text-ink-primary">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-ink-secondary">{description}</p>
    </li>
  )
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="landing-preview-metric p-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold tracking-[-0.02em] text-ink-primary">{value}</p>
      <p className="mt-2 text-xs leading-5 text-ink-muted">{detail}</p>
    </div>
  )
}

function PreviewStep({ label, current = false }: { label: string; current?: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${current ? 'border-brand-400 bg-brand-500/15 text-brand-200' : 'border-success/45 bg-success/10 text-success'}`} aria-hidden="true">
        {current ? '3' : '✓'}
      </span>
      <span>{label}</span>
    </li>
  )
}
