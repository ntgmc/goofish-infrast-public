// Route titles and loading states must stay independent of lazy page catalogs.
export const routesCopy = {
  labels: {
    overview: '排班总览', generation: '生成与计算', plans: '历史方案', lab: '方案对比', tools: '实用工具',
    'manual-tool': '手动排班模拟', 'schedule-comparison': '排班表对比', 'training-ratio': '钱书平衡建议',
    cultivation: '作业练度推荐', 'thanks-recruitment': '感谢庆典特别招募推荐', 'cultivation-projects': '我的养成项目',
    depot: '仓库价值分析', skland: '森空岛数据', profiles: '账号与档案', 'add-account': '添加账号', inventory: '背包',
    commercial: '商用账户', balance: '积分', announcements: '查看公告', settings: '账号设置',
    help: '使用指南', updates: '更新日志', terms: '服务条款', privacy: '隐私政策',
    disclaimer: '免责声明', support: '反馈', status: '服务状态', pricing: '比较价格与权益', benchmarks: '站点对比',
  },
  descriptions: {
    'training-ratio': '根据当前龙门币和经验库存，判断接下来优先补哪一项。',
    cultivation: '对照 PRTS 作业需求与当前练度，找到值得培养的干员。选好目标后加入我的养成项目，继续安排材料和准备进度。',
  },
  loading: {
    status: '正在读取服务状态…',
    'manual-tool': '正在加载手动排班工具',
    'training-ratio': '正在加载钱书平衡建议…',
    cultivation: '正在加载作业练度推荐',
    'thanks-recruitment': '正在加载特别招募推荐',
  },
  v2: {
    brand: 'MaaTool', brandDescription: '基建排班工具', testVersion: 'V2',
    resultDescription: '查看干员排班和预计产出，按需调整配置并生成新方案。',
    loading: '正在加载排班…', retry: '重新读取',
  },
} as const
