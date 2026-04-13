# audit-ai-assistant

茶饮稽核 AI 助手项目骨架。

## 目录

- `apps/admin`：后台管理端和 API。
- `apps/miniprogram`：微信小程序骨架。
- `packages/shared`：共享类型和常量。
- `data`：后续导入的规则数据。
- `docs`：产品与技术文档。
- `scripts`：数据导入和辅助脚本。

## 当前状态

- 后台采用 `Next.js + TypeScript`
- 小程序采用原生微信小程序目录结构
- 一期所需规则数据已纳入仓库 `data/templates`

## 启动后台

```bash
npm install
npm run dev:admin
```

默认会启动在 `http://127.0.0.1:3003`，与小程序当前默认 API 地址保持一致，并固定监听本机地址，便于本地联调。开发环境默认使用 webpack 模式，避免本机文件监听过多时影响 API 路由联调。

## 小程序联调

- 小程序默认请求 `http://127.0.0.1:3003/api`
- 如需切换接口域名，可在小程序里调用 `getApp().setApiOrigin("http://你的地址:端口")`
- 后台健康检查接口：`GET /api/health`

## AI 解释能力

- 当前问答链路默认先走规则匹配，再由大模型补充面向门店的简短解释
- 未配置大模型时，不影响规则命中、结果返回和人工复核池逻辑
- 需要在 `apps/admin/.env.local` 或部署平台环境变量中配置：

```bash
DASHSCOPE_API_KEY=你的阿里云百炼Key
MODEL_NAME=qwen3.5-flash
```

- 当前默认使用阿里云百炼 OpenAI 兼容接口，推荐对话模型为 `qwen3.5-flash`（成本低、响应快，适合规则命中后的简短解释）

## 复核数据持久化

- 本地开发：自动使用 `data/review-tasks.json`，无需额外配置
- 生产部署：推荐直接连接阿里云 ECS 本机 Redis
- 最简配置：在 `audit-admin.env` 中设置 `REDIS_URL=redis://127.0.0.1:6379/0`
- 验证方式：访问 `GET /api/health`，返回的 `storage` 字段应为 `"redis"`（本地为 `"local-file"`）

## 后台最小鉴权

- 复核相关页面（如 `/reviews`）需先访问 **`/reviews/login`** 用账号密码登录；登录后使用 HttpOnly 会话 Cookie，避免浏览器对 Basic 与 `fetch` 行为不一致导致保存失败
- 仍支持在请求头携带 Basic Auth（例如脚本调用 `PATCH /api/reviews/[id]`）
- `GET /api/reviews` 与 `GET /api/reviews/[id]` 已收紧：主管后台可查看全部，小程序侧必须携带 `x-requester-id` 才能读取自己的复核记录
- 本地账号读取 `apps/admin/.env.local`，示例见 `apps/admin/.env.example`；可选配置 `ADMIN_SESSION_SECRET` 作为会话签名密钥（生产环境建议与登录密码区分）
- 当前本地临时账号：`admin / admin123456`
- 正式上线前请务必替换为你自己的账号密码

## 复核结论导出

- 主管登录后台后，可在 `/reviews` 页面点击“导出复核结论”
- 导出接口为 `GET /api/reviews/export?format=csv`
- 当前会导出状态为“已处理”或“已加入知识库”的任务，便于后续整理并反哺 `data/templates`

## 生产部署（阿里云 ECS）

- 应用以 Docker/Podman 容器运行，Nginx 反向代理与 HTTPS 证书由服务器侧配置；运维与重启命令见 [docs/OPS_ALIYUN.md](docs/OPS_ALIYUN.md)。
- 生产环境推荐在 ECS 本机安装 Redis，并通过 `REDIS_URL` 连接，用于复核任务、知识库和账号数据持久化。

## 测试与脚本

```bash
npm run test              # Vitest（admin 子包）
npm run lint:admin
npm run build:admin
npm run validate:knowledge-excel -- path/to/file.xlsx [表名]   # 校验 Excel 表头
npm run verify:semantic-cases  # 语义回归（需已配置向量等）
```

## 代码风格（可选）

- 格式化：`npm run format` / `npm run format:check`
- 若使用 Git hooks：在仓库根目录执行 `npx husky init`（或已包含 `.husky/pre-commit` 时提交前会运行 `lint-staged`）

## 文档索引

| 文档                                                             | 说明                    |
| ---------------------------------------------------------------- | ----------------------- |
| [data/README.md](data/README.md)                                 | 知识库模板与 Excel 校验 |
| [docs/LOCAL_E2E_CHECKLIST.md](docs/LOCAL_E2E_CHECKLIST.md)       | 本地全链路测试清单      |
| [docs/MIGRATE_TO_LOCAL_REDIS.md](docs/MIGRATE_TO_LOCAL_REDIS.md) | 迁移到 ECS 本机 Redis   |
| [docs/ACCOUNT_ONBOARDING.md](docs/ACCOUNT_ONBOARDING.md)         | 账号与权限预配置        |
| [docs/SECURITY.md](docs/SECURITY.md)                             | 安全与限流说明          |
| [docs/OPS_ALIYUN.md](docs/OPS_ALIYUN.md)                         | 阿里云运维              |
| [docs/USAGE_MINIPROGRAM.md](docs/USAGE_MINIPROGRAM.md)           | 专员小程序使用说明      |
