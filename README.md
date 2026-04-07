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
MODEL_NAME=qwen-plus
```

- 当前默认使用阿里云百炼 OpenAI 兼容接口，推荐模型为 `qwen-plus`

## 复核数据持久化

- 本地开发：自动使用 `data/review-tasks.json`，无需额外配置
- **Vercel 部署**：必须接入 Upstash Redis，否则复核任务数据会在容器回收后丢失
- 设置方式：Vercel 控制台 → Storage → 创建 **Upstash Redis** 数据库 → 关联到项目后会自动注入 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`
- 验证方式：访问 `GET /api/health`，返回的 `storage` 字段应为 `"upstash-redis"`（本地为 `"local-file"`）

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
