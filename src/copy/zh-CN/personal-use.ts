export const personalUseCopy = {
  declaration_title: '《个人使用声明》',
  declaration_version: '版本 V1.1 / 生效日期：2026-07-31',
  confirmation_title: '个人使用确认',
  confirmation_intro: '本人确认，本次及后续使用本服务所生成的全部内容（包括排班方案、分析报告、可执行文件等），仅服务于本人绑定的游戏账号，用于个人非商业参考。',
  confirmation_commitment: '本人承诺不会以收费接单、代注册、代领取、代生成、批量导出、转售文件或其他商业方式，向任何第三方提供本服务的访问资格或生成成果。',
  confirmation_consequence: '违反上述承诺时，本人理解平台有权限制相关权益。',
  confirmation_checkbox: '我已阅读并确认上述个人使用承诺。',
  confirmation_view_terms: '查看完整《个人使用声明》',
  confirmation_cancel: '取消',
  confirmation_continue: '确认并继续',
  confirmation_submitting: '正在确认…',
  confirmation_status_load_failed: '无法读取个人使用声明状态，请稍后重试。',
  confirmation_submit_failed: '确认未完成，请稍后重试。',
  confirmation_version_changed: '个人使用声明已更新，请阅读当前版本后重新确认。',
  privacy_acceptance_notice: '当你领取免费预览权益、创建或转换个人按次档案、生成或调序、导出个人档案成果时，平台会分别记录声明版本、确认时间、账号与档案标识、触发操作类型及客户端 IP。该记录仅用于证明确认链路、处理异常使用和争议沟通；账号存续期间保留，账号注销后再保留一年后删除或去标识化。',
  terms_personal_use_heading: '个人使用声明',
  terms_personal_use_intro: '免费预览、个人按次档案及其生成成果适用下列《个人使用声明》（V1.1 / 生效日期：2026-07-31）；商用档案不适用本声明，改为遵守服务条款中的商用账户规则。该声明仅自该日起适用于之后发生的使用行为，不以新条款单独追溯此前行为。',
  sections: [
    {
      id: 'personal-use-scope',
      heading: '1. 使用范围',
      paragraphs: [
        '免费预览和个人按次档案仅限用户本人为其绑定游戏账号进行非商业性排班规划与参考使用。相关生成内容（包括但不限于排班方案、分析报告、MAA JSON 文件、预设配置等）不得用于商业目的；已解锁商用资格后，必须另行使用商用档案处理已获授权的数据。',
      ],
      items: [],
    },
    {
      id: 'personal-use-prohibited',
      heading: '2. 明确禁止的行为',
      paragraphs: ['未经平台书面许可，用户不得实施以下行为：'],
      items: [
        '为第三方有偿或无偿代注册、代领取活动权益、代绑定档案；',
        '为第三方代生成排班方案、批量导出或交付本服务生成的可执行文件；',
        '通过注册多个账号、使用他人档案、利用非本人 UID 等方式规避活动权益限制；',
        '将本服务的访问资格、输出成果、自动化生成能力以出租、转售、共享、转让等方式提供给他人。',
      ],
    },
    {
      id: 'personal-use-platform-rights',
      heading: '3. 平台权利',
      paragraphs: ['若后台检测到异常批量使用、多账号关联、共享访问或疑似商业化行为，平台有权：'],
      items: [
        '临时或永久暂停相关账号的活动权益；',
        '限制导出、下载等操作；',
        '要求用户补充说明使用场景。',
      ],
    },
    {
      id: 'personal-use-data',
      heading: '4. 数据归属与隐私',
      paragraphs: [
        '用户通过森空岛导入的原始干员数据始终归用户本人所有。本声明仅规范本服务成果的使用方式，不涉及对用户个人数据权利的转移或主张。平台将按隐私政策处理相关数据。',
      ],
      items: [],
    },
    {
      id: 'personal-use-version',
      heading: '5. 版本与效力',
      paragraphs: [
        '本声明自标示的生效日期起适用。平台保留版本记录及用户确认记录（含确认时间、账号、操作类型），以便在争议时提供依据。对于生效日前已发生的行为，平台不会仅凭本声明单独认定既往违规。',
      ],
      items: [],
    },
  ],
} as const
