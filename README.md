# goofish-infrast-v1

[![Quality Checks](https://github.com/ntgmc/goofish-infrast-v1/actions/workflows/quality-checks.yml/badge.svg)](https://github.com/ntgmc/goofish-infrast-v1/actions/workflows/quality-checks.yml)

MAA 基建排班优化器是一个面向《明日方舟》玩家的 Web 工具。用户拿到 CDK 后在网站上传干员数据并生成授权文件；已有授权文件或工作文件时可直接上传继续使用。应用会根据干员、基建房间、产物需求和无人机策略计算可导入 MAA 的排班 JSON，并给出精英化升级建议。

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

## Quality Checks

仓库使用 GitHub Actions 执行质量检查，配置文件位于 `.github/workflows/quality-checks.yml`。

Quality Checks 会在以下场景触发：

- 向 `main` 发起 pull request
- 推送到 `main`
- 推送到 `dev`
- 手动触发 Quality Checks

Quality Checks 拆分为两个检查项：

| Job | Command | Purpose |
| --- | --- | --- |
| `Deploy Relevance` | `npm run check:deploy-relevance` | 判断本次变更是否需要 Netlify 重新部署 |
| `Web Build` | `npm run build` | 生成效率数据、执行 TypeScript 检查并构建 Vite 前端 |
| `Functions Smoke Test` | `npm run generate:data` + `npm run check:functions` | 生成共享版本元数据，并验证 Netlify Optimize Function 可打包、可调用 |

`Web Build` 和 `Functions Smoke Test` 只在 `Deploy Relevance` 判断为需要部署时运行。只修改文档或仓库元数据时，Quality Checks 会保留发布相关性检查，但跳过前端构建和函数 smoke test。

另外，仓库使用 GitHub Actions 在 PR 创建、重新打开、更新 commit 或标记 ready 时，根据 PR 内 commit message 自动更新 PR description。配置文件位于 `.github/workflows/pr-details.yml`。该流程只维护 PR description 中 `<!-- pr-details:start -->` 到 `<!-- pr-details:end -->` 之间的自动生成区块，区块外的人工内容会保留。

`npm run generate:data` 会自动生成并应用构建元数据。Quality Checks 会在 PR 指向 `main` 或 push 到 `main` 时自动运行该脚本，并把生成后的 `src/lib/build-meta.ts`、`netlify/functions/data.ts` 提交回触发分支；fork PR 因权限限制不会自动回写。CI 或 Netlify 可通过以下变量覆盖默认值：

| Variable | Example | Purpose |
| --- | --- | --- |
| `FRONTEND_VERSION` | `1.3.123` | 前端版本号 |
| `BACKEND_VERSION` | `1.3.123` | 后端版本号 |
| `APP_VERSION` | `1.3.123` | 同时覆盖前端和后端版本号 |
| `DATA_VERSION` | `data.123.abcdef1` | 规则数据版本号 |
| `GENERATED_AT` | `2026-06-21T00:00:00Z` | 规则数据生成时间 |
| `VERSION_SOURCE_SHA` | commit SHA | 用于生成版本元数据的源提交 |
| `GIT_SHA` | commit SHA | 版本对应的 Git 提交 |
| `BUILD_NUMBER` | `123` | 生成版本号时使用的构建序号 |
| `BUILD_CONTEXT` | `pull_request` / `push` | 构建上下文 |

`npm run generate:data` 会根据这些变量生成 `src/lib/build-meta.ts`，并在 `netlify/functions/data.ts` 中写入 `data_version`、`generated_at` 和来源摘要。前端会显示“当前规则数据更新于 YYYY-MM-DD”，优化 API 响应也会带上同一份版本元数据。

未显式提供 `FRONTEND_VERSION`、`BACKEND_VERSION` 或 `APP_VERSION` 时，版本号 patch bump 规则固定如下：显式 `VERSION_PATCH` 优先，其次使用 `BUILD_NUMBER`；本地未提供构建号时使用当前 Git 提交数。Quality Checks 的自动回写任务会把 `github.run_number` 作为 `BUILD_NUMBER` 注入，因此每次 PR 到 `main` 或 push 到 `main` 都会生成新版本并写回仓库；机器人提交触发的后续构建不会再次 bump，避免循环提交。未显式提供 `DATA_VERSION` 时，脚本会优先生成 `data.<构建号>.<短 SHA>`，缺少 Git 信息时回退到规则数据内容哈希。

## Netlify Build & deploy settings

当前仓库已包含 `netlify.toml`，部署配置以该文件为准：

| Setting | Value |
| --- | --- |
| Base directory | repository root |
| Build command | `npm run build` |
| Ignore command | `node scripts/netlify-ignore-build.mjs` |
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

## 发布流程

本项目使用 Netlify Git-based deploy，不在 GitHub Actions 中手动上传构建产物。

Netlify 会在构建前执行 `node scripts/netlify-ignore-build.mjs`。该脚本根据上一次部署提交和当前提交之间的文件变化决定是否继续构建：

| Change type | Examples | Result |
| --- | --- | --- |
| 前端运行时代码 | `src/`, `public/`, `index.html`, `vite.config.ts`, `tsconfig.json` | 继续部署 |
| 后端函数或数据 | `netlify/`, `scripts/generate-data.mjs` | 继续部署 |
| 构建依赖或站点配置 | `package.json`, `package-lock.json`, `netlify.toml` | 继续部署 |
| 文档和仓库元数据 | `README.md`, `PRODUCT.md`, `optimize.md`, `.github/`, `.agents/` | 跳过 Netlify 部署 |
| 首次部署或无法读取比较提交 | 缺少 `CACHED_COMMIT_REF` / `COMMIT_REF` | 继续部署 |

推荐流程：

1. 在 `dev` 或功能分支完成开发。
2. 本地运行 `npm run check:local`。
3. 向 `main` 发起 pull request。
4. 等待 GitHub Actions Quality Checks 通过。
5. 使用 Netlify Deploy Preview 验证 PR 预览环境。
6. 合并到 `main` 后，由 Netlify 自动触发生产部署。
7. 部署完成后访问 <https://goofish-infrast-v1.netlify.app/> 做生产冒烟验证。

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
- `netlify/functions/`: CDK 兑换、授权文件生成和排班优化 API
- `scripts/`: 数据生成和函数 smoke check 脚本
- `public/assets/previews/`: 首页展示用预览图
- `public/webp96/`: 干员与召唤物图标资源
