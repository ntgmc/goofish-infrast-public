import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import BrandLogo from '../components/BrandLogo'
import type { AuthMeResponse, DepotValueRequest, DepotValueResponse, UserGameAccount } from '../lib/types'

export default function DepotValuePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [depotText, setDepotText] = useState('')
  const [auth, setAuth] = useState<AuthMeResponse | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [result, setResult] = useState<DepotValueResponse | null>(null)
  const [loading, setLoading] = useState<DepotValueRequest['source'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(async (resp) => (resp.ok ? await resp.json() as AuthMeResponse : null))
      .then((data) => {
        if (cancelled || !data) return
        setAuth(data)
        const firstSklandProfile = data.profiles?.find((profile) => profile.skland_binding)
        if (firstSklandProfile) setSelectedProfileId(firstSklandProfile.id)
      })
      .catch(() => {
        if (!cancelled) setAuth(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (result) drawShareCard(canvasRef.current, result)
  }, [result])

  const sklandProfiles = useMemo(
    () => auth?.profiles?.filter((profile) => profile.skland_binding) ?? [],
    [auth],
  )

  const readClipboard = async () => {
    setResult(null)
    setError(null)
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error('当前浏览器不允许直接读取剪贴板，请手动粘贴到输入框。')
      }
      const text = await navigator.clipboard.readText()
      if (!text.trim()) throw new Error('剪贴板为空，请先复制 MAA 导出的仓库 JSON。')
      setDepotText(text)
    } catch (caught) {
      setError((caught as Error).message || '无法读取剪贴板，请手动粘贴 MAA 导出的仓库 JSON。')
    }
  }

  const analyzeUpload = async (event: FormEvent) => {
    event.preventDefault()
    let inventory: unknown
    try {
      inventory = parseDepotText(depotText)
    } catch (caught) {
      setError((caught as Error).message)
      return
    }
    await analyze({ source: 'upload', inventory })
  }

  const analyzeSkland = async () => {
    if (!selectedProfileId) {
      setError('当前登录账号没有可用的森空岛绑定档案。')
      return
    }
    await analyze({ source: 'skland', profile_id: selectedProfileId })
  }

  const analyze = async (payload: DepotValueRequest) => {
    setLoading(payload.source)
    setError(null)
    try {
      const resp = await fetch('/api/depot-value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await resp.json() as DepotValueResponse & { error?: string }
      if (!resp.ok) throw new Error(data.error || `仓库分析失败: ${resp.status}`)
      setResult(data)
      window.setTimeout(() => document.getElementById('depot-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    } catch (caught) {
      setResult(null)
      setError((caught as Error).message)
    } finally {
      setLoading(null)
    }
  }

  const downloadShareImage = () => {
    const canvas = canvasRef.current
    if (!canvas || !result) return
    const link = document.createElement('a')
    link.download = `maa-depot-value-${result.percentile}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <main className="min-h-screen bg-surface-0 px-4 py-6 text-ink-primary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <BrandLogo size="md" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-500">MAA 小工具</p>
              <h1 className="mt-2 text-2xl font-semibold text-ink-primary">仓库价值分析器</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
                上传 MAA 仓库 JSON，按等价理智估算资产，并生成适合贴吧和 QQ 群分享的结果图。
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2">
            <a
              href="/"
              className="rounded-lg border border-surface-3 bg-surface-0 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:border-surface-4 hover:bg-surface-2 hover:text-ink-primary"
            >
              返回首页
            </a>
            <a
              href="/tool"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
            >
              进入工作区
            </a>
          </nav>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-start">
          <section className="rounded-lg border border-surface-3 bg-surface-1 p-5 sm:p-6">
            <div>
              <div>
                <h2 className="text-lg font-semibold text-ink-primary">导入仓库</h2>
                <p className="mt-1 text-sm leading-6 text-ink-secondary">
                  在 MAA 的仓库识别里导出数据时，请选择“企鹅物流刷图规划”或“明日方舟工具箱”。
                </p>
              </div>
            </div>

            {error && (
              <div className="mt-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={analyzeUpload} className="mt-5 space-y-5">
              <section className="rounded-lg border border-surface-3 bg-surface-0 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-primary">粘贴仓库 JSON</h3>
                    <p className="mt-1 text-sm leading-6 text-ink-secondary">
                      从 MAA 选择“企鹅物流刷图规划”或“明日方舟工具箱”导出，复制内容后粘贴到这里。
                      粘贴 JSON 只用于本次分析，不会进入样本池。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void readClipboard()}
                    className="rounded-lg border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:border-surface-4 hover:bg-surface-2 hover:text-ink-primary"
                  >
                    读取剪贴板
                  </button>
                </div>
                <textarea
                  value={depotText}
                  onChange={(event) => {
                    setDepotText(event.currentTarget.value)
                    setResult(null)
                    setError(null)
                  }}
                  rows={9}
                  className="mt-4 w-full resize-y rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 font-mono text-sm text-ink-primary outline-none transition-colors duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  placeholder='粘贴 JSON，例如 {"2001":16000,"30011":982}'
                />
                {depotText.trim() && (
                  <span className="mt-3 inline-flex rounded-md bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                    已粘贴 {depotText.trim().length} 个字符
                  </span>
                )}
              </section>

              <button
                type="submit"
                disabled={loading !== null || !depotText.trim()}
                className="w-full rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:bg-surface-3 disabled:text-ink-muted"
              >
                {loading === 'upload' ? '正在估算...' : '分析剪贴板仓库'}
              </button>
            </form>

            <div className="mt-6 border-t border-surface-3 pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-ink-primary">森空岛快捷导入</h3>
                  <p className="mt-1 text-sm leading-6 text-ink-secondary">
                    已登录并绑定森空岛的账号可直接读取养成库存；不会覆盖工作区数据。
                  </p>
                </div>
                <a href="/tool" className="text-sm font-semibold text-brand-500 hover:text-brand-400">
                  去绑定
                </a>
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <select
                  value={selectedProfileId}
                  onChange={(event) => setSelectedProfileId(event.currentTarget.value)}
                  className="min-h-11 flex-1 rounded-lg border border-surface-4 bg-surface-0 px-3 text-sm text-ink-primary outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">{sklandProfiles.length > 0 ? '选择森空岛档案' : '暂无已绑定森空岛档案'}</option>
                  {sklandProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {formatProfileLabel(profile)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void analyzeSkland()}
                  disabled={loading !== null || !selectedProfileId}
                  className="rounded-lg border border-surface-3 bg-surface-0 px-5 py-2.5 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:border-surface-4 hover:bg-surface-2 hover:text-ink-primary disabled:bg-surface-2 disabled:text-ink-muted"
                >
                  {loading === 'skland' ? '正在读取...' : '使用森空岛库存'}
                </button>
              </div>
              <p className="mt-4 rounded-lg border border-surface-3 bg-surface-0 p-3 text-sm leading-6 text-ink-secondary">
                使用森空岛库存会默认匿名贡献本次统计结果，用于改进击败百分比；不包含仓库明细、干员明细、昵称、UID 明文或凭据。
              </p>
            </div>
          </section>

          <section className="rounded-lg border border-surface-3 bg-surface-1 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-ink-primary">怎么算的</h2>
            <div className="mt-4 space-y-4 text-sm leading-6 text-ink-secondary">
              <p>作战记录会先换算成经验，再折成大致理智；龙门币和材料也会尽量换算成同一个理智数。</p>
              <p>材料价格优先参考一图流/企鹅物流的物品价值。模组数据块、数据增补仪、数据增补条、家具零件不会参与计算。</p>
              <p>使用森空岛库存时会默认贡献匿名统计样本，样本越多，“击败 X% 博士”会越接近真实分布；样本不足时仍会参考估算曲线。</p>
            </div>
          </section>
        </div>

        {result && (
          <section id="depot-result" className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
            <ResultSummary result={result} />
            <SharePanel result={result} canvasRef={canvasRef} onDownload={downloadShareImage} />
          </section>
        )}
      </div>
    </main>
  )
}

function ResultSummary({ result }: { result: DepotValueResponse }) {
  return (
    <section className="rounded-lg border border-brand-600/25 bg-surface-1 p-5 sm:p-6">
      <p className="text-sm font-semibold text-brand-500">分析完成</p>
      <h2 className="mt-2 text-2xl font-semibold text-ink-primary">
        你的仓库资产击败了 {result.percentile}% 博士
      </h2>
      <p className="mt-3 rounded-lg border border-surface-3 bg-surface-0 px-3 py-2 text-sm leading-6 text-ink-secondary">
        {formatRankingNote(result)}
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Metric label="等价理智" value={formatNumber(result.total_equivalent_sanity)} />
        <Metric label="已估价物品" value={`${result.priced_count} 类`} />
        <Metric label="未估价物品" value={`${result.unpriced_count} 类`} />
      </div>

      {result.warnings.length > 0 && (
        <div className="mt-5 space-y-2">
          {result.warnings.map((warning) => (
            <p key={warning} className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              {warning}
            </p>
          ))}
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink-primary">最值钱的库存</h3>
        <div className="mt-3 divide-y divide-surface-3 overflow-hidden rounded-lg border border-surface-3">
          {result.top_items.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 bg-surface-0 px-4 py-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500/10 text-xs font-semibold text-brand-500">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-primary">{item.name}</p>
                <p className="mt-1 text-xs text-ink-muted">数量 {formatNumber(item.count)} · 单件 {formatNumber(item.unit_sanity)} 理智</p>
              </div>
              <p className="text-sm font-semibold text-ink-primary">{formatNumber(item.equivalent_sanity)}</p>
            </div>
          ))}
        </div>
      </div>

      {result.unpriced_items.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink-primary">未计入估值</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {result.unpriced_items.map((item) => (
              <span key={item.id} className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-ink-secondary">
                {item.name} × {formatNumber(item.count)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function SharePanel({
  result,
  canvasRef,
  onDownload,
}: {
  result: DepotValueResponse
  canvasRef: RefObject<HTMLCanvasElement>
  onDownload: () => void
}) {
  return (
    <section className="rounded-lg border border-surface-3 bg-surface-1 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-primary">分析截图</h2>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">
            下载 PNG 后可以直接发给朋友分析。
          </p>
        </div>
        <button
          type="button"
          onClick={onDownload}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
        >
          下载 PNG
        </button>
      </div>
      <div className="mt-5 flex justify-center">
        <canvas
          ref={canvasRef}
          width={900}
          height={1600}
          className="aspect-[9/16] w-full max-w-[24rem] rounded-lg border border-surface-3 bg-surface-0 shadow-sm"
          aria-label={`你的仓库资产击败了 ${result.percentile}% 博士`}
        />
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-0 p-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink-primary">{value}</p>
    </div>
  )
}

function drawShareCard(canvas: HTMLCanvasElement | null, result: DepotValueResponse) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const width = 900
  const height = 1600
  canvas.width = width
  canvas.height = height

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#122f38')
  gradient.addColorStop(0.52, '#17253b')
  gradient.addColorStop(1, '#111827')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  drawCircle(ctx, 720, 170, 220, 'rgba(94, 234, 212, 0.18)')
  drawCircle(ctx, 160, 1220, 260, 'rgba(250, 204, 21, 0.11)')

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.font = '600 34px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('MAA 仓库价值分析器', 72, 96)
  ctx.font = '400 24px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.62)'
  ctx.fillText(result.ranking.mode === 'sample_adjusted'
    ? `参考 ${formatNumber(result.ranking.sample_count)} 位森空岛样本修正`
    : '样本积累中，当前结果以估算曲线为主', 72, 136)

  ctx.fillStyle = '#ffffff'
  ctx.font = '700 60px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('你的仓库资产', 72, 260)
  ctx.font = '700 70px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(`击败了 ${result.percentile}% 博士`, 72, 350)

  drawRoundedRect(ctx, 72, 430, 756, 220, 28, 'rgba(255, 255, 255, 0.1)')
  ctx.fillStyle = 'rgba(255, 255, 255, 0.64)'
  ctx.font = '500 28px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('等价理智', 112, 502)
  ctx.fillStyle = '#facc15'
  ctx.font = '700 82px "Segoe UI", "Noto Sans SC", sans-serif'
  ctx.fillText(formatNumber(result.total_equivalent_sanity), 112, 596)

  ctx.fillStyle = '#ffffff'
  ctx.font = '700 34px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('仓库资产榜', 72, 740)

  result.top_items.slice(0, 5).forEach((item, index) => {
    const y = 804 + index * 116
    drawRoundedRect(ctx, 72, y, 756, 88, 18, 'rgba(255, 255, 255, 0.075)')
    ctx.fillStyle = '#7dd3fc'
    ctx.font = '700 28px "Segoe UI", sans-serif'
    ctx.fillText(String(index + 1).padStart(2, '0'), 104, y + 54)
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 28px "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(truncateText(ctx, item.name, 380), 166, y + 40)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.58)'
    ctx.font = '400 22px "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(`数量 ${formatNumber(item.count)}`, 166, y + 70)
    ctx.fillStyle = '#facc15'
    ctx.font = '700 28px "Segoe UI", sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(formatNumber(item.equivalent_sanity), 790, y + 54)
    ctx.textAlign = 'left'
  })

  drawRoundedRect(ctx, 72, 1400, 756, 104, 24, 'rgba(255, 255, 255, 0.1)')
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 28px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('免费生成你的仓库资产分享图', 112, 1446)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.62)'
  ctx.font = '400 22px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('MAA 基建排班优化器 · https://maatool.com/', 112, 1484)
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
  ctx.fillStyle = fill
  ctx.fill()
}

function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string) {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let next = text
  while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1)
  }
  return `${next}...`
}

function formatProfileLabel(profile: UserGameAccount): string {
  const binding = profile.skland_binding
  return binding ? `${profile.display_name} · ${binding.nickname} (${binding.uid})` : profile.display_name
}

function parseDepotText(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) throw new Error('请先粘贴 MAA 仓库 JSON。')
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    throw new Error('JSON 格式不正确。请在 MAA 导出方式中选择“企鹅物流刷图规划”或“明日方舟工具箱”。')
  }
}

function formatRankingNote(result: DepotValueResponse): string {
  if (result.ranking.mode === 'sample_adjusted') {
    const weightText = `${Math.round(result.ranking.sample_weight * 100)}%`
    return `已参考 ${formatNumber(result.ranking.sample_count)} 位森空岛样本修正百分比，当前样本权重约 ${weightText}。`
  }
  if (result.ranking.sample_count > 0) {
    return `样本积累中，当前结果仍以估算曲线为主。`
  }
  return `样本积累中，当前结果仍以估算曲线为主。`
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}
