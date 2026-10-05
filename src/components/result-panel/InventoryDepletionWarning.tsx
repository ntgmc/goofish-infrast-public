import { copy } from '../../copy'
import { inventoryDepletionWarnings } from '../../lib/inventory-warnings'
import type { OptimizeResult } from '../../lib/types'
import { formatAmount } from './formatters'
import { PRODUCT_LABELS } from './labels'

export default function InventoryDepletionWarning({ result }: { result: OptimizeResult }) {
  const warnings = result.inventory_warnings ?? inventoryDepletionWarnings(result.intermediate_depletion)
  if (warnings.length === 0) return null
  const text = copy.domain.inventory_warning

  return (
    <div className="tool-alert tool-alert--warning p-4 text-sm leading-6" role="alert">
      <p className="font-semibold">{text.title}</p>
      <ul className="mt-1 space-y-1">
        {warnings.map(({ product, days_remaining: days }) => (
          <li key={product}>{days <= 0
            ? text.depleted(PRODUCT_LABELS[product])
            : days < 1
              ? text.depletes_today(PRODUCT_LABELS[product])
              : text.depletes_in_days(PRODUCT_LABELS[product], formatAmount(days))}</li>
        ))}
      </ul>
      <p className="mt-2">{text.action}</p>
    </div>
  )
}
