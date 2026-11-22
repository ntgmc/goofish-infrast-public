import { copy } from '../copy'
import { PERSONAL_USE_DECLARATION } from './personal-use-declaration'

export type PublicInfoPageKind = 'faq' | 'support' | 'privacy' | 'terms' | 'disclaimer'

export const EFFECTIVE_DATE = copy.public.pages_PublicInfoPage_001

type LegalSection = {
  id: string
  heading: string
  paragraphs: readonly string[]
  items?: readonly string[]
}

export const legalContent: Record<Exclude<PublicInfoPageKind, 'faq' | 'support'>, readonly LegalSection[]> = {
  privacy: [
    {
      id: 'processed-information',
      heading: copy.public.pages_PublicInfoPage_018,
      paragraphs: [
        copy.public.pages_PublicInfoPage_019,
        copy.public.pages_PublicInfoPage_020,
        copy.public.pages_PublicInfoPage_021,
      ],
    },
    {
      id: 'purpose-and-third-parties',
      heading: copy.public.pages_PublicInfoPage_022,
      paragraphs: [
        copy.public.pages_PublicInfoPage_023,
        copy.public.pages_PublicInfoPage_024,
      ],
    },
    {
      id: 'behavior-risk-controls',
      heading: copy.public.pages_PublicInfoPage_101,
      paragraphs: [
        copy.public.pages_PublicInfoPage_102,
        copy.public.pages_PublicInfoPage_103,
        copy.public.pages_PublicInfoPage_104,
        copy.public.pages_PublicInfoPage_105,
      ],
    },
    {
      id: 'storage-security-rights',
      heading: copy.public.pages_PublicInfoPage_025,
      paragraphs: [
        copy.public.pages_PublicInfoPage_026,
        copy.public.pages_PublicInfoPage_027,
      ],
    },
    {
      id: 'personal-use-confirmation-records',
      heading: copy.personalUse.terms_personal_use_heading,
      paragraphs: [copy.personalUse.privacy_acceptance_notice],
    },
  ],
  terms: [
    {
      id: 'service-description',
      heading: copy.public.pages_PublicInfoPage_028,
      paragraphs: [
        copy.public.pages_PublicInfoPage_029,
        copy.public.pages_PublicInfoPage_030,
      ],
    },
    {
      id: 'user-obligations',
      heading: copy.public.pages_PublicInfoPage_031,
      paragraphs: [
        copy.public.pages_PublicInfoPage_032,
        copy.public.pages_PublicInfoPage_033,
      ],
    },
    {
      id: 'service-limitations',
      heading: copy.public.pages_PublicInfoPage_034,
      paragraphs: [
        copy.public.pages_PublicInfoPage_035,
        copy.public.pages_PublicInfoPage_036,
      ],
    },
    {
      id: 'personal-use-declaration',
      heading: copy.personalUse.terms_personal_use_heading,
      paragraphs: [copy.personalUse.terms_personal_use_intro],
    },
    ...PERSONAL_USE_DECLARATION.sections,
  ],
  disclaimer: [
    {
      id: 'reference-only',
      heading: copy.public.pages_PublicInfoPage_037,
      paragraphs: [
        copy.public.pages_PublicInfoPage_038,
        copy.public.pages_PublicInfoPage_039,
      ],
    },
    {
      id: 'third-parties-and-ip',
      heading: copy.public.pages_PublicInfoPage_040,
      paragraphs: [
        copy.public.pages_PublicInfoPage_041,
        copy.public.pages_PublicInfoPage_042,
      ],
    },
  ],
}

export const pageMeta: Record<PublicInfoPageKind, { title: string; eyebrow: string; intro: string }> = {
  faq: { title: copy.public.pages_PublicInfoPage_043, eyebrow: copy.public.pages_PublicInfoPage_044, intro: copy.public.pages_PublicInfoPage_045 },
  support: { title: copy.public.pages_PublicInfoPage_046, eyebrow: copy.public.pages_PublicInfoPage_047, intro: copy.public.pages_PublicInfoPage_048 },
  privacy: { title: copy.public.pages_PublicInfoPage_049, eyebrow: copy.public.pages_PublicInfoPage_050, intro: copy.public.pages_PublicInfoPage_051 },
  terms: { title: copy.public.pages_PublicInfoPage_052, eyebrow: copy.public.pages_PublicInfoPage_053, intro: copy.public.pages_PublicInfoPage_054 },
  disclaimer: { title: copy.public.pages_PublicInfoPage_055, eyebrow: copy.public.pages_PublicInfoPage_056, intro: copy.public.pages_PublicInfoPage_057 },
}
