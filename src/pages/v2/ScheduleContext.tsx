import { NextIcon as ArrowRight, EditIcon as ArrowUpRight, DailyOutputIcon as CalendarClock, ManufactureIcon as Factory, PowerPlantIcon as Zap } from '../../components/icons'
import ProductIcon from '../../components/ProductIcon'
import { AnimatedValue } from '../../components/MotionPrimitives'
import { formatAmount, type PreparedResult } from '../../components/result-panel/formatters'
import { PRODUCT_LABELS } from '../../components/result-panel/labels'
import { copy } from '../../copy'
import { normalizeScheduleMode, parseShiftHours, SCHEDULE_MODE_LABELS } from '../../lib/config'
import type { LicenseConfig, LicenseOperator, OptimizeResult } from '../../lib/types'
import { Avatar } from './ScheduleBoard'
import TradingIcon from './TradingIcon'

const text = copy.v2

export default function ScheduleContext({ result, prepared, config, operators, sampleOperators, onConfigure, onOperators }: {
  result: OptimizeResult
  prepared: PreparedResult
  config: LicenseConfig
  operators: LicenseOperator[]
  sampleOperators: boolean
  onConfigure: () => void
  onOperators: () => void
}) {
  const shortTermOrundum = prepared.orundumEconomy?.short_term_orundum ?? prepared.productionStats.orundum
  const hours = parseShiftHours(config.shift_hours) ?? [8, 8, 8]
  return <aside className="v2-result-aside">
    <section className="v2-panel v2-production-panel">
      <div className="v2-panel-heading"><h2>{text.dailyOutput}</h2><span className="v2-output-clock"><CalendarClock size={16} aria-hidden="true" /></span></div>
      <div className="v2-output-grid">
        <OutputRow product="LMD" value={prepared.productionStats.lmd} available={prepared.hasDailyProduction} />
        <OutputRow product="Battle Record" value={prepared.productionStats.manufacturing['Battle Record'] ?? 0} available={prepared.hasDailyProduction} />
        <OutputRow product="Pure Gold" value={prepared.productionStats.manufacturing['Pure Gold'] ?? 0} available={prepared.hasDailyProduction} />
        {Object.keys(PRODUCT_LABELS).filter((product) => !['LMD', 'Battle Record', 'Pure Gold'].includes(product)).map((product) => {
          const value = (prepared.productionStats.manufacturing[product] ?? 0) + (product === 'Orundum' ? shortTermOrundum : result.daily_production?.trading?.[product] ?? 0)
          return value !== 0 ? <OutputRow key={product} product={product} value={value} /> : null
        })}
      </div>
    </section>
    <section className="v2-panel v2-config-panel">
      <div className="v2-panel-heading"><h2>{text.currentConfig}</h2><button className="v2-text-button" type="button" onClick={onConfigure}>{text.edit}<ArrowUpRight size={13} aria-hidden="true" /></button></div>
      <div className="v2-layout-preview" aria-hidden="true">
        {Array.from({ length: config.trading_stations_count }, (_, index) => <span className="v2-layout-trading" key={`t${index}`}><TradingIcon size={14} /></span>)}
        {Array.from({ length: config.manufacturing_stations_count }, (_, index) => <span className="v2-layout-manufacture" key={`m${index}`}><Factory size={14} /></span>)}
        {Array.from({ length: Math.max(0, 9 - config.trading_stations_count - config.manufacturing_stations_count) }, (_, index) => <span className="v2-layout-power" key={`p${index}`}><Zap size={14} /></span>)}
      </div>
      <dl className="v2-config-summary"><div><dt>{text.layout}</dt><dd>{config.layout}</dd></div><div><dt>{text.mode}</dt><dd>{SCHEDULE_MODE_LABELS[normalizeScheduleMode(config.schedule_mode)]}</dd></div>
        <div><dt>{text.duration}</dt><dd>{hours.join(' / ')}h</dd></div><div><dt>{text.drones}</dt><dd>{config.drones?.enable ? config.drones.auto ? text.automatic : text.manual : text.disabled}</dd></div></dl>
      <button className="v2-operator-summary" type="button" onClick={onOperators}><div className="v2-avatar-stack">{operators.slice(0, 4).map((operator) => <Avatar key={operator.id} operator={operator} small />)}</div><span><strong>{text.operatorData}</strong><small>{sampleOperators ? text.guestNavigation.sampleOwned(operators.length) : text.owned(operators.length)}</small></span><ArrowRight size={15} aria-hidden="true" /></button>
    </section>
  </aside>
}

function OutputRow({ product, value, available = true }: { product: string; value: number; available?: boolean }) {
  const experience = product === 'Battle Record'
  return <div className="v2-output-row"><span><ProductIcon product={product} size={29} /><span>{experience ? text.comparison.experience : PRODUCT_LABELS[product] ?? product}</span></span>
    <strong><AnimatedValue value={available ? formatAmount(experience ? value * 1000 : value) : '—'} /><small>{experience ? text.expUnit : text.daily}</small></strong></div>
}
