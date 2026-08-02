import { hasCapability, type CapabilitySubject } from './product-catalog'
import type { OptimizeResult } from './types'

/**
 * Keep the schedule itself visible while removing calculation details that the
 * active profile is not entitled to read from API responses.
 */
export function projectOptimizeResultForCapabilities(
  result: OptimizeResult,
  subject: CapabilitySubject,
): OptimizeResult {
  let projected = result

  if (!hasCapability(subject, 'view_full_data')) {
    const {
      daily_production: _dailyProduction,
      total_efficiency: _totalEfficiency,
      raw_total_efficiency: _rawTotalEfficiency,
      optimization_mode: _optimizationMode,
      optimality: _optimality,
      search_nodes: _searchNodes,
      pruned_nodes: _prunedNodes,
      candidate_count: _candidateCount,
      elapsed_ms: _elapsedMs,
      search_space_size: _searchSpaceSize,
      optimal_objective_value: _optimalObjectiveValue,
      cache_key: _cacheKey,
      job_recommended: _jobRecommended,
      cross_shift_trace: _crossShiftTrace,
      bounded_incumbent_source: _boundedIncumbentSource,
      bounded_incumbent_daily_score: _boundedIncumbentDailyScore,
      discarded_exact_daily_score: _discardedExactDailyScore,
      maa_default_comparison: _maaDefaultComparison,
      orundum_economy: _orundumEconomy,
      intermediate_depletion: _intermediateDepletion,
      build_meta: _buildMeta,
      ...visibleResult
    } = projected
    projected = visibleResult as OptimizeResult
  }

  if (!hasCapability(subject, 'view_raw_results')) {
    projected = { ...projected, raw_results: [] }
  }

  if (!hasCapability(subject, 'view_upgrade_suggestions')) {
    const {
      upgrade_suggestions: _upgradeSuggestions,
      upgrade_suggestions_status: _upgradeSuggestionsStatus,
      upgrade_suggestions_candidate_count: _upgradeSuggestionsCandidateCount,
      upgrade_suggestions_evaluated_count: _upgradeSuggestionsEvaluatedCount,
      upgrade_suggestions_truncated_reason: _upgradeSuggestionsTruncatedReason,
      ...visibleResult
    } = projected
    projected = visibleResult as OptimizeResult
  }

  return projected
}
