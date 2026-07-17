import type { LicenseConfig } from '../../src/lib/types'

type LayoutCounts = Pick<LicenseConfig, 'trading_stations_count' | 'manufacturing_stations_count'>

export function supportsExactOptimizationLayout(config: LayoutCounts): boolean {
  return (
    config.trading_stations_count === 2
    && config.manufacturing_stations_count === 4
  ) || (
    config.trading_stations_count === 3
    && config.manufacturing_stations_count === 3
  )
}

export function enforceLayoutOptimizationMode(config: LicenseConfig): boolean {
  if (supportsExactOptimizationLayout(config)) return false

  config.optimization_mode = 'fast'
  const optimizerSearch = config.optimizer_search && typeof config.optimizer_search === 'object' && !Array.isArray(config.optimizer_search)
    ? config.optimizer_search
    : {}
  config.optimizer_search = {
    ...optimizerSearch,
    optimization_mode: 'fast',
    beam: optimizerSearch.beam !== false,
  }
  if (config.Fiammetta) config.Fiammetta = { ...config.Fiammetta, candidate_mode: 'fast' }
  return true
}
