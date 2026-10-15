# goofish-infrast-v1

面向《明日方舟》玩家的 MAA 基建排班 Web 应用，提供排班管理、账号与档案管理及相关工具。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 前端 | React 19.2、TypeScript 7、Vite 8、React Router 8 |
| UI | Tailwind CSS 4、shadcn/ui、Radix UI、Motion 12、Lucide |
| 后端 | Node.js 24、TypeScript、原生 HTTP API |
| 数据库与任务队列 | PostgreSQL、node-postgres（pg） |
| 测试 | Vitest 4、Testing Library、Testcontainers |

## 本地开发

环境要求：Node.js 24、npm 11。后端开发需准备 PostgreSQL 和项目根目录的 `.env`。

安装依赖并启动前端：

```bash
npm ci
npm run dev
```

前端默认地址为 `http://localhost:5173`，`/api` 请求代理到 `http://127.0.0.1:3000`。

在另一终端启动后端：

```bash
npm run start:server
```

排班计算需要接入兼容的 `OptimizerPort` worker；公开范围见 [开源边界](OPEN_SOURCE_BOUNDARY.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 构建前端和公共 API 服务端 |
| `npm run preview` | 预览前端构建产物 |
| `npm test` | 运行单元测试 |
| `npm run test:postgres` | 运行 PostgreSQL 集成测试，需要 Docker |
| `npm run check:architecture` | 检查架构边界 |
| `npm run check:dead-code` | 检查未使用的代码 |

## 贡献与许可证

贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题报告见 [SECURITY.md](SECURITY.md)。本仓库使用 [Apache License 2.0](LICENSE)。

《明日方舟》及相关商标、角色、素材和游戏数据归其各自权利人所有。本项目与相关权利人无隶属或背书关系。
