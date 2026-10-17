export const sklandCopy = {
  refresh: '刷新森空岛数据',
  refreshing: '正在更新森空岛数据…',
  failed: '森空岛数据更新失败，请稍后重试。',
  updated: (time: string) => `森空岛数据更新于 ${time}`,
  stale: '正在更新，当前使用上次成功获取的数据。',
  expired: '森空岛数据已过期，请刷新后继续。',
} as const
