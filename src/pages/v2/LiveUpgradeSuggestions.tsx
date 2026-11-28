import { useQuery, useQueryClient } from '@tanstack/react-query'
import UpgradeSuggestions from '../../components/UpgradeSuggestions'
import SklandDataActions from '../../components/SklandDataActions'
import { copy } from '../../copy'
import { useSklandSnapshot } from '../../hooks/useSklandSnapshot'
import { apiJson } from '../../lib/api-client'
import { projectsFromUpgradeSuggestion } from '../../lib/cultivation-project-import'
import { isUpgradeSuggestionCompleted } from '../../lib/upgrade-suggestion-completion'
import type { UpgradeSuggestion, WorkspaceResultHistoryItem } from '../../lib/types'
import { normalizeUpgradeSuggestions } from '../tool/optimize/workflow-utils'
import type { V2Session } from './OptionsDrawer'
import { Notice } from './components/WorkspaceUI'
import CultivationAdvisor, { type AdvisorRow } from './CultivationAdvisor'

export default function LiveUpgradeSuggestions({ suggestions, session, resultId }: {
  suggestions: UpgradeSuggestion[]
  session: V2Session
  resultId?: string
}) {
  const client = useQueryClient()
  const profile = session.activeProfile
  const snapshot = useSklandSnapshot(session.user?.id, profile, suggestions.length > 0)
  const inventory = snapshot.data?.inventory
  const enabled = Boolean(suggestions.length && session.user && profile && resultId && inventory?.items)
  const query = useQuery({
    queryKey: ['user', session.user?.id, profile?.id ?? null, 'upgrade-training-costs', resultId, snapshot.data?.version],
    enabled,
    queryFn: ({ signal }) => apiJson<{ item: WorkspaceResultHistoryItem }>(
      `/api/user/results/${encodeURIComponent(resultId!)}?${new URLSearchParams({ profile_id: profile!.id, training_costs: 'latest' })}`,
      { signal, timeoutMs: 90_000, fallbackMessage: copy.optimize.upgradeInventoryFailed },
    ),
  })
  const current = query.data && enabled ? normalizeUpgradeSuggestions(query.data.item.result.upgrade_suggestions)
    : suggestions.map((suggestion) => ({ ...suggestion, training_cost: undefined }))
  const loading = (snapshot.busy && !inventory) || query.isLoading
  const error = snapshot.error || query.error?.message
  return <div className="space-y-4">
    {session.user && profile && <CultivationAdvisor key={`${profile.id}:${resultId}`} scope={{ userId: session.user.id, profileId: profile.id }} rows={baseAdvisorRows(current)} />}
    <div className="v2-actions">
      <SklandDataActions session={session} profile={profile} refreshing={snapshot.busy || query.isFetching}
        onRefresh={() => void snapshot.refresh().then(() => client.invalidateQueries({
          queryKey: ['user', session.user?.id, profile?.id ?? null, 'upgrade-training-costs', resultId],
        }, { cancelRefetch: false }))} />
      {inventory?.fetchedAt && <p className="v2-muted">{copy.skland.updated(new Date(inventory.fetchedAt).toLocaleString('zh-CN'))}</p>}
    </div>
    {error && <Notice error>{error}</Notice>}
    <UpgradeSuggestions suggestions={current} embedded inventoryLoading={loading}
      projectScope={session.user && profile ? { userId: session.user.id, profileId: profile.id } : undefined} />
  </div>
}

function baseAdvisorRows(suggestions: UpgradeSuggestion[]): AdvisorRow[] {
  const labels = copy.v2.workspaceAssistant
  const format = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
  return suggestions.flatMap((suggestion, index) => {
    if (isUpgradeSuggestionCompleted(suggestion)) return []
    const title = suggestion.type === 'single' ? suggestion.name : suggestion.ops?.map((operator) => operator.name).join('、')
    if (!title) return []
    const gain = suggestion.roi?.daily_sanity_gain
    const orundum = suggestion.orundum_roi?.sustainable_orundum_gain
    const cost = suggestion.training_cost
    const facts = gain == null ? [] : [labels.gain(format(gain))]
    if (orundum != null) facts.push(labels.orundumGain(format(orundum)))
    if (cost?.status === 'available') {
      const total = cost.totals.equivalent_sanity
      if (total != null) facts.push(labels.totalCost(format(total)))
      else facts.push(labels.materialUnknown)
      const covered = !cost.missing.cash && !cost.missing.exp && cost.missing.materials.every((item) => !item.count)
      if (covered) facts.push(labels.readyMaterials)
      else if (cost.missing.equivalent_sanity != null) facts.push(labels.missingSanity(format(cost.missing.equivalent_sanity)))
      if (gain != null && gain > 0 && total != null) facts.push(labels.payback(format(total / gain)))
    } else facts.push(labels.unknownCost)
    return [{ id: `upgrade-${index + 1}`, title, facts: facts.slice(0, 4), projects: projectsFromUpgradeSuggestion(suggestion) }]
  })
}
