import { expect, it } from 'vitest'
import { operatorBuildingSkills } from './building-skills'

it('keeps level-dependent skills unknown until training is known without hiding confirmed unlocks', () => {
  const robot = { name: 'Castle-3', elite: 0 }
  const pending = operatorBuildingSkills(robot)
  expect(pending.find((skill) => skill.room === 'power')).toMatchObject({ state: 'active' })
  expect(pending.find((skill) => skill.room === 'manufacture')).toMatchObject({ state: 'unknown' })
  expect(operatorBuildingSkills({ ...robot, level: 29 }).find((skill) => skill.room === 'manufacture')).toMatchObject({ state: 'locked' })
  expect(operatorBuildingSkills({ ...robot, level: '30' }).find((skill) => skill.room === 'manufacture')).toMatchObject({ state: 'active' })
  expect(operatorBuildingSkills({ ...robot, level: '' }).find((skill) => skill.room === 'manufacture')).toMatchObject({ state: 'unknown' })
})

it('recognizes replacements and guaranteed earlier unlocks even when the current level is unknown', () => {
  const skills = operatorBuildingSkills({ name: '但书', elite: 2 })
  expect(skills.find((skill) => skill.name === '违约索赔·α')).toMatchObject({ state: 'upgraded' })
  expect(skills.find((skill) => skill.name === '违约索赔·β')).toMatchObject({ state: 'active' })
  expect(operatorBuildingSkills({ name: '但书' }).every((skill) => skill.state === 'unknown')).toBe(true)
  expect(operatorBuildingSkills({ name: '杜林', elite: 0 }).every((skill) => skill.state === 'unknown')).toBe(true)
  expect(operatorBuildingSkills({ name: '杜林', elite: 0, level: 30 }).map((skill) => skill.state)).toEqual(['upgraded', 'active'])
})
