# goofish-infrast-v1

MAA 基建排班优化器是一个面向《明日方舟》玩家的 Web 工具。用户可以上传授权文件或通过 CDK 兑换生成工作文件，应用会根据干员、基建房间、产物需求和无人机策略计算可导入 MAA 的排班 JSON，并给出精英化升级建议。

## 在线地址

- Production: <https://goofish-infrast-v1.netlify.app/>

## 技术栈

- React 18
- TypeScript
- Vite 6
- Tailwind CSS 4
- Netlify Functions
- Netlify Blobs

## 本地开发

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

开发命令会先执行 `npm run generate:data`，生成前端和优化函数需要的效率数据。

## 构建与检查

生产构建：

```bash
npm run build
```

本地完整检查：

```bash
npm run check:local
```

`check:local` 会先执行生产构建，再对 `netlify/functions/optimize.ts` 做一次 smoke check，确认优化函数可以被打包和调用。

## Netlify Build & deploy settings

当前仓库已包含 `netlify.toml`，部署配置以该文件为准：

| Setting | Value |
| --- | --- |
| Base directory | repository root |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Node version | `20` |
| Functions directory | `netlify/functions` |
| Functions bundler | `esbuild` |

站点使用以下重定向规则：

| From | To | Status |
| --- | --- | --- |
| `/api/admin/cdk` | `/.netlify/functions/admin-cdk` | `200` |
| `/api/*` | `/.netlify/functions/:splat` | `200` |
| `/*` | `/index.html` | `200` |

### Branches and deploy contexts

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Branch deploys | Deploy only the production branch |
| Deploy Previews | Any pull request against the production branch or branch deploy branches |

## 环境变量

CDK 管理和兑换相关函数需要以下变量。不要把实际值提交到仓库，请通过 Netlify 环境变量或本地 `.env` 配置：

| Name | Purpose |
| --- | --- |
| `MAA_ADMIN_PASSWORD` | 管理后台生成和查询 CDK 的口令 |
| `CDK_HASH_SECRET` | CDK 哈希计算密钥 |
| `MAA_ADMIN_SECRET` | 授权文件签名密钥 |

本地 `.env` 已被 `.gitignore` 忽略。

## 主要目录

- `src/`: React 前端应用
- `src/pages/`: 首页、上传页、优化结果页和管理页
- `src/components/`: 配置编辑、结果展示和升级建议组件
- `netlify/functions/`: CDK、授权兑换和排班优化 API
- `scripts/`: 数据生成和函数 smoke check 脚本
- `public/assets/previews/`: 首页展示用预览图
- `public/webp96/`: 干员与召唤物图标资源
