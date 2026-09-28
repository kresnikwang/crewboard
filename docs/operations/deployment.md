# 生产部署手册

## 生产事实

- 应用目录：`/www/wwwroot/resource.skandstudio.com`
- 域名：`https://resource.skandstudio.com`
- Node 服务监听：`127.0.0.1:3000`
- 进程管理：PM2，主进程名 `crewboard`，fork 模式，单实例
- 数据库：应用目录下的 `db/resource-guru.db`
- 反向代理：Nginx，由服务器面板维护

连接主机和认证信息不写在仓库中。使用本机已配置的 SSH host、SSH agent 或外部密钥管理，不要把密码复制进命令、脚本或 Markdown。

## 标准发布

代码已经推送到远程 `main` 后，在生产机执行：

```bash
cd /www/wwwroot/resource.skandstudio.com
bash deploy.sh
```

`deploy.sh` 的实际步骤：

1. 使用 `sqlite3 .backup`（没有 sqlite3 时回退为复制）备份数据库，并清理超过 30 天的备份。
2. 暂存上次部署注入到 `public/index.html` 的版本号改动。
3. `git pull origin main --ff-only`。
4. 合并 `public/js/schedule/*.js`，压缩 JS/CSS，并检查 Bootstrap、字体等静态资源。
5. 用当前短 commit hash 替换 `public/index.html` 的 `__VERSION__`。
6. 只 reload `crewboard` 主进程，避免误触发提醒任务。

不要在生产机手动编辑源码后再运行部署；脚本的 `git stash` 会隐藏本地改动，正确做法是把改动提交到远程分支后合并到 `main`。

## 发布后检查

```bash
pm2 status crewboard
pm2 logs crewboard --lines 80
curl -fsS https://resource.skandstudio.com/api/health
git -C /www/wwwroot/resource.skandstudio.com rev-parse --short HEAD
```

如果改动了 `ecosystem.config.js`，还要检查进程配置是否与文件一致：

```bash
pm2 describe crewboard
pm2 jlist
```

新增或修改了定时任务时，还需要把它注册到 PM2（只改文件不会自动生效）：

```bash
cd /www/wwwroot/resource.skandstudio.com
pm2 start ecosystem.config.js --only crewboard-reminder-project-code --update-env
pm2 status
```

当前定时任务（均来自 `ecosystem.config.js`）：

| 进程 | 脚本 | 时间 |
| --- | --- | --- |
| `crewboard-holiday-update` | `scripts/update-holidays.js` | 每年 12/15 09:00 |
| `crewboard-reminder-schedule` | `scripts/reminder-schedule.js` | 每周一 09:00 |
| `crewboard-reminder-project-code` | `scripts/reminder-project-code.js` | 每周一 10:00 |
| `crewboard-reminder-timesheet` | `scripts/reminder-timesheet.js` | 每周五 15:00 |
| `crewboard-auth-watchdog` | `scripts/auth-watchdog.js` | 每 10 分钟 |

`crewboard-reminder-project-code` 给「创建了缺编号项目」且绑定了企业微信的在职同事发一条汇总提醒。已存档的项目不提醒；`created_by` 为空的历史项目只计数、不发送。首次上线可手动执行 `node scripts/reminder-project-code.js` 确认日志，输出见 `logs/reminder-project-code.log`。

重点确认主进程仍是 `PORT=3000`、`fork`、单实例，并且没有意外的 `cron_restart`。定时任务应分别由 ecosystem 中的任务进程负责，不要让 `crewboard` 主进程承担定时重启。

PM2 的保存列表是服务器状态，不是 Git 文件。修改或修复 PM2 进程列表后，只有在检查完所有进程都正确时才执行 `pm2 save`，避免把过期任务一并持久化。

## 回滚思路

1. 先保留当前数据库备份和 PM2 日志。
2. 在生产目录确认目标 commit 可以 `git checkout` 或通过远程分支恢复。
3. 重新执行 `bash deploy.sh`，让静态资源版本号和压缩产物一起回到同一版本。
4. 访问 `/api/health`，再做登录、排班读取和密码重置等最小人工检查。

数据库回滚必须单独评估迁移兼容性；不要仅因为应用回滚就直接覆盖生产数据库。
