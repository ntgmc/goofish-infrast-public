import { copy } from '../copy/index'
export type PurchaseChannelId = 'xianyu' | 'cardNetwork'

export interface PurchaseChannel {
  id: PurchaseChannelId;
  label: string;
  actionLabel: string;
  href: string | null;
  enabled: boolean;
}

export const PURCHASE_CHANNELS: PurchaseChannel[] = [
  {
    id: 'xianyu',
    label: copy.common.lib_purchase_001,
    actionLabel: copy.common.lib_purchase_002,
    href: 'https://m.tb.cn/h.RGCWZHH?tk=X063g9yLZxZ%20MF287',
    enabled: true,
  },
  {
    id: 'cardNetwork',
    label: copy.common.lib_purchase_003,
    actionLabel: copy.common.lib_purchase_004,
    href: null,
    enabled: false,
  },
]

export const ACTIVE_PURCHASE_CHANNEL = PURCHASE_CHANNELS.find((channel) => channel.enabled && channel.href)
