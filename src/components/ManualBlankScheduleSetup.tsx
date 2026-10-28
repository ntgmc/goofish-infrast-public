import { useId } from 'react'
import { ExpandIcon as ChevronDown, NextIcon as ArrowRight, ManufactureIcon, TradingStationIcon, PowerPlantIcon } from './icons'
import { copy } from '../copy'
import { CONFIG_PRESETS } from '../lib/config'
import type { LicenseConfig } from '../lib/types'
import FacilityLayoutEditor from './FacilityLayoutEditor'
import { PRODUCT_LABELS } from './result-panel/labels'
import './ManualBlankScheduleSetup.css'

export default function ManualBlankScheduleSetup({ config, preset, enabled, onPresetChange, onUpdate, onStart }: {
  config: LicenseConfig;
  preset: string;
  enabled: boolean;
  onPresetChange: (preset: string) => void;
  onUpdate: (mutate: (config: LicenseConfig) => void) => void;
  onStart: () => void;
}) {
  const label = copy.tools.manualSchedule
  const group = useId()
  const selected = preset ? CONFIG_PRESETS[preset].desc : label.currentLayout
  const facilities = [
    { type: 'trading', icon: TradingStationIcon, name: copy.common.facilityLayoutTrading,
      count: config.trading_stations_count, products: config.product_requirements.trading_stations },
    { type: 'manufacture', icon: ManufactureIcon, name: copy.common.facilityLayoutManufacture,
      count: config.manufacturing_stations_count, products: config.product_requirements.manufacturing_stations },
    { type: 'power', icon: PowerPlantIcon, name: copy.common.facilityLayoutPower,
      count: 9 - config.trading_stations_count - config.manufacturing_stations_count, products: {} },
  ]
  return (
    <details className="manual-blank-setup">
      <summary>
        <strong>{label.blankSettings}</strong>
        <span className="manual-blank-selected">{selected}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="manual-blank-body">
        <fieldset className="manual-blank-presets" disabled={!enabled}>
          <legend>{label.layout}</legend>
          <label className="manual-blank-current">
            <input type="radio" name={group} value="" checked={preset === ''} onChange={() => onPresetChange('')} />
            <span>{label.currentLayout}</span>
          </label>
          <div className="manual-blank-groups">
            {['2-4-3', '2-5-2', '3-3-3'].map((layout) => (
              <div className="manual-blank-group" key={layout}>
                <p className="manual-blank-layout">{layout}</p>
                {Object.entries(CONFIG_PRESETS).filter(([, config]) => config.layout === layout).map(([key, config]) => (
                  <label key={key} className="manual-blank-option">
                    <input type="radio" name={group} value={key} checked={preset === key} onChange={() => onPresetChange(key)} />
                    <span>{config.desc}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        <dl className="manual-blank-facilities" aria-label={label.facilities}>
          {facilities.map(({ type, icon: Icon, name, count, products }) => (
            <div key={type} className={`manual-blank-facility manual-blank-facility--${type}`}>
              <dt><Icon size={18} aria-hidden="true" />{name}</dt>
              <dd className="manual-blank-count">{count}</dd>
              <dd className="manual-blank-products">{Object.entries(products).map(([product, count]) => `${PRODUCT_LABELS[product]} × ${count}`).join(' · ')}</dd>
            </div>
          ))}
        </dl>
        {config.layout === '2-5-2' && <FacilityLayoutEditor key={preset} config={config} onUpdate={onUpdate} readOnly={!enabled} />}
        <div className="manual-blank-footer">
          <p>{label.configHint}</p>
          <button type="button" className="tool-primary-action" disabled={!enabled} onClick={onStart}>
            {label.start}<ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </details>
  )
}
