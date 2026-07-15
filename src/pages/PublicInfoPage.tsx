import BrandLogo from '../components/BrandLogo'
import PublicFooter, { SupportGroupLink } from '../components/PublicFooter'
import { Link } from 'react-router-dom'

export type PublicInfoPageKind = 'faq' | 'support' | 'privacy' | 'terms' | 'disclaimer'

const EFFECTIVE_DATE = '2026年7月14日'

const faqItems = [
  {
    question: '使用 MaaTool 需要准备什么？',
    answer: '你可以先使用免费仓库估值。需要生成排班时，请注册账号并添加可用的 CDK 游戏账号，然后按工作台提示导入干员数据、确认基建配置并生成结果。',
  },
  {
    question: 'CDK 和游戏账号有什么关系？',
    answer: 'CDK 用于开通相应游戏账号的工作台能力。登录后可在工作台内添加和管理自己的游戏账号，请不要向其他人发送 CDK 或订单信息。',
  },
  {
    question: '森空岛导入会读取什么数据？',
    answer: '在你确认授权后，服务会读取用于排班计算的游戏账号绑定信息、干员信息和养成库存。导入失败时可按页面提示重新授权，或使用 MAA 干员识别文件作为补充。',
  },
  {
    question: '生成的 JSON 应该如何使用？',
    answer: '下载生成的排班 JSON 后，在 MAA 的自定义基建配置中选择该文件。请先确认自己的 MAA 版本和实际游戏状态，导入前建议保留原有配置。',
  },
  {
    question: '为什么结果与实际收益不同？',
    answer: '结果是基于导入数据、基建配置和规则参数的测算建议。游戏版本、干员状态、订单、疲劳、实际换班执行和 MAA 配置都会影响最终结果。',
  },
  {
    question: '免费仓库估值和排班功能有什么区别？',
    answer: '免费仓库估值用于查看仓库和账号数据的等效理智参考；排班功能会结合干员、房间和策略生成可导入 MAA 的基建排班与相关指标。',
  },
  {
    question: '授权或导入失败怎么办？',
    answer: '先确认网络、森空岛登录状态和账号绑定关系，再重新发起授权。若问题持续，请带上不含敏感信息的报错描述和操作步骤到 QQ 群反馈。',
  },
  {
    question: '如何删除我的账号和数据？',
    answer: '请通过 QQ 群联系 MaaTool 官方，说明需要删除账号。处理前请不要在群内发送密码、CDK、二维码或森空岛凭据；客服会告知必要的身份核验方式。',
  },
]

