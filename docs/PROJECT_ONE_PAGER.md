# audit-ai-assistant · 一页纸介绍

## 标题

**茶饮稽核 AI 助手** —— 让门店专员"问得到答案，主管管得住知识"

## 一句话定位

> 用「规则知识库 + 大模型解释 + 人工复核」三件套，把茶饮门店稽核里反复出现的问题，沉淀成可持续打磨的标准答案。

## 用户与场景

- **门店专员**（小程序）：随手问 → 得到结构化回答与解释
- **主管 / 副负责人**（后台）：复核 AI 答案 → 一键沉淀回知识库
- **负责人**（后台）：管账号、看健康度、做存储运维与 AI 匹配试跑

## 核心能力（4 个一句话）

1. **常规问题问答**：关键词召回 → 向量重排 → 大模型补充门店化解释
2. **外购 / 旧品查询**：清单类知识表的快速命中
3. **人工复核闭环**：AI 答不准自动入池，主管处理后一键回流
4. **知识库工作台**：5 张表 + 双向链接 + 标签 + 健康度 + 知识图谱 + 稽核共识匹配

## 架构（一图就够）

```
微信小程序 ──HTTPS──▶ Next.js 后台 (ECS:3003) ──▶ Redis (主存储)
                              │                  ├─ Qdrant (向量库)
                              │                  └─ DashScope (Embedding + LLM)
PC 后台 (admin.jihe.fun) ─────┘
                              ▲
              GitHub Actions ─┘  (push main → SSH + Podman 部署)
```

## 技术栈

- **后台**：Next.js 16 · React 19 · TypeScript · Tailwind 4 · Zod · Vitest
- **存储**：Redis（ioredis）· Qdrant · CSV 模板（开发回退）
- **AI**：阿里云百炼 DashScope（`text-embedding-v4` + `qwen3.5-flash`）
- **小程序**：原生微信小程序
- **部署**：Docker/Podman + Nginx + 阿里云 ECS + GitHub Actions

## 知识库 5 张主表

| 表 | 业务含义 |
| --- | --- |
| `rules` | 常规问题规则（核心匹配源） |
| `consensus` | 共识解释（沉淀的判定标准） |
| `external-purchases` | 外购物品清单 |
| `old-items` | 旧品清单 |
| `operations` | 操作类知识 |

## 当前进展

- ✅ 三端打通：小程序问答 / 后台复核 / 知识库回流
- ✅ 五表 + 标签 + 双向链接 + 健康度 + 知识图谱
- ✅ 稽核共识匹配工作台（上传 Excel → AI 自动匹配 → 勾选导出）
- ✅ 阿里云 ECS 自动化部署 + Redis 持久化 + 健康检查回滚
- ✅ 三级权限（负责人 / 主管 / 专员）+ 存储一键修复

## 团队上手 3 步

1. 复制 `apps/admin/.env.example` → 填 DashScope/Redis/Qdrant → `npm run dev:admin`
2. 走一遍：小程序提问 → `/reviews` 处理 → 一键沉淀 → `/knowledge` 看到新条目
3. 读 `docs/PROJECT_OVERVIEW.md` 与 `docs/OPS_ALIYUN.md` 进入实战

## 相关链接

- 生产入口：`https://admin.jihe.fun`
- 详细文档：`docs/PROJECT_OVERVIEW.md`
- 运维手册：`docs/OPS_ALIYUN.md`
- 安全说明：`docs/SECURITY.md`
