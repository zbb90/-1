# audit-ai-assistant 项目介绍

> 面向新加入的伙伴，5 分钟看懂这个项目在做什么、由哪些部分组成、怎么跑起来、怎么上线。
> 本文不替代各模块的详细文档，详细内容见末尾「文档索引」。

## 1. 项目是什么

**茶饮稽核场景的 AI 助手**，让门店专员可以在小程序里问问题，由后台用「规则知识库 + 大模型解释 + 主管复核」的方式给出标准化回答，并把复核结论反哺到知识库里持续打磨。

核心能力：

- **常规问题问答**：专员在小程序提问，后台先用知识库规则匹配（关键词召回 + 向量重排），再用大模型补充面向门店的简短解释。
- **外购 / 旧品查询**：基于清单类知识表的查询入口。
- **人工复核池**：AI 答不准或主管想复查的，进入复核任务流；主管在后台处理、导出 CSV、一键沉淀回知识库。
- **知识库后台**：五张结构化表（规则、共识、外购、旧品、操作）+ 双向链接 + 标签 + 健康度看板 + 知识图谱 + 稽核共识匹配工作台。
- **运维与权限**：负责人/主管/专员三级账号，存储诊断与一键修复，完整 CI/CD 到阿里云 ECS。

## 2. 仓库结构（npm workspaces）

| 目录 | 作用 |
| --- | --- |
| `apps/admin` | 后台管理端 + API（Next.js 16 + React 19 + TypeScript） |
| `apps/miniprogram` | 微信小程序（原生目录结构） |
| `packages/shared` | 前后端共享的常量与类型 |
| `data/templates` | 知识库初始 CSV 模板，无 Redis 时也作为只读回退数据 |
| `docs/` | 架构、运维、安全、E2E、小程序使用等文档 |
| `scripts/` | 向量同步、链接物化、语义回归、Excel 校验、压测等脚本 |
| `.github/workflows/ci.yml` | GitHub Actions：lint/test/build + 推送到 ECS 部署 |

## 3. 技术栈速览

- **后台**：Next.js 16（App Router、Turbopack、standalone 输出）、React 19、TypeScript、TailwindCSS 4、Zod、Vitest
- **存储**：Redis（`ioredis`，主存储） + Qdrant（向量库） + 本地 CSV/JSON（开发回退）
- **AI**：阿里云百炼 DashScope
  - 向量：`text-embedding-v4`
  - 对话：默认 `qwen3.5-flash`（OpenAI 兼容接口）
- **可视化**：`d3-force`（知识图谱）
- **导入导出**：`xlsx`（Excel/CSV）
- **小程序**：原生微信小程序
- **工程化**：Prettier + ESLint + Husky + lint-staged + GitHub Actions

## 4. 后台主要页面（`apps/admin/src/app`）

| 路由 | 用途 | 权限 |
| --- | --- | --- |
| `/` | 主管工作台首页：复核摘要、知识入口、用户统计 | 登录 |
| `/reviews` | 复核任务列表 | 主管/负责人 |
| `/reviews/[id]` | 单条复核处理 | 主管/负责人 |
| `/reviews/login` | PC 端账号密码登录 | 公开 |
| `/conversations` | 命中/对话视图，可标记答错 | 登录 |
| `/knowledge` | 五张知识表的浏览、编辑、标签、导入导出 | 登录 |
| `/knowledge/graph` | 知识条目关联力导向图 | 登录 |
| `/knowledge/health` | 知识库健康度看板（覆盖率、冷热规则） | 登录 |
| `/knowledge/audit-match` | 上传稽核表 + 共识表，AI 自动匹配工作台 | 登录 |
| `/users` | 账号管理 | 仅负责人 |
| `/storage` | Redis/复核/知识存储诊断与一键修复 | 仅负责人 |

## 5. 后台 API 一览（`apps/admin/src/app/api`）

按业务分组，详细参数见各路由文件：

