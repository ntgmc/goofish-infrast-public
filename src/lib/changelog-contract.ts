export interface ChangelogSection {
  id: string
  kind: 'custom' | 'feature' | 'fix' | 'performance' | 'security'
  title?: string
  items: readonly string[]
}

export interface ChangelogRelease {
  id: string
  version: string | null
  displayVersion: string
  releasedAt: string
  targetSha?: string
  previousTargetSha?: string | null
  kind: 'baseline' | 'release'
  sections: readonly ChangelogSection[]
}
