import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const DEFAULT_DESCRIPTION = '使用森空岛数据和 MAA 配置生成明日方舟基建排班，查看日产出等效理智、练度建议与仓库资产估值。'
const SOCIAL_IMAGE_PATH = '/assets/logo.png'

type Metadata = {
  title: string
  description: string
  indexable: boolean
}

const PUBLIC_METADATA: Record<string, Metadata> = {
  '/': {
    title: 'MAA 基建排班优化器 | MaaTool',
    description: DEFAULT_DESCRIPTION,
    indexable: true,
  },
  '/announcements': {
    title: '公告 | MaaTool',
    description: '查看 MaaTool 的功能更新、服务通知和使用公告。',
    indexable: true,
  },
  '/faq': {
    title: '常见问题 | MaaTool',
    description: '了解 MaaTool 的账号、CDK、森空岛导入、MAA JSON 和仓库估值使用方式。',
    indexable: true,
  },
  '/support': {
    title: '联系客服 | MaaTool',
    description: '通过 MaaTool QQ 群获取使用帮助、提交问题反馈或申请删除账号与工作台数据。',
    indexable: true,
  },
  '/privacy': {
    title: '隐私政策 | MaaTool',
    description: '了解 MaaTool 为提供排班服务而处理的信息及你的相关权利。',
    indexable: true,
  },
  '/terms': {
    title: '用户服务协议 | MaaTool',
    description: '阅读 MaaTool 账号、CDK、森空岛导入和排班功能的用户服务协议。',
    indexable: true,
  },
  '/disclaimer': {
    title: '免责声明 | MaaTool',
    description: '了解 MaaTool 排班建议、第三方服务与知识产权相关的使用边界。',
    indexable: true,
  },
  '/tools/schedule-analysis': {
    title: '排班表分析 | MaaTool',
    description: '上传干员数据和已有排班表，分析明日方舟基建排班的风险与产出。',
    indexable: true,
  },
  '/tools/depot-value': {
    title: '仓库价值分析器 | MaaTool',
    description: '上传 MAA 仓库 JSON，按等价理智估算明日方舟仓库资产并生成分享图。',
    indexable: true,
  },
}

const PRIVATE_METADATA: Metadata = {
  title: 'MaaTool 工作台',
  description: 'MaaTool 工作台。',
  indexable: false,
}

export default function RouteMetadata() {
  const location = useLocation()

  useEffect(() => {
    const metadata = resolveMetadata(location.pathname)
    const canonicalUrl = canonicalUrlFor(location.pathname)
    const socialImageUrl = new URL(SOCIAL_IMAGE_PATH, canonicalUrl).href

    document.title = metadata.title
    setMetaByName('description', metadata.description)
    setMetaByName('robots', metadata.indexable ? 'index, follow' : 'noindex, nofollow')
    setMetaByProperty('og:type', 'website')
    setMetaByProperty('og:title', metadata.title)
    setMetaByProperty('og:description', metadata.description)
    setMetaByProperty('og:url', canonicalUrl)
    setMetaByProperty('og:image', socialImageUrl)
    setMetaByName('twitter:card', 'summary')
    setMetaByName('twitter:title', metadata.title)
    setMetaByName('twitter:description', metadata.description)
    setMetaByName('twitter:image', socialImageUrl)
    setCanonical(canonicalUrl)
  }, [location.pathname])

  return null
}

function resolveMetadata(pathname: string): Metadata {
  if (PUBLIC_METADATA[pathname]) return PUBLIC_METADATA[pathname]
  return PRIVATE_METADATA
}

function canonicalUrlFor(pathname: string): string {
  return new URL(pathname, window.location.origin).href
}

function setMetaByName(name: string, content: string): void {
  const meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`) ?? createMeta('name', name)
  meta.content = content
}

function setMetaByProperty(property: string, content: string): void {
  const meta = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`) ?? createMeta('property', property)
  meta.content = content
}

function createMeta(attribute: 'name' | 'property', value: string): HTMLMetaElement {
  const meta = document.createElement('meta')
  meta.setAttribute(attribute, value)
  document.head.append(meta)
  return meta
}

function setCanonical(url: string): void {
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? document.createElement('link')
  canonical.rel = 'canonical'
  canonical.href = url
  if (!canonical.parentElement) document.head.append(canonical)
}
