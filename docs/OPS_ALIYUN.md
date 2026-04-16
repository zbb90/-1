# 阿里云 ECS 运维备忘

## 服务形态

- 应用：`podman`（或 `docker`）运行镜像 `audit-admin:latest`，推荐使用 `--network host`；应用监听宿主机 `127.0.0.1:3003`。
- 反代：Nginx 将 `admin.example.com` 的 HTTPS 转发到本机 3003。
- 证书：Certbot 申请；建议配置 **cron** 自动续期。

## 常用命令（SSH 登录服务器后）

```bash
# 安装 Redis（首次）
sudo yum install -y redis || sudo apt-get update && sudo apt-get install -y redis-server
sudo systemctl enable redis
sudo systemctl start redis

# 查看容器
podman ps

# 查看最近日志
podman logs --tail 200 audit-admin

# 重启应用（更新镜像后）
podman stop audit-admin && podman rm audit-admin
podman run -d --name audit-admin --network host --env-file /root/audit-admin.env \
  --restart=always audit-admin:latest
```

## 更新部署

1. 本地构建镜像或通过 CI 构建并推送到镜像仓库（若使用）。
2. 将新镜像加载到 ECS，执行上述 `run` 命令替换容器。
3. 健康检查：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3003/api/health`

## Nginx 与 HTTPS（小程序必看）

- 小程序请求域名必须为 **HTTPS**，且域名已在微信公众平台配置为合法域名。
- 仓库内示例：**仅 HTTP、无 443** 的配置会导致客户端出现 `net::ERR_CONNECTION_CLOSED` 或「网络请求失败」。请使用 [`apps/admin/admin.jihe.fun.https.example.conf`](../apps/admin/admin.jihe.fun.https.example.conf)，部署证书后 `nginx -t && systemctl reload nginx`。
- 服务器上自检：`curl -sI https://你的域名/api/health` 应返回 `200`；本机应用：`curl -s http://127.0.0.1:3003/api/health`。
- 若 `curl` 正常但小程序仍失败：检查 **安全组 443**、证书链是否完整、是否存在错误 **AAAA（IPv6）解析**（可先只保留正确 A 记录排查）。

## HTTPS 上线后验收清单

每次更新 Nginx、证书或域名解析后，至少执行一次：

1. `nginx -t`，确认配置语法正确。
2. `curl -sI https://你的域名/api/health`，确认返回 `200`。
3. `openssl s_client -connect 你的域名:443 -servername 你的域名`，确认：
   - 证书主题/SAN 包含当前域名
   - 使用的是完整链（`fullchain.pem`），不是单张叶子证书
   - 证书未过期
4. 确认 Nginx 实际配置包含：
   - `listen 443 ssl http2`
   - `server_name` 与域名一致
   - `ssl_certificate` 指向 `fullchain.pem`
   - 80 端口跳转到 HTTPS
5. 检查云服务器安全组已放通 `80/443`。

## 微信开发者工具提示“服务器证书无效”排查

如果开发者工具里出现“`https://admin.jihe.fun` 对应的服务器证书无效”，按下面顺序排查：

1. 先在服务器上执行上面的 HTTPS 验收清单，排除线上证书主体、过期、证书链和 443 配置问题。
2. 在本机命令行执行：
   - `curl -sI https://admin.jihe.fun/api/health`
   - `openssl s_client -connect admin.jihe.fun:443 -servername admin.jihe.fun`
     如果本机也失败，优先排查本地代理、VPN、抓包软件、公司网络劫持。
3. 检查 DNS：
   - `dig admin.jihe.fun A`
   - `dig admin.jihe.fun AAAA`
     若 AAAA 指向错误机器，部分网络会优先走 IPv6，表现为证书不匹配或连接异常。
4. 检查微信公众平台“开发管理 -> 开发设置”中的合法域名，确认已配置当前 HTTPS 域名。
5. 若服务器和本机 `curl/openssl` 都正常，但开发者工具仍提示证书异常：
   - 关闭开发者工具代理相关设置
   - 清理开发者工具缓存后重试
   - 执行控制台 `showRequestInfo()` 获取更详细 TLS 信息，再结合上面两步继续判断

## 存储诊断页

负责人登录后台后，可在顶部导航进入 `/storage` 查看：

- 当前复核数据模式：`redis-only` 或 `file-only`
- Redis 中复核任务主键数、索引数、按请求人分桶数
- 本地 `review-tasks.json` 的任务数
- 账号主键数、手机号索引数、各角色集合数

如果页面数据不一致，优先看这里：

1. `Redis 任务主键数 > 0` 但 `索引数 = 0`：说明主数据还在，但索引坏了，使用“自动修复索引”。
2. `账号管理` 异常但 `用户主键数 > 0`、`手机号索引数/角色集合数偏小`：说明用户索引坏了，使用“重建账号索引”。
3. `fileCount` 明显大于 Redis：说明历史数据还在本地文件，尚未完整进入 Redis，需要先修复/迁移后再看页面。

## Nginx 日志

- 访问日志：`/var/log/nginx/access.log`（路径以实际配置为准）。
- 建议在服务器配置 **logrotate**，避免磁盘占满。

## 环境变量

生产环境变量集中在 `audit-admin.env`（或你方统一命名），至少包含：`REDIS_URL`、`DASHSCOPE_API_KEY`、`JWT_SECRET`、`WX_APPID`、`WX_APP_SECRET`、模型与向量相关变量等。修改后需 **重启容器** 生效。

若应用通过当前 CI/CD 以 Podman 容器部署，工作流会注入：

```bash
REDIS_URL=redis://127.0.0.1:6379/0
```

配合 `--network host` 使用时，容器内的 `127.0.0.1` 会指向宿主机本机 Redis；若不使用 host network，则应用会错误地连到容器自身的 loopback，表现为“服务正常但 Redis 数据全空”。
