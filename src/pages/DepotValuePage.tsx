import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import AuthForm from '../components/AuthForm'
import BrandLogo from '../components/BrandLogo'
import SklandBindingDialog, { type SklandPayload } from '../components/SklandBindingDialog'
import { getCurrentSiteUrl } from '../lib/site-url'
import { apiJson, apiJsonOrNull } from '../lib/api-client'
import type { AuthMeResponse, DepotValueItem, DepotValueProfileResponse, DepotValueRequest, DepotValueResponse, UserGameAccount } from '../lib/types'

const LMD_ITEM_ID = '4001'

export default function DepotValuePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [depotText, setDepotText] = useState('')
  const [auth, setAuth] = useState<AuthMeResponse | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [depotProfile, setDepotProfile] = useState<UserGameAccount | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [result, setResult] = useState<DepotValueResponse | null>(null)
  const [loading, setLoading] = useState<DepotValueRequest['source'] | null>(null)
  const [profilePreparing, setProfilePreparing] = useState(false)
  const [sklandDialogOpen, setSklandDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyAuthData = useCallback((data: AuthMeResponse | null) => {
    setAuth(data)
    const profiles = data?.profiles ?? []
    const firstSklandProfile = profiles.find((profile) => profile.skland_binding)
    setDepotProfile(profiles.find((profile) => profile.kind === 'depot_value') ?? null)
    setSelectedProfileId((current) => {
      if (current && profiles.some((profile) => profile.id === current && profile.skland_binding)) return current
      return firstSklandProfile?.id ?? ''
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    apiJsonOrNull<AuthMeResponse>('/api/auth/me')
      .then((data) => {
        if (cancelled || !data) return
        applyAuthData(data)
      })
      .catch(() => {
        if (!cancelled) applyAuthData(null)
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [applyAuthData])

  useEffect(() => {
    if (result) drawShareCard(canvasRef.current, result)
  }, [result])

  const sklandProfiles = useMemo(
    () => auth?.profiles?.filter((profile) => profile.skland_binding) ?? [],
    [auth],
  )
  const selectedSklandProfile = useMemo(
    () => sklandProfiles.find((profile) => profile.id === selectedProfileId) ?? sklandProfiles[0] ?? null,
    [selectedProfileId, sklandProfiles],
  )

  const analyze = useCallback(async (payload: DepotValueRequest) => {
    setLoading(payload.source)
    setError(null)
    try {
      const data = await apiJson<DepotValueResponse>('/api/depot-value', {
        method: 'POST',
        json: payload,
        fallbackMessage: '仓库分析失败',
      })
      setResult(data)
      window.setTimeout(() => document.getElementById('depot-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    } catch (caught) {
      setResult(null)
      setError((caught as Error).message)
    } finally {
      setLoading(null)
    }
  }, [])

  const ensureDepotProfile = useCallback(async (): Promise<UserGameAccount> => {
    setProfilePreparing(true)
    setError(null)
    try {
      const data = await apiJson<DepotValueProfileResponse>('/api/user/profiles/depot-value', {
        method: 'POST',
        fallbackMessage: '创建仓库分析档案失败',
      })
      if (!data.user || !data.depot_profile) {
        throw new Error('创建仓库分析档案失败')
      }
      applyAuthData(data)
      setDepotProfile(data.depot_profile)
      setSelectedProfileId(data.depot_profile.id)
      return data.depot_profile
    } finally {
      setProfilePreparing(false)
    }
  }, [applyAuthData])

  const openSklandBinding = useCallback(async () => {
    setResult(null)
    setError(null)
    try {
      const profile = depotProfile ?? await ensureDepotProfile()
      setDepotProfile(profile)
      setSelectedProfileId(profile.id)
      setSklandDialogOpen(true)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [depotProfile, ensureDepotProfile])

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
    const profileId = selectedSklandProfile?.id
    if (profileId) {
      setSelectedProfileId(profileId)
      if (selectedSklandProfile?.skland_binding?.credential_status === 'invalid') {
        await openSklandBinding()
        return
      }
      await analyze({ source: 'skland', profile_id: profileId })
      return
    }
    if (!auth?.user) {
      setError('请先登录或注册，再使用森空岛库存。')
      return
    }
    await openSklandBinding()
  }

  const handleAuthenticated = (payload: AuthMeResponse) => {
    applyAuthData(payload)
    void openSklandBinding()
  }

  const handleSklandPayload = (payload: SklandPayload) => {
    applyAuthData(payload)
    const profile = payload.active_profile ?? payload.profiles?.find((item) => item.kind === 'depot_value') ?? null
    if (profile?.kind === 'depot_value') setDepotProfile(profile)
  }

  const handleSklandCompleted = (payload: SklandPayload) => {
    handleSklandPayload(payload)
    const completedProfile = payload.active_profile?.skland_binding
      ? payload.active_profile
      : payload.profiles?.find((profile) => profile.kind === 'depot_value' && profile.skland_binding)
    if (!completedProfile?.skland_binding) {
      setError('森空岛绑定已完成，但未找到可分析的绑定档案，请刷新后重试。')
      return
    }
    setSklandDialogOpen(false)
    setSelectedProfileId(completedProfile.id)
    void analyze({ source: 'skland', profile_id: completedProfile.id })
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
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="tool-page-frame max-w-6xl">
        <header className="tool-page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <BrandLogo size="md" />
            <div className="min-w-0">
              <p className="tool-eyebrow">MAA 小工具</p>
              <h1 className="mt-2 text-2xl font-semibold text-ink-primary">仓库价值分析器</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
                上传 MAA 仓库 JSON，按等价理智估算资产，并生成适合贴吧和 QQ 群分享的结果图。
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2">
            <Link
              to="/"
              className="tool-secondary-action"
            >
              返回首页
            </Link>
            <Link
              to="/tool/profiles"
              className="tool-primary-action"
            >
              进入工作区
            </Link>
          </nav>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-start">
          <section className="tool-panel p-5 sm:p-6">
            <div>
              <div>
                <h2 className="text-lg font-semibold text-ink-primary">导入仓库</h2>
                <p className="mt-1 text-sm leading-6 text-ink-secondary">
                  在 MAA 的仓库识别里导出数据时，请选择“企鹅物流刷图规划”或“明日方舟工具箱”。
                </p>
              </div>
            </div>

            {error && (
              <div className="tool-alert tool-alert--error mt-5" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={analyzeUpload} className="mt-5 space-y-5">
              <section className="tool-inset p-4">
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
                    className="tool-secondary-action"
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
                  className="tool-field mt-4 resize-y font-mono"
                  placeholder='粘贴 JSON，例如 {"2001":16000,"30011":982}'
                />
                {depotText.trim() && (
                  <span className="tool-status tool-status--success mt-3">
                    已粘贴 {depotText.trim().length} 个字符
                  </span>
                )}
              </section>

              <button
                type="submit"
                disabled={loading !== null || !depotText.trim()}
                className="tool-primary-action w-full"
              >
                {loading === 'upload' ? '正在估算...' : '分析剪贴板仓库'}
              </button>
            </form>

            <div className="mt-6 border-t border-surface-3 pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-ink-primary">森空岛快捷导入</h3>
                  <p className="mt-1 text-sm leading-6 text-ink-secondary">
                    使用森空岛导入会读取养成库存做本次估值，并匿名贡献聚合统计，用于改进击败百分比。
                  </p>
                </div>
                {auth?.user && (
                  <span className="tool-status tool-status--success whitespace-nowrap">
                    已登录
                  </span>
                )}
              </div>
              {authLoading ? (
                <p className="tool-inset mt-4 p-3 text-sm text-ink-secondary">正在确认登录状态...</p>
              ) : !auth?.user ? (
                <div className="tool-inset mt-4 p-4">
                  <AuthForm
                    compact
                    allowCdk={false}
                    intro="登录或注册后会自动创建一个仅用于仓库分析的免费档案，然后继续绑定森空岛。"
                    onAuthenticated={handleAuthenticated}
                  />
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {sklandProfiles.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <select
                          value={selectedSklandProfile?.id ?? selectedProfileId}
                          onChange={(event) => setSelectedProfileId(event.currentTarget.value)}
                          className="tool-field flex-1"
                        >
                          {sklandProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {formatProfileLabel(profile)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void analyzeSkland()}
                          disabled={loading !== null || profilePreparing}
                          className="tool-secondary-action"
                        >
                          {loading === 'skland'
                            ? '正在读取...'
                            : selectedSklandProfile?.skland_binding?.credential_status === 'invalid'
                              ? '重新绑定并分析'
                              : '使用森空岛库存'}
                        </button>
                      </div>
                      {selectedSklandProfile?.skland_binding?.credential_status === 'invalid' && (
                        <p className="tool-alert tool-alert--error" role="alert">
                          当前选择的森空岛凭据已失效。请重新绑定后再读取仓库库存。
                        </p>
                      )}
                    </div>
                  )}
                  {sklandProfiles.length === 0 && (
                    <button
                      type="button"
                      onClick={() => void openSklandBinding()}
                      disabled={loading !== null || profilePreparing}
                      className="tool-primary-action w-full"
                    >
                      {profilePreparing ? '正在准备账号...' : '绑定森空岛并分析仓库'}
                    </button>
                  )}
                </div>
              )}
              <p className="tool-alert tool-alert--warning mt-4">
                使用森空岛导入会默认匿名贡献本次统计结果；样本不包含仓库明细、干员明细、昵称、UID 明文或凭据。
              </p>
            </div>
          </section>

          <section className="tool-panel p-5 sm:p-6">
            <p className="tool-eyebrow">估值口径</p>
            <h2 className="mt-2 text-lg font-semibold text-ink-primary">怎么算的</h2>
            <div className="mt-4 space-y-4 text-sm leading-6 text-ink-secondary">
              <p>作战记录会先换算成经验，再折成大致理智；龙门币和材料也会尽量换算成同一个理智数。</p>
              <p>材料价格优先参考一图流/企鹅物流的物品价值。模组数据块、数据增补仪、数据增补条、家具零件不会参与计算。</p>
              <p>使用森空岛库存时会默认贡献匿名统计样本，样本越多，“击败 X% 博士”会越接近真实分布。</p>
            </div>
          </section>
        </div>

        {result && (
          <section id="depot-result" className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
            <ResultSummary result={result} />
            <SharePanel result={result} canvasRef={canvasRef} onDownload={downloadShareImage} />
          </section>
        )}
        <SklandBindingDialog
          open={sklandDialogOpen}
          profile={depotProfile}
          context="depot"
          autoStart
          onOpenChange={setSklandDialogOpen}
          onPayload={handleSklandPayload}
          onCompleted={handleSklandCompleted}
        />
      </div>
    </main>
  )
}

function ResultSummary({ result }: { result: DepotValueResponse }) {
  return (
    <section className="tool-panel border-brand-600/25 p-5 sm:p-6">
      <p className="tool-eyebrow">分析完成</p>
      <h2 className="mt-2 text-2xl font-semibold text-ink-primary">
        你的仓库资产击败了 {result.percentile}% 博士
      </h2>
      <p className="tool-inset mt-3 px-3 py-2 text-sm leading-6 text-ink-secondary">
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
            <p key={warning} className="tool-alert tool-alert--warning" role="status">
              {warning}
            </p>
          ))}
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-ink-primary">最值钱的库存</h3>
        <div className="tool-inset mt-3 divide-y divide-surface-3 overflow-hidden">
          {result.top_items.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 bg-surface-0 px-4 py-3">
              <span className="tool-status h-7 w-7 justify-center p-0 text-brand-300">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-primary">{item.name}</p>
                <p className="mt-1 text-xs text-ink-muted">数量 {formatNumber(item.count)} · {formatUnitSanityLabel(item)}</p>
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
              <span key={item.id} className="tool-status">
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
    <section className="tool-panel p-5 sm:p-6">
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
          className="tool-primary-action"
        >
          下载 PNG
        </button>
      </div>
      <div className="mt-5 flex justify-center">
        <canvas
          ref={canvasRef}
          width={900}
          height={1600}
          className="tool-inset aspect-[9/16] w-full max-w-[24rem] shadow-sm"
          aria-label={`你的仓库资产击败了 ${result.percentile}% 博士`}
        />
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="tool-inset p-4">
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
  ctx.fillText(`MAA 基建排班优化器 · ${getCurrentSiteUrl()}`, 112, 1484)
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
  return binding
    ? `${profile.display_name} · ${binding.nickname} (${binding.uid})${binding.credential_status === 'invalid' ? ' · 凭据失效' : ''}`
    : profile.display_name
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

function formatUnitSanityLabel(item: DepotValueItem): string {
  if (item.id === LMD_ITEM_ID) return `万件 ${formatNumber(item.unit_sanity * 10000)} 理智`
  return `单件 ${formatNumber(item.unit_sanity)} 理智`
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}
