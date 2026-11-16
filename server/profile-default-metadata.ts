export const DEFAULT_PROFILE_DISPLAY_NAME = '个人排班'
export const LEGACY_FREE_PROFILE_DISPLAY_NAME = '免费个人排班'
export const LEGACY_FREE_PROFILE_NOTE = '已绑定森空岛的免费个人排班档案。'

export function getUpgradedProfileMetadata(profile: { display_name: string; note: string }) {
  return {
    display_name: !profile.display_name || profile.display_name === LEGACY_FREE_PROFILE_DISPLAY_NAME
      ? DEFAULT_PROFILE_DISPLAY_NAME : profile.display_name,
    note: profile.note === LEGACY_FREE_PROFILE_NOTE ? '' : profile.note,
  }
}
