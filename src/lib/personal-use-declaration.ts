import { personalUseCopy } from '../copy/zh-CN/personal-use'

export const PERSONAL_USE_DECLARATION_ACTIONS = [
  'free_preview_claim',
  'metered_personal_create',
  'generated_result_export',
  'optimization_generate',
  'reorder_check',
] as const

export type PersonalUseDeclarationAction = typeof PERSONAL_USE_DECLARATION_ACTIONS[number]

export type PersonalUseDeclarationUsageAction = PersonalUseDeclarationAction

export type PersonalUseDeclarationSection = {
  id: string
  heading: string
  paragraphs: readonly string[]
  items: readonly string[]
}

export type PublicPersonalUseDeclaration = {
  id: string
  version: string
  effectiveDate: string
  title: string
  sections: readonly PersonalUseDeclarationSection[]
  contentHash: string
}

export const PERSONAL_USE_DECLARATION = Object.freeze({
  id: 'personal_use_v1_1',
  version: 'V1.1',
  effectiveDate: '2026-07-31',
  title: personalUseCopy.declaration_title,
  sections: personalUseCopy.sections as readonly PersonalUseDeclarationSection[],
})

export function personalUseDeclarationContent(document = PERSONAL_USE_DECLARATION): string {
  return [
    document.title,
    `${document.version} / ${document.effectiveDate}`,
    ...document.sections.flatMap((section) => [section.heading, ...section.paragraphs, ...section.items]),
  ].join('\n')
}
