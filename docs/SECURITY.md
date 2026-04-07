# 安全说明

## 鉴权分层

- **页面与写操作 API**：由 [middleware.ts](../apps/admin/src/middleware.ts) 与会话 Cookie 保护；负责人专属路径（如 `/users`）额外校验 `audit_role=leader`。
- **小程序请求**：业务 API 通过 `Authorization: Bearer <JWT>` 与 `x-requester-id` 等头识别专员身份；具体逻辑见各 `route.ts` 与 [requester.ts](../apps/admin/src/lib/requester.ts)。
- **Basic Auth**：可选环境变量，用于兼容运维或紧急访问（与 `admin-auth` 一致）。

## JWT（小程序）

- 算法：HS256（[jwt.ts](../apps/admin/src/lib/jwt.ts)）。
- **必须**设置足够长的 `JWT_SECRET`（建议 32 字节以上随机串）。
- 可选 `JWT_EXPIRES_SECONDS` 控制过期时间（默认 7 天，最短 300 秒，最长 30 天）。

## 限流

以下公开/高频接口在应用层按 **IP** 做每分钟次数限制（单进程内存；多实例各自计数）：

- `POST /api/auth/wx-login`
- `POST /api/auth/pc-login`
- `POST /api/regular-question/ask`
- `POST /api/old-item/ask`
- `POST /api/external-purchase/ask`

超限返回 `429`，响应头含 `Retry-After`。

## 敏感配置

切勿将真实 `.env`、密钥、数据库口令提交到 Git。生产环境通过环境变量或密钥管理服务注入。