const legalContent: Record<Exclude<PublicInfoPageKind, 'faq' | 'support'>, Array<{ heading: string; paragraphs: string[] }>> = {
  privacy: [
    {
      heading: '我们处理的信息',
      paragraphs: [
        '为提供账号登录、CDK 关联和排班服务，MaaTool 官方会处理你的邮箱、密码哈希、会话标识、CDK 及订单的哈希信息。服务不会以明文保存你的登录密码。',
        '当你选择添加游戏账号或通过森空岛导入时，服务会处理游戏 UID、昵称、区服或渠道信息、干员与养成库存、基建配置、排班结果和必要的授权状态。用于持续导入的森空岛凭据会在服务端加密保存。',
        '为保障服务稳定和防止滥用，服务还会记录必要的使用事件、请求时间和安全相关日志。浏览器会保存必要的会话 Cookie 与少量本地状态，例如公告已读状态。',
      ],
    },
    {
      heading: '使用目的与第三方处理',
      paragraphs: [
        '上述信息仅用于提供登录、账号管理、排班计算、结果保存、客服排障和服务安全。MaaTool 官方不会出售你的个人信息，也不会将游戏数据用于与本服务无关的广告投放。',
        '森空岛授权和数据导入会向鹰角网络或森空岛的相关接口发起请求。密码重置邮件会通过邮件服务商发送。我们仅在实现对应功能所必需的范围内向这些服务传输信息。',
      ],
    },
    {
      heading: '存储、安全与权利',
      paragraphs: [
        '数据保存在服务运行所需的数据库与基础设施中。我们采用访问控制、密码哈希、会话保护和传输安全措施降低未经授权访问的风险，但任何网络服务均无法保证绝对安全。',
        '你可以通过 QQ 群联系 MaaTool 官方，咨询、更正或申请删除账号及相关工作台数据。为保护账号安全，处理前可能需要完成必要的身份核验。',
      ],
    },
  ],
  terms: [
    {
      heading: '服务说明',
      paragraphs: [
        'MaaTool 是用于生成《明日方舟》基建排班建议和 MAA 配置文件的辅助工具。你使用本服务，即表示同意遵守本协议、隐私政策及页面展示的相关规则。',
        '服务的功能、规则数据和可用性可能随版本更新而调整。已开通的 CDK 功能以工作台实际展示的权限和状态为准。',
      ],
    },
    {
      heading: '用户义务',
      paragraphs: [
        '你应对自己的账号、CDK、游戏数据和操作行为负责，仅使用自己有权处理的数据，不得共享、转售、破解、干扰或以其他方式滥用本服务。',
        '请妥善保管密码、CDK 与森空岛授权信息。因用户主动泄露、设备失控或违反本协议造成的损失，应由用户自行承担。',
      ],
    },
    {
      heading: '服务限制',
      paragraphs: [
        '本服务提供的是计算与配置辅助，不保证任何排班方案在所有版本、所有账号或所有运行环境下都可用，也不承诺特定收益、效率或游戏内结果。',
        '如发现异常使用、安全风险或违反本协议的行为，MaaTool 官方可采取限制功能、暂停服务或删除相关数据等必要措施。',
      ],
    },
  ],
  disclaimer: [
    {
      heading: '结果仅供参考',
      paragraphs: [
        '排班、收益、等效理智、练度建议和仓库估值均基于导入数据与规则参数计算，仅作为辅助参考。使用前请自行核对实际游戏状态、MAA 配置和版本兼容性。',
        '因游戏版本变更、第三方接口异常、数据不完整、配置差异、自动化执行或其他不可控因素造成的结果偏差或损失，MaaTool 官方不承担保证责任。',
      ],
    },
    {
      heading: '第三方与知识产权',
      paragraphs: [
        '《明日方舟》、森空岛及相关名称、角色、数据和素材的权利归各自权利人所有。MAA 及其相关名称和项目内容归其各自权利人或社区所有。',
        'MaaTool 是独立工具，不代表、未获授权代表，也不与鹰角网络、森空岛或 MAA 项目建立官方隶属关系。除另有说明外，本站原创代码、界面和文字内容受相关法律保护。',
      ],
    },
  ],
}

const pageMeta: Record<PublicInfoPageKind, { title: string; eyebrow: string; intro: string }> = {
  faq: { title: '常见问题', eyebrow: '使用帮助', intro: '从账号、CDK 到森空岛导入与 MAA JSON，这里整理了开始使用时最常见的问题。' },
  support: { title: '联系客服', eyebrow: 'MaaTool 交流群', intro: '加入 QQ 群获取使用帮助、反馈问题或申请删除账号及工作台数据。' },
  privacy: { title: '隐私政策', eyebrow: 'MaaTool 官方', intro: '本政策说明 MaaTool 为提供排班服务而处理的信息及你的相关权利。' },
  terms: { title: '用户服务协议', eyebrow: 'MaaTool 官方', intro: '请在使用账号、CDK、森空岛导入和排班功能前阅读本协议。' },
  disclaimer: { title: '免责声明', eyebrow: 'MaaTool 官方', intro: '请了解排班建议、第三方服务与知识产权相关的使用边界。' },
}

