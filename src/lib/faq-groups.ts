import { copy } from '../copy'
import type { PublicContentDraftV1 } from './public-content'

type FaqItem = PublicContentDraftV1['faq']['items'][number]

const groups: { id: string; title: string; itemIds: string[] }[] = [
  { id: 'gettingStarted', title: copy.public.faq_groups.gettingStarted, itemIds: [
    'requirements', 'account-concepts', 'game-password', 'free-versus-lifetime', 'depot-versus-schedule', 'browser-support',
  ] },
  { id: 'import', title: copy.public.faq_groups.import, itemIds: [
    'skland-data', 'skland-save', 'skland-refresh', 'import-failure', 'import-files', 'missing-operators', 'manual-operators', 'partial-import',
  ] },
  { id: 'generation', title: copy.public.faq_groups.generation, itemIds: [
    'schedule-modes', 'result-differences', 'free-limits', 'config-layout', 'config-validation', 'saved-configs', 'waiting', 'task-failure',
    'background-task', 'incremental-recompute', 'manual-schedule', 'training-roi', 'scenario-comparison',
  ] },
  { id: 'export', title: copy.public.faq_groups.export, itemIds: [
    'use-json', 'json-unavailable', 'history-archive', 'manual-drafts', 'manual-export',
  ] },
  { id: 'account', title: copy.public.faq_groups.account, itemIds: [
    'cdk-account', 'change-bound-account', 'data-security', 'delete-account', 'support-info', 'registration', 'password-reset',
    'multiple-profiles', 'profile-upgrade', 'profile-expiry', 'lifetime-upgrade', 'coupons', 'invitation-rewards', 'personal-use', 'risk-review', 'qq-group',
  ] },
  { id: 'other', title: copy.public.faq_groups.other, itemIds: [] },
]

export function groupFaqItems(items: FaqItem[]) {
  return groups.map((group) => ({
    id: group.id,
    title: group.title,
    items: items.filter((item) => (groups.find((entry) => entry.itemIds.includes(item.id))?.id ?? 'other') === group.id),
  })).filter((group) => group.items.length > 0)
}
