import { createHash } from 'node:crypto'
import { PERSONAL_USE_DECLARATION, personalUseDeclarationContent, type PersonalUseDeclarationAction } from '../src/lib/personal-use-declaration'

export { type PersonalUseDeclarationAction }

export const CURRENT_PERSONAL_USE_DECLARATION = Object.freeze({
  ...PERSONAL_USE_DECLARATION,
  content: personalUseDeclarationContent(PERSONAL_USE_DECLARATION),
  contentHash: createHash('sha256').update(personalUseDeclarationContent(PERSONAL_USE_DECLARATION), 'utf8').digest('hex'),
})

export type PublicPersonalUseDeclaration = Pick<
  typeof CURRENT_PERSONAL_USE_DECLARATION,
  'id' | 'version' | 'effectiveDate' | 'title' | 'sections' | 'contentHash'
>

export function toPublicPersonalUseDeclaration(): PublicPersonalUseDeclaration {
  const { content: _content, ...document } = CURRENT_PERSONAL_USE_DECLARATION
  return document
}

export function isCurrentPersonalUseDeclarationEffective(now = new Date()): boolean {
  return now.getTime() >= Date.parse(`${CURRENT_PERSONAL_USE_DECLARATION.effectiveDate}T00:00:00.000+08:00`)
}