- **健康检查**：`GET /api/health`
- **认证**：`POST /api/auth/wx-login`、`POST /api/auth/pc-login`、`POST /api/auth/update-profile`
- **用户管理**：`GET/POST /api/users`、`PATCH/DELETE /api/users/[id]`
- **业务问答**：`POST /api/regular-question/ask`、`POST /api/regular-question/review`、`POST /api/old-item/ask`、`POST /api/external-purchase/ask`
- **复核任务**：`GET /api/reviews`、`GET/PATCH /api/reviews/[id]`、`GET /api/reviews/export`、`GET /api/reviews/pending-count`
- **知识库 CRUD**：`/api/knowledge/{rules,consensus,external-purchases,old-items,operations}`
- **知识库辅助**：`/api/knowledge/{summary,export,import,sink,links,graph,tags,health,quality}`
- **稽核匹配**：`POST /api/knowledge/audit-match`、`POST /api/knowledge/audit-match/export`
- **存储运维**（仅负责人）：`/api/storage/{diagnostics,reviews,knowledge,users}`
- **对话标记**：`PATCH /api/conversations`

## 6. 知识库五张主表

定义在 `apps/admin/src/lib/kb-schema.ts`，UI 主展示列见 `apps/admin/src/app/knowledge/knowledge-tabs.tsx`：

| 表名 | idField | 主展示列 | 业务含义 |
| --- | --- | --- | --- |
| `rules` | `rule_id` | `条款标题` | 常规问题规则（核心匹配源） |
| `consensus` | `consensus_id` | `标题` | 共识解释（沉淀的判定标准） |
| `external-purchases` | `item_id` | `物品名称` | 外购物品清单 |
| `old-items` | `item_id` | `物品名称` | 旧品清单 |
| `operations` | `op_id` | `标题` | 操作类知识 |

数据可从 `data/templates` 下的 CSV 模板批量导入，运行时优先存 Redis；Excel 导入前可用 `npm run validate:knowledge-excel` 校验表头。

## 7. AI 匹配链路（常规问题）

1. **关键词召回**：从知识库 `rules` 中按 token 取候选
2. **向量重排**：调用 DashScope `text-embedding-v4`，与 Qdrant 中预生成的规则向量计算余弦相似度
3. **混合判定**：先做启发式规则，必要时调用 `qwen3.5-flash` 做最终判断
4. **解释生成**：命中后由大模型生成面向门店的简短解释
5. **未命中或低置信**：自动入复核池，主管处理后可一键沉淀回 `rules` / `consensus`

稽核共识匹配（`/knowledge/audit-match`）复用了同一套召回 + 重排 + 判定流水线，用于把稽核表条款批量匹配到现有共识，并支持勾选导出"知识草稿"。

## 8. 鉴权与权限

- **小程序**：微信登录后签发 JWT，调用 API 携带 `Authorization: Bearer`
- **后台**：账号密码登录后写 HttpOnly 会话 Cookie（HMAC 签名）；脚本类调用支持 HTTP Basic Auth
- **角色**：
  - `leader`（负责人）：所有权限，含 `/users`、`/storage`
  - `supervisor`（主管/副负责人）：知识库、复核、对话
  - `specialist`（专员）：仅小程序业务接口
- 关键环境变量：`ADMIN_BASIC_AUTH_USER/PASSWORD`、`ADMIN_SESSION_SECRET`（≥32 字符）、`LEADER_ACCOUNTS`、`PRIMARY_LEADER_PHONE`

## 9. 环境与运行

### 必备环境变量

```bash
DASHSCOPE_API_KEY=...            # 阿里云百炼
MODEL_NAME=qwen3.5-flash
EMBEDDING_MODEL_NAME=text-embedding-v4
QDRANT_URL=...                    # 向量库
QDRANT_API_KEY=...
QDRANT_COLLECTION_NAME=...
REDIS_URL=redis://127.0.0.1:6379/0
ADMIN_BASIC_AUTH_USER=admin
ADMIN_BASIC_AUTH_PASSWORD=...
ADMIN_SESSION_SECRET=至少32位的随机字符串
LEADER_ACCOUNTS=手机号:密码;手机号:密码
PRIMARY_LEADER_PHONE=主负责人手机号
```

