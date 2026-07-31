import { personalUseCopy } from '../copy/zh-CN/personal-use'

export type PersonalUseDeclarationAction = 'free_preview_claim' | 'metered_personal_create' | 'generated_result_export'

export type PersonalUseDeclarationSection = {
  id: string
  heading: string
  paragraphs: readonly string[]
  items: readonly string[]
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
