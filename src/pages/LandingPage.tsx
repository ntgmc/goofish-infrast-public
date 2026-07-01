import { useEffect, useState, type CSSProperties, type PointerEvent } from 'react'
import { ACTIVE_PURCHASE_CHANNEL } from '../lib/purchase'

interface Props {
  onStart: () => void;
}

const strengths = [
  {
    title: '比手动排班更省心',
    description: '自动匹配房间、产物、无人机和干员练度，减少漏排、错排和重复上岗，不需要反复查攻略。',
  },
  {
    title: '比手动排班学习成本更低',
    description: '不用理解每个基建技能的组合细节，上传数据后直接给出可用方案和升级建议。',
  },
  {
    title: '比 MAA 默认排班效率更高',
    description: '按当前账号干员和基建配置重新计算，相比 MAA 默认排班，效率提升约 30%。',
  },
]

const workflow = [
  {
    title: '准备数据',
    description: '输入 CDK 并上传 MAA 导出的干员数据，在网站上生成授权文件。',
    detail: '已有授权文件或保存进度文件时，也可以直接上传继续使用。',
  },
  {
    title: '计算方案',
    description: '根据房间数量、产物需求、无人机策略和干员练度计算排班。',
    detail: '生成当前最优排班，并给出后续提升建议。',
  },
  {
    title: '确认收益',
    description: '查看排班明细、每日产出、无人机目标和精英化建议。',
    detail: '先看收益，再决定要不要采纳升级建议。',
  },
  {
    title: '导入 MAA',
    description: '下载生成的 JSON，把它选入 MAA 的自定义基建配置。',
    detail: '完成后即可回到 MAA，体验高效率基建。',
  },
]

const screenshotSlots = [
  {
    title: '上传与 CDK 入口',
    description: '首次使用输入 CDK 生成授权文件；已有 .maa 文件时可直接上传，适合继续调整。',
    src: '/assets/previews/upload-entry.png',
  },
  {
    title: '优化结果面板',
    description: '结果页集中展示排班 JSON 下载、保存进度文件、MAA 导入指引、效率指标和练度优化建议。',
    src: '/assets/previews/optimize-result.png',
  },
]

const proofPoints = [
  '少查表，少试错，降低手动排班的漏排和错排概率',
  '不用先学完整基建体系，上传数据后直接得到可执行方案',
  '比 MAA 默认排班更贴合账号现有干员，整体效率提升约 30%',
  '生成结果可导入 MAA，自定义排班和自动化流程可以继续衔接',
]

