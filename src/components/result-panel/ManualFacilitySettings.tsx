import { useId } from 'react'
import { copy } from '../../copy'
import type { OptimizeResult } from '../../lib/types'
import { ControlRoomIcon, TradingStationIcon, ManufactureIcon, PowerPlantIcon, MeetingRoomIcon, ProcessingRoomIcon, RecruitmentIcon, TrainingRoomIcon, DormitoryIcon, ExpandIcon, type LucideIcon } from '../icons'
import ProductIcon from '../ProductIcon'
import { Tabs } from '../ui/tabs'
import { PRODUCT_LABELS, ROOM_LABELS } from './labels'
import './ManualFacilitySettings.css'

const icons: Record<string, LucideIcon> = {
  control: ControlRoomIcon, trading: TradingStationIcon, manufacture: ManufactureIcon, power: PowerPlantIcon,
  meeting: MeetingRoomIcon, processing: ProcessingRoomIcon, hire: RecruitmentIcon, training: TrainingRoomIcon,
  recycling: ProcessingRoomIcon, dormitory: DormitoryIcon,
}
const groups = {
  production: ['trading', 'manufacture', 'power'],
  support: ['control', 'meeting', 'hire', 'processing', 'training', 'recycling'],
  dormitory: ['dormitory'],
} as const

export default function ManualFacilitySettings({ rooms, onChange }: {
  rooms: OptimizeResult['plans'][number]['rooms'];
  onChange: (type: string, index: number, settings: { level?: number; product?: string }) => void;
}) {
  const label = copy.tools.manualSchedule
  const id = useId()
  return <details className="manual-facilities" open>
    <summary><span>{label.facilities}</span><ExpandIcon size={18} aria-hidden="true" /></summary>
    <p className="manual-facilities-hint">{label.facilitiesHint}</p>
    <Tabs.Root defaultValue="production">
      <Tabs.List className="manual-facility-tabs" aria-label={label.facilities}>
        {Object.keys(groups).map((group) => <Tabs.Trigger key={group} value={group}>
          {label.facilityGroups[group as keyof typeof groups]}
        </Tabs.Trigger>)}
      </Tabs.List>
      {Object.entries(groups).map(([group, types]) => <Tabs.Content key={group} value={group}>
        <div className="manual-facility-columns" aria-hidden="true"><span>{label.layout}</span><span>{label.level}</span><span>{group === 'production' ? label.product : ''}</span></div>
        <div className="manual-facility-rows">
          {types.flatMap((type) => {
            const entries = type === 'recycling' && !rooms.recycling?.length ? [{ level: 0, operators: [] }] : rooms[type] ?? []
            return entries.map((room, index) => {
              const name = `${ROOM_LABELS[type]} ${index + 1}`
              const Icon = icons[type]
              const products = type === 'trading' ? ['LMD', 'Orundum'] : type === 'manufacture' ? ['Pure Gold', 'Battle Record', 'Originium Shard'] : []
              const level = room.level ?? (type === 'control' || type === 'dormitory' ? 5 : 3)
              const levels = type === 'control' || type === 'dormitory' ? [1, 2, 3, 4, 5] : type === 'recycling' ? [0, 1, 2, 3] : [1, 2, 3]
              const product = room.product ?? (type === 'trading' ? 'LMD' : 'Battle Record')
              return <div key={`${type}:${index}`} className={`manual-facility-row manual-facility-row--${type}`} data-product={products.length > 0}>
                <div className="manual-facility-name"><Icon size={20} aria-hidden="true" /><strong>{ROOM_LABELS[type]}</strong><span>{String(index + 1).padStart(2, '0')}</span></div>
                <fieldset className="manual-facility-level" aria-label={`${name} · ${label.level}`}>
                  <legend>{label.level}</legend>
                  <div>{levels.map((value) => <label key={value}>
                    <input type="radio" name={`${id}:${type}:${index}`} value={value} checked={level === value}
                      onChange={() => onChange(type, index, { level: value })} />
                    <span>{value === 0 ? copy.domain.recycling.disabled : `Lv.${value}`}</span>
                  </label>)}</div>
                </fieldset>
                {products.length > 0 && <label className="manual-facility-product">
                  <span>{label.product}</span>
                  <div><ProductIcon product={product} size={24} />
                    <select aria-label={`${name} · ${label.product}`} value={product} onChange={(event) => onChange(type, index, { product: event.target.value })}>
                      {products.map((product) => <option key={product} value={product}>{PRODUCT_LABELS[product]}</option>)}
                    </select>
                  </div>
                </label>}
              </div>
            })
          })}
        </div>
      </Tabs.Content>)}
    </Tabs.Root>
  </details>
}
