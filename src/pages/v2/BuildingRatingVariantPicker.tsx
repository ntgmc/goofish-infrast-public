import { useState } from 'react'
import { copy } from '../../copy'
import { buildingRatingCharacter, comboBuildingRatingCore, ratingMemberStatus, type RatingCombo, type RatingMember, type RatingRoster } from '../../lib/building-skill-ratings'

const text = copy.buildingRatings
const key = (member: RatingMember) => `${member.id}:${member.elite}:${member.level}`

export default function BuildingRatingVariantPicker({ combo, index, onChange, roster }: { combo: RatingCombo; index: number; onChange: (index: number) => void; roster: RatingRoster | null }) {
  const [order, setOrder] = useState<string[]>([])
  if (!combo.partnerSlots) return combo.variants.length > 1 && <label className="v2-field v2-rating-variant-picker"><span>{text.chooseVariant}</span><select className="v2-input" value={index} onChange={(event) => onChange(Number(event.target.value))}>
    {combo.variants.map((variant, variantIndex) => <option key={variantIndex} value={variantIndex}>{text.variantOption(variantIndex, variant.score, variant.members.filter((member) => member.room === combo.room).map((member) => buildingRatingCharacter(member.id).name).join(' / '))}</option>)}
  </select></label>
  const core = comboBuildingRatingCore(combo)
  const coreIds = new Set(core.map((member) => member.id))
  const partners = (variantIndex: number) => combo.variants[variantIndex].members.filter((member) => member.room === combo.room && !coreIds.has(member.id))
  const variant = combo.variants[index]
  const currentKeys = partners(index).map(key)
  const selected = order.filter((value) => currentKeys.includes(value))
  for (const value of currentKeys) if (!selected.includes(value)) selected.push(value)
  const options = [...new Map(combo.variants.filter((item) => item.recipe === variant.recipe).flatMap((item) => item.members.filter((member) => member.room === combo.room && !coreIds.has(member.id)).map((member) => [key(member), member] as const))).values()]
    .sort((a, b) => buildingRatingCharacter(a.id).name.localeCompare(buildingRatingCharacter(b.id).name, 'zh-CN') || a.elite - b.elite)
  const choose = (slot: number, value: string) => {
    const desired = [...selected]
    desired[slot] = value
    const keys = desired.filter(Boolean)
    const matches = (candidate: number) => {
      const items = partners(candidate).map(key)
      return items.length === keys.length && keys.every((item) => items.includes(item))
    }
    let next = combo.variants.findIndex((item, candidate) => item.recipe === variant.recipe && matches(candidate))
    if (next < 0) next = combo.variants.findIndex((item, candidate) => item.recipe === variant.recipe && partners(candidate).some((member) => key(member) === value))
    if (next < 0) return
    setOrder(desired)
    onChange(next)
  }
  return <fieldset className="v2-rating-partner-picker">
    <legend>{text.corePartners}</legend>
    <p className="v2-rating-core">{text.fixedCore}：<strong>{core.map((member) => buildingRatingCharacter(member.id).name).join(' / ')}</strong><span>{text.partnerHelp}</span></p>
    <label className="v2-field"><span>{text.recipe}</span><select className="v2-input" value={variant.recipe} onChange={(event) => {
      const recipe = event.target.value
      const next = combo.variants.findIndex((item, candidate) => item.recipe === recipe && partners(candidate).map(key).sort().join('|') === [...currentKeys].sort().join('|'))
      onChange(next < 0 ? combo.variants.findIndex((item) => item.recipe === recipe) : next)
    }}><option value="gold">{text.gold}</option><option value="exp">{text.exp}</option></select></label>
    {Array.from({ length: combo.partnerSlots }, (_, slot) => <label className="v2-field" key={slot}><span>{text.partner(slot)}</span><select className="v2-input" value={selected[slot] ?? ''} onChange={(event) => choose(slot, event.target.value)}>
      {slot > 0 && <option value="">{text.noPartner}</option>}
      {options.map((member) => <option key={key(member)} value={key(member)} disabled={selected.some((value, otherSlot) => otherSlot !== slot && value.split(':')[0] === member.id)}>
        {buildingRatingCharacter(member.id).name} · {copy.domain.building_skills.unlock(member.elite, member.level)}{roster && ` · ${text.memberStates[ratingMemberStatus(member, roster)]}`}
      </option>)}
    </select></label>)}
  </fieldset>
}
