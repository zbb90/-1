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
- 规则数据已在兄弟目录 `问答机器人/数据模板` 中整理

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

## 后台最小鉴权
- 后台页面 `/reviews` 以及复核处理接口 `PATCH /api/reviews/[id]` 已启用 Basic Auth
- 本地临时账号默认读取 `apps/admin/.env.local`
- 示例配置见 `apps/admin/.env.example`
- 当前本地临时账号：`admin / admin123456`
- 正式上线前请务必替换为你自己的账号密码
