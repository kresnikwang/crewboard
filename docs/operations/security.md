# 安全运行手册

## 认证边界

- `/api/auth/*` 的实现集中在 `routes/auth.js`。
- 全部 `/api` 请求先经过 `authMiddleware`；`/api/health` 是公开健康检查。
- 密码使用现有认证工具处理，不要在 route 中自行实现 hash、session 或 token 逻辑。
- 密码重置请求保持统一的公开响应，避免泄露邮箱是否存在。
- `forgot-password` 同时受 IP 限流和账号维度冷却保护；当前账号冷却策略是 30 分钟最多发送一封。
- 重置 token、SMTP 密钥、企业微信 secret 和 Webhook URL 不应写入日志、测试输出或文档。

## 运行时密钥配置

凭据不进入仓库。生产通过应用目录下的 `.env` 提供，`server.js` 和 `scripts/*.js`
启动时用 `utils/loadEnv.js` 读取（无第三方依赖；真实环境变量优先级更高）。

- `.env` 已被 `.gitignore` 忽略；可提交的模板是 `.env.example`。
- 缺少配置时**失败关闭**：邮件发送与企业微信调用直接报错并记录日志，不会退回到
  任何共享账号。看门狗没有 `WATCHDOG_PASSWORD` 时输出 `SKIPPED`，不会误重启服务。
- 部署后确认 `.env` 存在且权限收敛（`chmod 600 .env`，属主为运行 PM2 的用户）。
- 轮换密钥时只改服务器上的 `.env`，然后 `pm2 restart crewboard --update-env`
  并重跑看门狗确认。

必需变量：

| 变量 | 用途 | 缺失后果 |
| --- | --- | --- |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | 密码重置、邀请邮件 | 邮件发送失败，用户收不到重置链接 |
| `WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_SECRET` | 排班通知与提醒 | 企业微信推送静默停用 |
| `WATCHDOG_PASSWORD` / `WATCHDOG_ALERT_EMAIL` | 认证自检与告警 | 自检跳过，故障无法及时发现 |

检查线上是否已配置（只打印变量名，不打印值）：

```bash
cd /www/wwwroot/resource.skandstudio.com
sed -E 's/=.*/=<set>/' .env | grep -E '^(SMTP_|WECOM_|WATCHDOG_)'
```


## 告警处理顺序

收到认证看门狗告警时，按下面顺序保留证据再处理：

```bash
pm2 status crewboard
pm2 logs crewboard --lines 150
curl -i http://127.0.0.1:3000/api/health
pm2 describe crewboard
```

然后检查：

1. 是服务不可达、登录失败，还是新 token 无法通过 `/api/auth/me`。
2. PM2 是否发生异常重启、端口漂移或主进程带有不应存在的 `cron_restart`。
3. 最近部署 commit、Nginx 错误日志和数据库是否可读写。
4. 是否存在大量 `/api/auth/forgot-password` 请求；只看聚合后的时间、来源和状态，不在日志中暴露 token 或密码。

只有在保留日志后再重启服务。重启后复测健康检查、登录、`/api/auth/me` 和一个需要登录的业务 API，并记录恢复时间。

## SSH 与服务器

- SSH 使用密钥和本机 SSH 配置，不把 root 密码、私钥或临时 token 放进仓库。
- 应用只监听 `127.0.0.1`，公网流量应经过 Nginx 和 HTTPS。
- 生产 PM2 使用 fork 单实例，因为 SQLite 只有一个写入协调者。
- 服务器升级后要重新核对 PM2 保存列表、Nginx upstream、Node/npm 版本和定时任务。
- 数据库备份文件与日志都属于敏感数据，应限制权限和保留周期。

## 代码改动检查清单

- 新增 API 是否检查企业 ID、用户角色和跨租户资源归属？
- 错误响应是否避免泄露用户存在性、token、secret 或 SQL 细节？
- 写操作是否需要审计日志、SSE 广播或通知？
- 新增认证行为是否覆盖 `npm run test:security` 和 `npm run test:email`？
- 是否误修改了 `public/js/dist/`、`public/css/dist/` 或生产数据库？
