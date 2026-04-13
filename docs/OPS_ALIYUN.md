# 阿里云 ECS 运维备忘

## 服务形态

- 应用：`podman`（或 `docker`）运行镜像 `audit-admin:latest`，监听 `127.0.0.1:3003`。
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
podman run -d --name audit-admin --env-file /root/audit-admin.env \
  -p 127.0.0.1:3003:3003 --restart=always audit-admin:latest
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

## Nginx 日志

- 访问日志：`/var/log/nginx/access.log`（路径以实际配置为准）。
- 建议在服务器配置 **logrotate**，避免磁盘占满。

## 环境变量

生产环境变量集中在 `audit-admin.env`（或你方统一命名），至少包含：`REDIS_URL`、`DASHSCOPE_API_KEY`、`JWT_SECRET`、`WX_APPID`、`WX_APP_SECRET`、模型与向量相关变量等。修改后需 **重启容器** 生效。

推荐配置：

```bash
REDIS_URL=redis://host.containers.internal:6379/0
```
