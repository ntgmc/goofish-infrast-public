import { copy } from '../copy/index'
type PurchaseChannelId = 'xianyu' | 'cardNetwork'

interface PurchaseChannel {
  id: PurchaseChannelId;
  label: string;
  actionLabel: string;
  href: string | null;
  enabled: boolean;
}

const PURCHASE_CHANNELS: Array<Omit<PurchaseChannel, 'href'>> = [
  {
    id: 'xianyu',
    label: copy.common.lib_purchase_001,
    actionLabel: copy.common.lib_purchase_002,
    enabled: true,
  },
  {
    id: 'cardNetwork',
    label: copy.common.lib_purchase_003,
    actionLabel: copy.common.lib_purchase_004,
    enabled: false,
  },
]

export function resolveActivePurchaseChannel(xianyuHref: string): PurchaseChannel | undefined {
  const configuredHrefs: Record<PurchaseChannelId, string | null> = {
    xianyu: xianyuHref.trim() || null,
    cardNetwork: null,
  }
  for (const channel of PURCHASE_CHANNELS) {
    const href = configuredHrefs[channel.id]
    if (channel.enabled && href) return { ...channel, href }
  }
  return undefined
}
