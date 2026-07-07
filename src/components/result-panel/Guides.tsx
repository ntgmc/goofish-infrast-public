export function RotationManualGuide({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? '' : 'mt-6 border-t border-surface-3/60 pt-5'}>
      <div className={compact ? '' : 'rounded-lg bg-surface-2/60 px-4 py-4'}>
        <h3 className="text-base font-semibold text-ink-primary">
          游戏内快速切换设置
        </h3>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          游戏内轮换不生成排班 JSON。按下方预设队列逐个设施设置队列 1 / 队列 2，平时使用游戏内“队列轮换/快速切换”；同一设施由心情消耗最快的干员触发切换，触发时会切换该设施内所有干员。
        </p>
      </div>
    </div>
  )
}

export function MaaImportGuide({ compact = false }: { compact?: boolean }) {
  return (
    <details className={`${compact ? '' : 'mt-6 '}overflow-hidden rounded-lg border border-surface-3/70 bg-surface-2/40`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-ink-primary transition-colors duration-150 hover:bg-surface-2/80">
        <span>如何在 MAA 中使用排班 JSON</span>
        <span className="text-xs font-medium text-ink-muted">展开查看</span>
      </summary>
      <div className="grid gap-5 border-t border-surface-3/60 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.25fr)] lg:items-start">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-secondary">
          <li>在 MAA 左侧勾选 <span className="font-medium text-ink-primary">基建换班</span></li>
          <li>点击 <span className="font-medium text-ink-primary">基建换班</span> 右侧 <span className="font-medium text-ink-primary">小齿轮</span></li>
          <li><span className="font-medium text-ink-primary">基建模式</span> 选择 <span className="font-medium text-ink-primary">自定义基建配置</span></li>
          <li><span className="font-medium text-ink-primary">内置配置</span> 选择 <span className="font-medium text-ink-primary">自定义</span></li>
          <li>点击选择，选择本站下载的排班 JSON</li>
        </ol>
        <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-0">
          <picture>
            <source srcSet="/assets/maa-import-schedule-json-dark.png" media="(prefers-color-scheme: dark)" />
            <img
              src="/assets/maa-import-schedule-json-bright.png"
              alt="MAA 自定义基建配置中选择排班 JSON 的位置示意图"
              className="block h-auto w-full"
              loading="lazy"
            />
          </picture>
        </div>
      </div>
    </details>
  )
}