完整示例见 `apps/admin/.env.example`。

### 本地启动

```bash
npm install
npm run dev:admin           # http://127.0.0.1:3003
```

小程序在微信开发者工具里打开 `apps/miniprogram`，默认请求 `http://127.0.0.1:3003/api`，必要时执行 `getApp().setApiOrigin("http://你的地址:端口")` 切换。

### 常用脚本

```bash
npm run test                          # Vitest（admin 子包）
npm run lint:admin
npm run build:admin
npm run format / npm run format:check
npm run sync:rule-embeddings          # 增量同步规则向量到 Qdrant
npm run sync:rule-embeddings:rebuild  # 全量重建
npm run sync:knowledge-links          # 物化派生知识链接
npm run verify:semantic-cases         # 语义回归
npm run validate:knowledge-excel -- path/to/file.xlsx [表名]
```

## 10. 部署（阿里云 ECS）

- GitHub Actions（`.github/workflows/ci.yml`）：`main` 分支 push 时跑完 lint/test/build，再 SSH 到 ECS 用 `podman build` 构建镜像并启动容器
- 容器：基于 `apps/admin/Dockerfile` 多阶段构建，输出 Next standalone，监听 `3003`，非 root 运行
- 反向代理：Nginx + HTTPS，外网域名 `admin.jihe.fun`
- 持久化：ECS 本机 Redis；环境变量来自服务器上的 `/root/audit-admin.env`
- 健康检查：`GET /api/health`，`storage` 字段在生产应为 `"redis"`
- 失败时自动回滚到上一个镜像

详细操作见 `docs/OPS_ALIYUN.md`。

## 11. 小程序页面（`apps/miniprogram/pages`）

| 页面 | 用途 |
| --- | --- |
| `index/index` | 首页与功能入口 |
| `regular-question/{index,result}` | 常规问题提交与结果 |
| `old-item/{index,result}` | 旧品查询 |
| `external-purchase/{index,result}` | 外购查询 |
| `my-reviews/{index,detail}` | 我的复核 |
| `settings/index` | 设置（含 API 地址切换） |

## 12. 文档索引

| 文档 | 路径 | 适合场景 |
| --- | --- | --- |
| 架构概览 | `docs/architecture.md` | 一期范围与目录定位 |
| 安全与限流 | `docs/SECURITY.md` | 上线前安全自检 |
| 阿里云运维 | `docs/OPS_ALIYUN.md` | ECS 部署、Nginx、证书 |
| 账号预配置 | `docs/ACCOUNT_ONBOARDING.md` | 新建负责人/主管账号 |
| 本地 E2E 清单 | `docs/LOCAL_E2E_CHECKLIST.md` | 本地全链路验证 |
| 迁移到本机 Redis | `docs/MIGRATE_TO_LOCAL_REDIS.md` | Redis 迁移与切换 |
| 小程序使用 | `docs/USAGE_MINIPROGRAM.md` | 专员/主管使用说明 |
| 知识库模板 | `data/README.md` | CSV/Excel 模板说明 |

## 13. 上手建议

1. **先跑通本地**：复制 `apps/admin/.env.example` → `.env.local`，填 DashScope/Redis/Qdrant，`npm run dev:admin`
2. **看一遍知识库**：`/knowledge`（五张表 + 标签 + 健康度）→ `/knowledge/graph` → `/knowledge/audit-match`
3. **跑一次复核闭环**：小程序提问 → `/reviews` 处理 → 「沉淀回知识库」→ 在 `/knowledge` 看到新条目
4. **再看一次部署**：阅读 `docs/OPS_ALIYUN.md` + `.github/workflows/ci.yml`，理解 CI 到 ECS 的链路
5. **遇到存储问题**：用 `/storage` 页面或 `/api/storage/diagnostics` + 一键修复，不要直接动 Redis

如有不清楚的地方，欢迎在 PR/issue 里提，或者直接在仓库根目录运行 `npm run lint:admin && npm run test` 验证后再开始改动。
