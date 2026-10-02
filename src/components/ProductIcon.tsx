import { copy } from '../copy/index'

const PRODUCT_ICONS: Record<string, readonly [label: string, icon: string]> = {
  LMD: [copy.common.components_ConfigEditor_001, 'GOLD'],
  Orundum: [copy.common.components_ConfigEditor_002, 'DIAMOND_SHD'],
  'Pure Gold': [copy.common.components_ConfigEditor_003, 'MTL_GOLD3'],
  'Battle Record': [copy.common.components_ConfigEditor_004, 'sprite_exp_card_t3'],
  'Originium Shard': [copy.common.components_ConfigEditor_005, 'MTL_DIAMOND_SHD'],
  'Orirock Cube': [copy.common.components_ConfigEditor_080, 'MTL_SL_G2'],
}

export function getProductIconSrc(product: string): string | undefined {
  const icon = PRODUCT_ICONS[product]?.[1]
    ?? Object.values(PRODUCT_ICONS).find(([label]) => label === product)?.[1]
  return icon ? `/assets/products/${icon}.png` : undefined
}

export default function ProductIcon({ product, size = 32 }: { product: string; size?: number }) {
  const src = getProductIconSrc(product)
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 object-contain"
    />
  )
}
