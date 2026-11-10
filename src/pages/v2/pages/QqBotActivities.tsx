import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import QqBotVerificationPanel from '../../../components/QqBotVerificationPanel'
import { apiJson } from '../../../lib/api-client'
import { copy } from '../../../copy'
import type { QqBotActivitiesResponse } from '../../../lib/qqbot-verification-contracts'
import { itemIconPath } from '../../../lib/inventory-contracts'
import { formatShanghaiDateTime } from '../../tool/tool-utils'
import { EmptyState, Loading, Notice } from '../components/WorkspaceUI'

const text = copy.notifications.qqbotActivities
export default function QqBotActivities({ userId }: { userId: string }) {
  const [params] = useSearchParams()
  const group = params.get('group_id')
  const campaign = params.get('campaign_id')
  const search = new URLSearchParams()
  if (group) search.set('group_id', group)
  if (campaign) search.set('campaign_id', campaign)
  const query = useQuery({ queryKey: ['user', userId, null, 'qqbot-activities', group, campaign], enabled: Boolean(userId), staleTime: 0,
    queryFn: ({ signal }) => apiJson<QqBotActivitiesResponse>(`/api/user/qqbot/activities?${search}`, { signal }),
  })
  const settings = useQuery({ queryKey: ['user', userId, null, 'qqbot'], enabled: Boolean(userId), staleTime: 0,
    queryFn: ({ signal }) => apiJson<{ available: boolean; binding: { qq_number: string } | null }>('/api/user/qqbot', { signal }),
  })
  const [selected, setSelected] = useState<string | null>(null)
  return <div className="space-y-5">
    <p className="v2-lead">{text.introduction}</p>
    <Notice error>{query.error?.message ?? settings.error?.message}</Notice>
    {(query.error || settings.error) && <button type="button" className="v2-button v2-button-secondary" onClick={() => { void query.refetch({ cancelRefetch: false }); void settings.refetch({ cancelRefetch: false }) }}>{text.reload}</button>}
    {query.isPending ? <Loading label={text.loading} skeleton="list" /> : !query.data?.campaigns.length && !query.error ? <EmptyState title={text.empty}>{text.emptyHelp}</EmptyState> : query.data?.campaigns.map((row) => {
      const id = `${row.group_id}:${row.campaign_id}`
      const closed = !row.enabled || Boolean(row.ends_at && Date.parse(row.ends_at) <= Date.now())
      const open = selected === id || (query.data.campaigns.length === 1 && selected === null)
      return <article key={id} className="v2-panel space-y-4 p-5 sm:p-6">
        <div className="flex min-w-0 items-center gap-4"><img src={itemIconPath(row.icon_key)} alt="" width={64} height={64} /><div className="min-w-0"><h2 className="break-all text-lg font-semibold">{row.item_name} ×{row.quantity}</h2><p className="v2-muted break-all">{text.group(row.group_id, row.campaign_id)}</p></div></div>
        <p className="v2-muted">{text.validity(row.validity_days)}</p>
        <ul className="space-y-2 text-sm text-ink-secondary">
          {row.min_join_days > 0 && <li>{text.tenure(row.min_join_days)}</li>}
          {row.joined_before && <li>{text.joinedBefore(formatShanghaiDateTime(row.joined_before))}</li>}
          {row.ends_at && <li>{text.ends(formatShanghaiDateTime(row.ends_at))}</li>}
          {!row.min_join_days && !row.joined_before && <li>{text.allMembers}</li>}
        </ul>
        {row.claimed ? <p className="v2-notice" role="status">{text.claimed}</p> : row.claimed_elsewhere ? <p className="v2-notice">{text.claimedElsewhere}</p> : closed ? <p className="v2-muted">{text.closed}</p> : open ? <QqBotVerificationPanel key={id} userId={userId} groupId={row.group_id} campaignId={row.campaign_id} boundQq={settings.data?.binding?.qq_number} disabled={!settings.data?.available} /> : <button type="button" className="v2-button v2-button-primary" onClick={() => setSelected(id)}>{text.open}</button>}
      </article>
    })}
  </div>
}
