# CrewBoard 项目长期记忆

## 服务器信息
- **IP**: 47.241.10.142
- **SSH**: root / 密码 ABab123. / 端口 22
- **部署路径**: /www/wwwroot/resource.skandstudio.com
- **访问地址**: https://resource.skandstudio.com
- **进程管理**: pm2 (crewboard)
- **数据库**: SQLite (db/resource-guru.db)
- **用户邮箱**: kris.wang@skandstudio.com

## 工作流程规则（⚠️ 必须严格遵守）

### 规则0：默认只推送 GitHub，不部署
- 每次代码修改完成后，**只推送到 GitHub main 分支**
- **只有当用户明确说「部署到正式网站」时**，才执行服务器部署
- 绝不主动部署，除非用户明确指示

### 规则1：部署前必须先备份服务器数据库
每次部署前，在服务器上执行：
```bash
cp /www/wwwroot/resource.skandstudio.com/db/resource-guru.db \
   /www/wwwroot/resource.skandstudio.com/db/resource-guru-backup-$(date +%Y%m%d_%H%M%S).db
```
备份保存在同目录下，方便紧急恢复。

### 规则2：绝不能覆盖线上数据库
部署方式为 **git pull**（不是 rsync），数据库文件不在 git 追踪范围内，天然安全。
但需确认 `.gitignore` 中包含 `db/*.db`，防止意外提交。

### 规则3：部署后 npm install（如有新依赖）
如果 package.json 有变动，需在服务器上执行：
```bash
npm install --production
```

## 标准部署流程（仅在用户说「部署到正式网站」时执行）
1. SSH 连接服务器
2. **备份数据库**：`cp db/resource-guru.db db/resource-guru-backup-$(date +%Y%m%d_%H%M%S).db`
3. `git pull origin main`（通过 HTTPS token，因服务器 SSH key 未配置 GitHub）
4. 如有依赖变动：`npm install --production`
5. `pm2 restart crewboard`
6. 验证：`pm2 show crewboard` + `curl http://localhost:3000/`

## Git 拉取方式（服务器）
服务器 SSH key 未配置 GitHub，需临时切换 HTTPS remote：
```bash
# 临时用 token 拉取
git remote set-url origin https://<TOKEN>@github.com/kresnikwang/crewboard.git
git pull origin main
# 拉取后恢复 SSH remote
git remote set-url origin git@github.com:kresnikwang/crewboard.git
```
Token 从 `gh auth token` 获取。

## 技术备忘
- 服务器 OS：CentOS/RHEL（kernel 4.18），Node.js v18，PM2 v6
- 数据库文件：`db/resource-guru.db`（SQLite，WAL 模式）
- pm2 有时会残留失效进程，需要 pm2 kill 后重新 start
- 服务器没有配置 SQLite 数据库自动备份，每次部署时手动备份
