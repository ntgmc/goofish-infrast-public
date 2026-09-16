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
  const layoutCostConstrained = !supportsExactOptimizationLayout(config)
  const optimizationMode = layoutCostConstrained ? 'fast' : 'exact'
  if (layoutCostConstrained) config.optimization_mode = 'fast'
  else if (config.optimization_mode !== 'exact') delete config.optimization_mode
  const optimizerSearch = config.optimizer_search && typeof config.optimizer_search === 'object' && !Array.isArray(config.optimizer_search)
    ? config.optimizer_search
    : null
  if (optimizerSearch) {
    config.optimizer_search = {
      ...optimizerSearch,
      optimization_mode: optimizationMode,
      ...(layoutCostConstrained && { beam: optimizerSearch.beam !== false }),
    }
  } else if (layoutCostConstrained) {
    config.optimizer_search = { optimization_mode: 'fast', beam: true }
  } else {
    delete config.optimizer_search
  }
  if (config.Fiammetta) {
    config.Fiammetta = { ...config.Fiammetta }
    if (layoutCostConstrained) config.Fiammetta.candidate_mode = 'fast'
    else delete config.Fiammetta.candidate_mode
  }
  return layoutCostConstrained
}
