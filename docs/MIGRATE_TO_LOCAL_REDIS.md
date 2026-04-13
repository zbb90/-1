# 迁移到 ECS 本机 Redis

## 1. 安装并启动 Redis

```bash
sudo yum install -y redis || (sudo apt-get update && sudo apt-get install -y redis-server)
sudo systemctl enable redis
sudo systemctl start redis
redis-cli ping
```

期望返回：

```bash
PONG
```

## 2. 更新服务环境变量

若使用当前仓库自带的 CI/CD 部署，可直接跳过这一步，工作流会自动以 `-e REDIS_URL=redis://127.0.0.1:6379/0` 启动应用容器。

若你需要手动运行应用容器，再编辑 `/root/audit-admin.env`，加入：

```bash
REDIS_URL=redis://127.0.0.1:6379/0
```

并移除旧的：

```bash
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

## 3. 从 Upstash 导出数据

如果你还可以访问 Upstash 控制台，优先导出以下 key：

- `audit:review-task-ids`
- `audit:review-task:*`
- `audit:requester-tasks:*`
- `audit:user:*`
- `audit:users-by-role:*`
- `audit:user-by-phone:*`
- `audit:kb:*:rows`

若 Upstash 已无法继续提供请求，可先上线本机 Redis 版本，再通过：

- `data/templates/*.csv` 恢复知识库基础数据
- `data/review-tasks.json` 恢复本地已有的复核任务样本

账号数据若只存在 Upstash，仍建议优先从 Upstash 控制台导出。

## 4. 重启后台容器

```bash
podman stop audit-admin 2>/dev/null || true
podman rm audit-admin 2>/dev/null || true
podman run -d \
  --name audit-admin \
  --env-file /root/audit-admin.env \
  -p 127.0.0.1:3003:3003 \
  --restart=always \
  audit-admin:latest
```

## 5. 验证

```bash
curl -s http://127.0.0.1:3003/api/health
```

期望返回中包含：

```json
{ "storage": "redis" }
```
