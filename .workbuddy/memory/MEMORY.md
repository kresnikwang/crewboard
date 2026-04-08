# CrewBoard 项目长期记忆

## 服务器信息
- **IP**: 47.241.10.142
- **SSH**: root / 密码 ABab123. / 端口 22
- **部署路径**: /www/wwwroot/resource.skandstudio.com
- **访问地址**: https://resource.skandstudio.com
- **进程管理**: pm2 (crewboard)
- **数据库**: SQLite (db/resource-guru.db)
- **用户邮箱**: kris.wang@skandstudio.com

## 部署规则（⚠️ 必须严格遵守）

### 规则1：部署前必须先备份服务器数据库
每次部署前，在服务器上执行：
```bash
cp /www/wwwroot/resource.skandstudio.com/db/resource-guru.db /tmp/resource-guru-backup-$(date +%Y%m%d_%H%M%S).db
```

### 规则2：绝不能用本地数据库覆盖线上数据库
rsync 部署时必须排除数据库文件：
```bash
rsync --exclude="db/resource-guru.db" --exclude="db/resource-ghu.db" --exclude="db/*.db" --exclude="db/*.db-shm" --exclude="db/*.db-wal" --exclude="node_modules" --exclude=".git" --exclude=".well-known" --exclude=".workbuddy"
```

### 规则3：服务器上重新 npm install
因为本地 node_modules 包含 macOS 编译的原生模块（如 better-sqlite3），部署后需在服务器上：
```bash
rm -rf node_modules && npm install --production
```
否则会导致 `invalid ELF header` 错误使服务无法启动。

## 部署流程
1. 备份服务器数据库
2. rsync 同步代码（排除 db/*.db, node_modules 等）
3. 服务器上 rm -rf node_modules && npm install --production
4. pm2 restart crewboard
5. 验证服务 online

## 技术备忘
- macOS 的 scp 不支持 -e 排除参数，用 rsync 代替
- pm2 有时会残留失效进程，需要 pm2 kill 后重新 start
- 服务器没有配置 SQLite 数据库自动备份
