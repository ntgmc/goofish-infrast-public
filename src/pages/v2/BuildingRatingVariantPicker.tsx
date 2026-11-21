import { useState } from 'react'
import { copy } from '../../copy'
import { buildingRatingCharacter, buildingRatingGrade, comboBuildingRatingCore, ratingMemberStatus, type RatingCombo, type RatingMember, type RatingRoster } from '../../lib/building-skill-ratings'

const text = copy.buildingRatings
const key = (member: RatingMember) => `${member.id}:${member.elite}:${member.level}`
const unlock = (member: RatingMember) => copy.domain.building_skills.stage(member.elite, member.level, buildingRatingCharacter(member.id).rarity <= 2)

export default function BuildingRatingVariantPicker({ combo, index, onChange, roster }: { combo: RatingCombo; index: number; onChange: (index: number) => void; roster: RatingRoster | null }) {
  const [order, setOrder] = useState<string[]>([])
  if (!combo.partnerSlots) return combo.variants.length > 1 && <label className="v2-field v2-rating-variant-picker"><span>{text.chooseVariant}</span><select className="v2-input" value={index} onChange={(event) => onChange(Number(event.target.value))}>
    {combo.variants.map((variant, variantIndex) => <option key={variantIndex} value={variantIndex}>{text.variantOption(variantIndex, variant.score, variant.members.filter((member) => member.room === combo.room).map((member) => `${buildingRatingCharacter(member.id).name}（${unlock(member)}）`).join(' / '))}{variant.requirements.powerCountExact !== undefined && ` · ${text.powerStations(Number(variant.requirements.powerCountExact))}`}</option>)}
  </select></label>
  const core = comboBuildingRatingCore(combo)
  const coreIds = new Set(core.map((member) => member.id))
  const partnerSets = combo.variants.map((item) => item.members.filter((member) => member.room === combo.room && !coreIds.has(member.id)))
  const partners = (variantIndex: number) => partnerSets[variantIndex]
  const variant = combo.variants[index]
  const recipes = [...new Set(combo.variants.map((item) => item.recipe).filter((recipe) => recipe !== undefined))]
  const currentKeys = partners(index).map(key)
  const selected = order.filter((value) => currentKeys.includes(value))
  for (const value of currentKeys) if (!selected.includes(value)) selected.push(value)
  const options = [...new Map(combo.variants.filter((item) => item.recipe === variant.recipe).flatMap((item) => item.members.filter((member) => member.room === combo.room && !coreIds.has(member.id)).map((member) => [key(member), member] as const))).values()]
    .sort((a, b) => buildingRatingCharacter(a.id).name.localeCompare(buildingRatingCharacter(b.id).name, 'zh-CN') || a.elite - b.elite)
  const variantByPartners = new Map(combo.variants.flatMap((item, candidate) => item.recipe === variant.recipe ? [[partners(candidate).map(key).sort().join('|'), candidate] as const] : []))
  const candidateFor = (slot: number, value: string) => {
    const desired = [...selected]
    desired[slot] = value
    const exact = variantByPartners.get(desired.filter(Boolean).sort().join('|')) ?? -1
    const next = exact >= 0 ? exact : combo.variants.findIndex((item, candidate) => item.recipe === variant.recipe && partners(candidate).some((member) => key(member) === value))
    return { next, desired, changesPartner: exact < 0 }
  }
  const choose = (slot: number, value: string) => {
    const { next, desired } = candidateFor(slot, value)
    if (next < 0) return
    const nextKeys = partners(next).map(key)
    const nextOrder = desired.map((item) => nextKeys.includes(item) ? item : '')
    for (let position = 0; position < nextOrder.length; position++) if (!nextOrder[position]) nextOrder[position] = nextKeys.find((item) => !nextOrder.includes(item)) ?? ''
    setOrder(nextOrder)
    onChange(next)
  }
  return <fieldset className="v2-rating-partner-picker">
    <legend>{text.corePartners}</legend>
    <p className="v2-rating-core">{text.fixedCore}：<strong>{core.map((member) => `${buildingRatingCharacter(member.id).name}（${unlock(member)}）`).join(' / ')}</strong><span>{text.partnerHelp}</span></p>
    <label className="v2-field"><span>{text.recipe}</span><select className="v2-input" value={variant.recipe} onChange={(event) => {
      const recipe = event.target.value
      const next = combo.variants.findIndex((item, candidate) => item.recipe === recipe && partners(candidate).map(key).sort().join('|') === [...currentKeys].sort().join('|'))
      onChange(next < 0 ? combo.variants.findIndex((item) => item.recipe === recipe) : next)
    }}>{recipes.map((recipe) => <option key={recipe} value={recipe}>{text[recipe]}</option>)}</select></label>
    {Array.from({ length: combo.partnerSlots }, (_, slot) => {
      const choices = options.map((member) => ({ member, ...candidateFor(slot, key(member)), disabled: selected.some((value, otherSlot) => otherSlot !== slot && value.split(':')[0] === member.id) }))
        .sort((a, b) => Number(a.disabled) - Number(b.disabled) || combo.variants[b.next].score - combo.variants[a.next].score || combo.variants[b.next].production! - combo.variants[a.next].production!)
      const without = candidateFor(slot, '')
      return <label className="v2-field" key={slot}><span>{text.partner(slot)}</span><select className="v2-input" value={selected[slot] ?? ''} onChange={(event) => choose(slot, event.target.value)}>
        {slot > 0 && <option value="" disabled={without.next < 0}>{text.noPartner}{without.next >= 0 && ` · ${text.partnerRating(buildingRatingGrade(combo.variants[without.next].score), combo.variants[without.next].score, combo.variants[without.next].production!)}`}</option>}
        {choices.map(({ member, next, changesPartner, disabled }) => <option key={key(member)} value={key(member)} disabled={disabled}>
          {text.partnerRating(buildingRatingGrade(combo.variants[next].score), combo.variants[next].score, combo.variants[next].production!)} · {buildingRatingCharacter(member.id).name}（{unlock(member)}）{changesPartner && ` · ${text.changesPartner}`}{roster && ` · ${text.memberStates[ratingMemberStatus(member, roster)]}`}
        </option>)}
      </select></label>
    })}
  </fieldset>
}