export default function PublicInfoPage({ page }: { page: PublicInfoPageKind }) {
  const meta = pageMeta[page]

  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="tool-page-frame max-w-5xl">
        <header className="tool-page-header flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="tool-nav-link flex items-center gap-3 px-3 text-left">
            <BrandLogo size="md" />
            <span>
              <span className="block text-sm font-semibold text-ink-primary">MAA 基建排班优化器</span>
              <span className="block text-xs text-ink-muted">MaaTool 官方</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium" aria-label="公开页面导航">
            <Link to="/faq" className="tool-nav-link inline-flex items-center px-3">FAQ</Link>
            <Link to="/support" className="tool-nav-link inline-flex items-center px-3">客服</Link>
            <Link to="/" className="tool-secondary-action">返回首页</Link>
          </nav>
        </header>

        <section className="tool-panel mt-6 p-6 sm:mt-8 sm:p-8">
          <p className="tool-eyebrow">{meta.eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-ink-primary sm:text-4xl">{meta.title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-ink-secondary">{meta.intro}</p>
          {(page === 'privacy' || page === 'terms' || page === 'disclaimer') && (
            <p className="tool-status mt-4">生效日期：{EFFECTIVE_DATE}</p>
          )}
        </section>

        <div className="mt-6">
          {page === 'faq' && <FaqContent />}
          {page === 'support' && <SupportContent />}
          {(page === 'privacy' || page === 'terms' || page === 'disclaimer') && <LegalContent sections={legalContent[page]} />}
        </div>
      </div>
      <PublicFooter variant="tool" className="mt-10" />
    </main>
  )
}

function FaqContent() {
  return (
    <section className="tool-panel p-5 sm:p-6" aria-label="FAQ 列表">
      <div className="space-y-3">
        {faqItems.map((item) => (
          <details key={item.question} className="tool-inset group px-4 py-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-5 rounded-lg text-base font-semibold text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500/45">
              {item.question}
              <span className="text-xl leading-none text-brand-300 transition group-open:rotate-45" aria-hidden="true">+</span>
            </summary>
            <p className="max-w-3xl pb-3 pt-2 text-sm leading-7 text-ink-secondary">{item.answer}</p>
          </details>
        ))}
      </div>
      <div className="tool-inset mt-6 p-5">
        <h2 className="text-lg font-semibold text-ink-primary">仍未解决？</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">请带上问题描述、复现步骤和不含敏感信息的截图到交流群反馈。</p>
        <SupportGroupLink className="tool-primary-action mt-4" />
      </div>
    </section>
  )
}

function SupportContent() {
  return (
    <section className="space-y-6">
      <div className="tool-panel p-6 sm:flex sm:items-center sm:justify-between sm:gap-8">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold text-ink-primary">加入 MaaTool 交流群</h2>
          <p className="mt-3 text-sm leading-7 text-ink-secondary">在群内可以反馈使用问题、查看公告或申请删除账号与工作台数据。请先阅读 FAQ，并尽量提供可复现的操作步骤。</p>
        </div>
        <SupportGroupLink className="tool-primary-action mt-6 sm:mt-0" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="tool-inset p-5">
          <h2 className="text-base font-semibold text-ink-primary">反馈前请准备</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-secondary">
            <li>问题发生的页面和操作步骤</li>
            <li>不含个人信息的报错文字或截图</li>
            <li>浏览器、MAA 或游戏相关版本信息</li>
          </ul>
        </div>
        <div className="tool-alert tool-alert--warning p-5">
          <h2 className="text-base font-semibold text-ink-primary">不要在群内发送</h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-secondary">
            <li>登录密码、CDK 或订单完整信息</li>
            <li>森空岛二维码、授权凭据或 Cookie</li>
            <li>其他可直接登录账号的敏感内容</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

function LegalContent({ sections }: { sections: Array<{ heading: string; paragraphs: string[] }> }) {
  return (
    <article className="max-w-3xl space-y-4">
      <div className="space-y-10">
        {sections.map((section) => (
          <section key={section.heading} className="tool-panel p-5 sm:p-6">
            <h2 className="text-xl font-semibold text-ink-primary">{section.heading}</h2>
            <div className="mt-4 space-y-4 text-sm leading-7 text-ink-secondary">
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
          </section>
        ))}
      </div>
      <section className="tool-inset p-5">
        <h2 className="text-base font-semibold text-ink-primary">联系我们</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">如对本页面内容或数据处理有疑问，请通过 MaaTool QQ 群联系官方。</p>
        <SupportGroupLink className="tool-secondary-action mt-4" />
      </section>
    </article>
  )
}
