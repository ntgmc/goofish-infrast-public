import { useState } from 'react'
import { motion } from 'motion/react'
import { copy } from '../../copy'
import { ROOM_LABELS } from '../../components/result-panel/labels'
import { motionTokens } from '../../components/MotionPrimitives'
import SharedCardDialog from '../../components/ui/shared-card-dialog'
import { DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { useAppReducedMotion } from '../../lib/motion-preference'
import { buildingRatingCharacter, comboBuildingRatingRange, ratingMemberStatus, ratingVariantStatus, type RatingCombo, type RatingRoster, type RatingVariant, type SingleBuildingRating } from '../../lib/building-skill-ratings'
import type { LicenseConfig } from '../../lib/types'
import { Avatar } from './ScheduleBoard'
import { RatingBadge, RatingStageDetails, RatingVariantDetails } from './BuildingRatingDetails'

const text = copy.buildingRatings
export type BuildingRatingEntry = SingleBuildingRating | RatingCombo

function RatingIdentity({ entry, detail = false, variant }: { entry: BuildingRatingEntry; detail?: boolean; variant?: RatingVariant }) {
  const reduced = useAppReducedMotion()
  const combo = 'variants' in entry
  const name = combo ? entry.title : entry.name
  const range = variant ? { high: variant.score, low: undefined } : combo ? comboBuildingRatingRange(entry) : { high: entry.stage.assessment.score!, low: undefined }
  const primary = variant ?? (combo ? entry.variants.reduce((best, candidate) => candidate.score > best.score ? candidate : best) : null)
  const members = primary ? primary.members.filter((member) => member.room === entry.room) : []
  const portraits = combo ? (members.length ? members : primary!.members).slice(0, 4) : [{ id: entry.operatorId }]
  const provisional = variant ? variant.provisional : combo ? entry.variants.some((candidate) => candidate.provisional) : entry.stage.assessment.provisional
  const Name = detail ? motion.h2 : motion.strong
  const title = <Name layoutId={reduced ? undefined : `rating-name-${entry.id}`} transition={motionTokens.morph}>{name}</Name>
  return <>
    <motion.div className="v2-rating-artwork" data-combo={combo || undefined} layoutId={reduced ? undefined : `rating-portrait-${entry.id}`} transition={motionTokens.morph}>
      <div className="v2-rating-portraits" data-combo={combo || undefined} data-count={portraits.length}>
        {portraits.map((member) => <Avatar key={member.id} operator={{ id: member.id, name: buildingRatingCharacter(member.id).name }} />)}
      </div>
      <RatingBadge score={range.high} low={range.low} emblem />
      {provisional && <span className="v2-rating-provisional">{text.provisional}</span>}
    </motion.div>
    <div className="v2-rating-identity">{detail ? <DialogTitle asChild>{title}</DialogTitle> : title}
      <span>{combo ? entry.usage : entry.stage.assessment.usage}</span>
    </div>
  </>
}

export function BuildingRatingCard({ entry, roster, active, onOpen }: { entry: BuildingRatingEntry; roster: RatingRoster | null; active: boolean; onOpen: (source: HTMLElement) => void }) {
  const reduced = useAppReducedMotion()
  const combo = 'variants' in entry
  const member = combo ? null : { id: entry.operatorId, room: entry.room, elite: entry.stage.elite, level: entry.stage.level, station: 'main' }
  const state = member ? ratingMemberStatus(member, roster) : null
  const owned = combo ? entry.variants.some((variant) => ratingVariantStatus(variant, roster, null).membersOwned) : state !== 'missing'
  return <motion.article id={`rating-${entry.id}`} className="v2-rating-card" data-owned={roster ? owned : undefined}
    layoutId={reduced ? undefined : `rating-card-${entry.id}`} layoutDependency={active} style={{ borderRadius: 6 }} transition={motionTokens.morph}>
    <button type="button" className="v2-rating-card-trigger" aria-haspopup="dialog" aria-label={text.openDetails(combo ? entry.title : entry.name)}
      onClick={(event) => onOpen(event.currentTarget.parentElement!)} />
    <RatingIdentity entry={entry} />
    <div className="v2-rating-card-meta">
      <span>{combo ? text.variants(entry.variants.length) : copy.domain.building_skills.unlock(entry.stage.elite, entry.stage.level)}</span>
      {roster && <span className="v2-rating-state" data-state={state ?? (owned ? 'ready' : 'missing')}>{combo ? owned ? text.membersOwned : text.membersMissing : text.memberStates[state!]}</span>}
    </div>
  </motion.article>
}

export function BuildingRatingDialog({ entry, initialVariant, source, roster, config, profileId, onClose }: {
  entry: BuildingRatingEntry; initialVariant: number; source: HTMLElement | null; roster: RatingRoster | null; config: LicenseConfig | null; profileId?: string; onClose: () => void
}) {
  const [variantIndex, setVariantIndex] = useState(initialVariant)
  const combo = 'variants' in entry
  return <SharedCardDialog layoutId={`rating-card-${entry.id}`} source={source} onClose={onClose} closeLabel={copy.v2.close} className="v2-rating-dialog">
    <header className="v2-rating-dialog-heading"><RatingIdentity entry={entry} detail variant={combo ? entry.variants[variantIndex] : undefined} />
      <DialogDescription className="v2-rating-dialog-description">{ROOM_LABELS[entry.room] ?? entry.room} · {combo ? text.variants(entry.variants.length) : `${text.minimum} · ${copy.domain.building_skills.unlock(entry.stage.elite, entry.stage.level)}`}</DialogDescription>
    </header>
    {combo ? <div className="v2-rating-dialog-body">
      <label className="v2-field v2-rating-variant-picker"><span>{text.chooseVariant}</span><select className="v2-input" value={variantIndex} onChange={(event) => setVariantIndex(Number(event.target.value))}>
        {entry.variants.map((variant, index) => <option key={index} value={index}>{text.variantOption(index, variant.score, variant.members.filter((member) => member.room === entry.room).map((member) => buildingRatingCharacter(member.id).name).join(' / '))}</option>)}
      </select></label>
      <RatingVariantDetails variant={entry.variants[variantIndex]} index={variantIndex} roster={roster} config={config} />
    </div> : <RatingStageDetails stages={entry.stages} member={{ id: entry.operatorId, room: entry.room, elite: entry.stage.elite, level: entry.stage.level, station: 'main' }} roster={roster} profileId={profileId} />}
  </SharedCardDialog>
}
