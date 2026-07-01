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
    label: '闲鱼',
    actionLabel: '去闲鱼购买 CDK',
    href: 'https://m.tb.cn/h.RGCWZHH?tk=X063g9yLZxZ%20MF287',
    enabled: true,
  },
  {
    id: 'cardNetwork',
    label: '发卡网',
    actionLabel: '发卡网购买 CDK',
    href: null,
    enabled: false,
  },
]

export const ACTIVE_PURCHASE_CHANNEL = PURCHASE_CHANNELS.find((channel) => channel.enabled && channel.href)
