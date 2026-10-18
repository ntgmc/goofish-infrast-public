import type { CultivationData, CultivationTarget } from '../../src/lib/cultivation-contract'
import type { PrtsSnapshot } from './catalog'
import type { calculateCultivationRecommendations, prepareRecommendations } from './recommendations'

type Prepared = ReturnType<typeof prepareRecommendations>
type Result = ReturnType<typeof calculateCultivationRecommendations>
type Requirement = Prepared['families'][number]['documents'][number]['members'][number]['requirement']
type PackedRequirement = [string, CultivationTarget, number, boolean]
type PackedMember = [number, number, string | null, number[]]
type PackedPrepared = Omit<Prepared, 'families'> & { requirements: PackedRequirement[]; families: Array<{
  key: string; published: number; count: number;
  documents: Array<Omit<Prepared['families'][number]['documents'][number], 'members'> & { members: PackedMember[] }>
}> }

export function packPreparedEvidence(prepared: Prepared): PackedPrepared {
  const requirements: PackedRequirement[] = [], ids = new Map<string, number>()
  const index = (row: Requirement) => {
    const value: PackedRequirement = [row.operator!.id, row.target,
      Number(row.specified.training) | Number(row.specified.skill) << 1 | Number(row.specified.module) << 2, row.moduleUnresolved]
    const key = JSON.stringify(value)
    let id = ids.get(key)
    if (id === undefined) { id = requirements.length; requirements.push(value); ids.set(key, id) }
    return id
  }
  return { ...prepared, requirements, families: prepared.families.map((family) => ({ ...family,
    documents: family.documents.map((document) => ({ ...document, members: document.members.map((member) => [
      index(member.requirement), member.share, member.group,
      member.options.filter((row) => row.operator && !row.warnings.length).map(index),
    ]) })),
  })) }
}

export function unpackPreparedEvidence(packed: PackedPrepared, snapshot: PrtsSnapshot): Prepared {
  const requirements: Requirement[] = packed.requirements.map(([id, target, flags, moduleUnresolved]) => ({
    name: snapshot.operators[id].name, operator: { ...snapshot.operators[id], id }, target, warnings: [], moduleUnresolved,
    specified: { training: Boolean(flags & 1), skill: Boolean(flags & 2), module: Boolean(flags & 4) },
  }))
  return { invalid: packed.invalid, stages: packed.stages, professions: packed.professions,
    families: packed.families.map((family) => ({ ...family, documents: family.documents.map((document) => ({ ...document,
      members: document.members.map(([requirement, share, group, options]) => ({ requirement: requirements[requirement], share, group, options: options.map((id) => requirements[id]) })),
    })) })),
  }
}

// Each sample is stored once. Branches share integer references instead of retaining document graphs.
type PublicSample = [family: number, homeworkId: number, stage: number, weight: number, elite: number, masterySkill: number, group: number]
export type PublicRecommendations = Omit<Result, 'recommendations'> & {
  samples: PublicSample[]
  groups: Array<NonNullable<CultivationData['groups']>[number]>
  recommendations: Array<Omit<Result['recommendations'][number], 'samples'> & { samples: number[] }>
}

export function compactRecommendations(result: Result): PublicRecommendations {
  const samples: PublicSample[] = [], ids = new Map<Result['recommendations'][number]['samples'][number], number>()
  const groups: PublicRecommendations['groups'] = [], groupIds = new Map<string, number>()
  const stages = new Map(result.stages.map((row, index) => [row.id, index]))
  return { ...result, groups, samples, recommendations: result.recommendations.map((branch) => ({ ...branch,
    samples: branch.samples.map((sample) => {
      let id = ids.get(sample)
      if (id !== undefined) return id
      let group = -1
      if (sample.group !== null) {
        const value = { key: sample.group, options: sample.options.filter((row) => row.operator && !row.warnings.length)
          .map((row) => ({ operatorId: row.operator!.id, target: row.target, skillId: row.operator!.skills[row.target.skill - 1] ?? '' })) }
        const key = JSON.stringify(value)
        if (!groupIds.has(key)) { groupIds.set(key, groups.length); groups.push(value) }
        group = groupIds.get(key)!
      }
      id = samples.length
      samples.push([Number(sample.family), sample.document.homework.id, stages.get(sample.document.homework.stageId)!, sample.weight,
        sample.requirement.target.elite, sample.requirement.target.skillLevel > 7 ? sample.requirement.target.skill : 0, group])
      ids.set(sample, id)
      return id
    }),
  })) }
}