export default function LandingPage({ onStart }: Props) {
  useRevealOnScroll()

  return (
    <main className="min-h-screen overflow-hidden bg-[#080a0f] text-white">
      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[38rem] bg-[radial-gradient(circle_at_50%_0%,rgba(76,206,223,0.24),rgba(8,10,15,0)_62%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_36rem)]"
        />

        <div className="relative mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10">
          <header className="sticky top-4 z-20 flex items-center justify-between rounded-xl border border-white/10 bg-[#0b0e14]/82 px-4 py-3 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300 text-sm font-black text-[#071014]">
                M
              </div>
              <div>
                <p className="text-sm font-semibold text-white">MAA 基建排班优化器</p>
                <p className="text-xs text-white/48">Rhodes Island Infrastructure</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onStart}
              className="landing-cta hidden rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#080a0f] transition duration-150 hover:bg-cyan-100 active:scale-[0.98] sm:inline-flex"
            >
              开始使用
            </button>
          </header>

          <section className="grid min-h-[calc(100vh-5rem)] items-center gap-12 py-14 lg:grid-cols-[0.9fr_1.1fr] lg:py-16">
            <div className="landing-reveal max-w-2xl" data-reveal>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-200/18 bg-cyan-200/8 px-3 py-1 text-sm font-medium text-cyan-100">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
                上传，优化，导出
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-white sm:text-5xl lg:text-6xl">
                一键生成可导入 MAA 的基建排班
              </h1>
              <p className="mt-6 max-w-[58ch] text-base leading-8 text-white/66 sm:text-lg">
                输入 CDK 生成授权文件，或上传已有 .maa 文件。工具会自动计算干员、房间和无人机配置，直接导出可执行的排班 JSON。
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={onStart}
                  className="landing-cta inline-flex min-h-11 items-center justify-center rounded-lg bg-cyan-300 px-5 py-3 text-sm font-semibold text-[#061013] transition duration-150 hover:bg-cyan-200 active:scale-[0.98]"
                >
                  一键生成排班
                </button>
                {ACTIVE_PURCHASE_CHANNEL?.href && (
                  <a
                    href={ACTIVE_PURCHASE_CHANNEL.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-cyan-200/24 px-5 py-3 text-sm font-semibold text-cyan-100 transition duration-150 hover:border-cyan-200/42 hover:bg-cyan-200/[0.08] hover:text-white"
                  >
                    {ACTIVE_PURCHASE_CHANNEL.actionLabel}
                  </a>
                )}
                <a
                  href="#preview"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/12 px-5 py-3 text-sm font-semibold text-white/78 transition duration-150 hover:border-white/24 hover:bg-white/[0.06] hover:text-white"
                >
                  查看页面预览
                </a>
              </div>

              <div className="mt-12 flex items-center gap-3 text-sm text-white/44">
                <span className="landing-scroll-cue h-9 w-5 rounded-full border border-white/18" aria-hidden="true" />
                <span>向下查看完整流程</span>
              </div>
            </div>

            <div className="landing-reveal relative" data-reveal>
              <div className="absolute -inset-6 bg-cyan-300/10 blur-3xl" aria-hidden="true" />
              <HeroPreview />
            </div>
          </section>

          <section className="py-20 lg:py-24">
            <div className="landing-reveal grid gap-8 lg:grid-cols-[0.78fr_1fr]" data-reveal>
              <div>
                <p className="text-sm font-medium text-cyan-100">怎么使用</p>
                <h2 className="mt-4 max-w-xl text-3xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
                  上传一次数据，就能拿到可导入 MAA 的排班
                </h2>
                <p className="mt-5 max-w-[56ch] text-base leading-8 text-white/60">
                  不用手动对照干员技能，也不用反复改基建配置。按步骤上传文件、生成方案、下载 JSON，就可以回到 MAA 里使用。
                </p>
              </div>

              <div className="relative">
                <div className="absolute left-5 top-8 hidden h-[calc(100%-4rem)] w-px bg-white/10 sm:block" aria-hidden="true" />
                <div className="space-y-4">
                  {workflow.map((item, index) => (
                    <article
                      key={item.title}
                      className="landing-reveal relative rounded-xl border border-white/10 bg-white/[0.035] p-5 transition duration-200 hover:border-cyan-200/22 hover:bg-white/[0.055]"
                      data-reveal
                    >
                      <div className="flex gap-4">
                        <span className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-300 text-sm font-bold text-[#061013]">
                          {index + 1}
                        </span>
                        <div>
                          <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                          <p className="mt-2 text-sm leading-6 text-white/62">{item.description}</p>
                          <p className="mt-3 text-sm text-cyan-100/78">{item.detail}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="preview" className="py-20 lg:py-24">
            <div className="landing-reveal mb-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end" data-reveal>
              <div>
                <p className="text-sm font-medium text-cyan-100">真实界面预览</p>
                <h2 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
                  从上传到生成结果，每一步都看得清楚
                </h2>
              </div>
              <p className="max-w-[48ch] text-sm leading-6 text-white/58">
                截图展示实际使用界面：先导入数据，再查看可下载的排班 JSON、MAA 导入说明和优化建议。
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {screenshotSlots.map((slot) => (
                <ScreenshotSlot key={slot.src} {...slot} />
              ))}
            </div>
          </section>

          <section className="py-20 lg:py-24">
            <div className="landing-reveal grid gap-8 lg:grid-cols-[1fr_0.95fr]" data-reveal>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 sm:p-8">
                <p className="text-sm font-medium text-cyan-100">项目优势</p>
                <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
                  少手动试错，拿到更高效的 MAA 排班
                </h2>
                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  {proofPoints.map((point) => (
                    <div key={point} className="rounded-xl bg-white/[0.045] p-4">
                      <span className="mb-3 block h-1.5 w-8 rounded-full bg-cyan-300" aria-hidden="true" />
                      <p className="text-sm leading-6 text-white/66">{point}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                {strengths.map((item) => (
                  <article key={item.title} className="landing-reveal rounded-xl border border-white/10 bg-[#0d1118] p-5" data-reveal>
                    <h3 className="text-base font-semibold text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-white/58">{item.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="pb-16 pt-10">
            <div className="landing-reveal overflow-hidden rounded-2xl border border-cyan-200/18 bg-cyan-200/[0.08] p-6 sm:p-8 lg:p-10" data-reveal>
              <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <p className="text-sm font-medium text-cyan-100">准备进入工具</p>
                  <h2 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
                    拿到 CDK 或已有 .maa 文件时，可以直接开始
                  </h2>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row lg:flex-shrink-0">
                  <button
                    type="button"
                    onClick={onStart}
                    className="landing-cta inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-5 py-3 text-sm font-semibold text-[#080a0f] transition duration-150 hover:bg-cyan-100 active:scale-[0.98]"
                  >
                    进入上传页面
                  </button>
                  {ACTIVE_PURCHASE_CHANNEL?.href && (
                    <a
                      href={ACTIVE_PURCHASE_CHANNEL.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-cyan-100/30 px-5 py-3 text-sm font-semibold text-cyan-50 transition duration-150 hover:border-cyan-100/50 hover:bg-white/[0.06]"
                    >
                      {ACTIVE_PURCHASE_CHANNEL.actionLabel}
                    </a>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function HeroPreview() {
  const [previewStyle, setPreviewStyle] = useState<CSSProperties>({})

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    setPreviewStyle({
      '--tilt-x': `${(x - 0.5) * 5}deg`,
      '--tilt-y': `${(0.5 - y) * 5}deg`,
      '--glow-x': `${x * 100}%`,
      '--glow-y': `${y * 100}%`,
    } as CSSProperties)
  }

  const handlePointerLeave = () => {
    setPreviewStyle({
      '--tilt-x': '0deg',
      '--tilt-y': '0deg',
      '--glow-x': '50%',
      '--glow-y': '34%',
    } as CSSProperties)
  }

  return (
    <div
      className="landing-hero-preview relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d1118]"
      style={previewStyle}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <span className="landing-hero-glow" aria-hidden="true" />
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <p className="text-xs font-medium text-white/45">maa_schedule_optimized.json</p>
      </div>
      <div className="grid gap-0 lg:grid-cols-[0.78fr_1fr]">
        <div className="border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
          <p className="text-sm font-semibold text-white">从数据到排班文件</p>
          <div className="mt-5 space-y-4">
            <PreviewRow label="输入" value="CDK / .maa 文件" tone="cyan" index={0} />
            <PreviewRow label="计算" value="自动计算最优排班方案" tone="violet" index={1} />
            <PreviewRow label="输出" value="MAA 排班 JSON" tone="emerald" index={2} />
          </div>
          <div className="mt-6 rounded-xl bg-white/[0.045] p-4">
            <p className="text-xs font-medium text-white/48">核心收益</p>
            <p className="mt-2 text-2xl font-semibold text-white">少手动排，效率更高</p>
            <p className="mt-2 text-sm leading-6 text-white/58">
              自动生成可导入 MAA 的方案，减少手动试错，并比默认排班更贴合当前账号。
            </p>
          </div>
        </div>
        <div className="p-5">
          <div className="landing-generate-card rounded-xl border border-cyan-200/14 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">一键生成</p>
                <p className="mt-1 text-xs text-white/48">上传后自动计算 3 班方案</p>
              </div>
              <span className="landing-ready-pill relative overflow-hidden rounded-full px-3 py-1 text-xs font-semibold">
                <span className="landing-ready-pending">未就绪</span>
                <span className="landing-ready-done">已就绪</span>
              </span>
            </div>

            <div className="mt-5 space-y-3">
              <PreviewStep label="读取干员与练度" index={0} />
              <PreviewStep label="匹配基建房间配置" index={1} />
              <PreviewStep label="生成排班 JSON" index={2} />
            </div>
          </div>

          <div className="landing-result-reveal">
            <div className="mt-4 grid grid-cols-2 gap-3">
              <PreviewMetric label="预计总效率" value="5280%" index={0} />
              <PreviewMetric label="每日产出" value="96,800 龙门币" index={1} />
            </div>

            <div className="landing-download-card mt-4 rounded-xl bg-white/[0.045] p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-white/48">下一步</p>
                  <p className="mt-1 text-sm font-semibold text-white">下载排班 JSON</p>
                </div>
                <span className="landing-download-icon inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#080a0f]">
                  ↓
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewStep({ label, index }: { label: string; index: number }) {
  return (
    <div
      className="landing-preview-step flex items-center justify-between gap-4 rounded-lg bg-white/[0.035] px-3 py-2.5"
      style={{
        '--step-delay': `${index * 1050}ms`,
        '--step-check-delay': `${index * 1050 + 610}ms`,
        '--step-done-delay': `${index * 1050 + 460}ms`,
      } as CSSProperties}
    >
      <div className="flex items-center gap-3">
        <span className="landing-step-mark relative flex h-5 w-5 items-center justify-center rounded-full" aria-hidden="true">
          <svg className="h-5 w-5" viewBox="0 0 20 20">
            <circle className="landing-step-ring" cx="10" cy="10" r="8" />
            <path className="landing-step-check" d="M6 10.35l2.35 2.35L14.2 7.3" />
          </svg>
        </span>
        <span className="text-sm text-white/66">{label}</span>
      </div>
      <span className="landing-step-state relative min-w-8 text-right text-xs font-medium">
        <span className="landing-step-pending">等待</span>
        <span className="landing-step-done">完成</span>
      </span>
    </div>
  )
}

function PreviewMetric({ label, value, index }: { label: string; value: string; index: number }) {
  return (
    <div className="landing-metric-reveal rounded-xl bg-white/[0.045] p-4" style={{ '--metric-delay': `${5100 + index * 220}ms` } as CSSProperties}>
      <p className="text-xs font-medium text-white/48">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  )
}

function ScreenshotSlot({ title, description, src }: { title: string; description: string; src: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <article className="landing-reveal overflow-hidden rounded-2xl border border-white/10 bg-[#0d1118]" data-reveal>
      <div className="landing-preview-slot relative aspect-[16/10] bg-white/[0.035]">
        {!loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-cyan-200/30 bg-cyan-200/8 text-cyan-100">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 16.5V7.75A2.75 2.75 0 015.75 5h12.5A2.75 2.75 0 0121 7.75v8.5A2.75 2.75 0 0118.25 19H5.5A2.5 2.5 0 013 16.5zm4-5.25a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0zm.25 5.25l3.12-3.12a1.25 1.25 0 011.77 0l1.18 1.18 2.53-2.53a1.25 1.25 0 011.77 0L20 14.42" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-white">{failed ? '等待截图文件' : '正在检查截图'}</p>
            <p className="mt-2 max-w-[28ch] text-xs leading-5 text-white/48">放入对应 PNG 后，这里会显示真实页面。</p>
          </div>
        )}
        {!failed && (
          <img
            src={src}
            alt={`${title}预览截图`}
            className={`h-full w-full object-cover transition duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="p-5">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-white/58">{description}</p>
      </div>
    </article>
  )
}

function PreviewRow({ label, value, tone, index }: { label: string; value: string; tone: 'cyan' | 'violet' | 'emerald'; index: number }) {
  const tones = {
    cyan: 'bg-cyan-300',
    violet: 'bg-violet-300',
    emerald: 'bg-emerald-300',
  }

  return (
    <div className="landing-flow-row flex items-center justify-between gap-4 rounded-lg bg-white/[0.035] px-3 py-2.5" style={{ '--row-delay': `${420 + index * 780}ms` } as CSSProperties}>
      <div className="flex items-center gap-3">
        <span className={`landing-flow-dot h-2 w-2 rounded-full ${tones[tone]}`} aria-hidden="true" />
        <span className="text-sm text-white/62">{label}</span>
      </div>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  )
}

function useRevealOnScroll() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!('IntersectionObserver' in window)) {
      nodes.forEach((node) => node.classList.add('landing-visible'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('landing-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }
    )

    nodes.forEach((node) => observer.observe(node))

    return () => observer.disconnect()
  }, [])
}
