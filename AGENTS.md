# CrewBoard Codex 开发指引

这是仓库级导航和约束。详细说明按主题放在 `docs/`，不要把本文件重新扩写成第二份目录百科。

## 先看哪里

- 代码入口和真实目录边界：[docs/architecture/code-map.md](docs/architecture/code-map.md)
- 本地启动、构建和交付：[docs/development/workflow.md](docs/development/workflow.md)
- 测试命令和覆盖范围：[docs/development/testing.md](docs/development/testing.md)
- 生产发布：[docs/operations/deployment.md](docs/operations/deployment.md)
- 认证、SSH 和告警：[docs/operations/security.md](docs/operations/security.md)
- 文档总索引：[docs/README.md](docs/README.md)

## 项目事实

- 后端：Node.js + Express 4；数据库：better-sqlite3 / SQLite WAL。
- 前端：原生 JavaScript SPA + Bootstrap；没有热更新开发服务器。
- 进程管理：PM2 fork 单实例；生产主进程名 `crewboard`，默认端口 `3000`。
- 生产应用目录：`/www/wwwroot/resource.skandstudio.com`；发布入口是 `deploy.sh`。
- `routes/api.js` 是兼容入口，业务实现位于 `routes/api/`。
- 排班前端源码位于 `public/js/schedule/`；`public/js/schedule.js` 和 `public/js/dist/` 是生成物。
- CSS 源码位于 `public/css/`；`public/css/dist/` 是压缩产物。
- 数据库迁移集中在 `db/schema.js`，定时任务和脚本集中在 `ecosystem.config.js`、`scripts/`。
- `.workbuddy/memory/` 仅是历史开发记录，可能包含旧路径；判断当前代码以实际文件和 `docs/` 为准。

## 必须遵守

- 先读相邻模块和 [代码地图](docs/architecture/code-map.md)，再改路径或抽象。
- 不要直接编辑 `public/js/dist/`、`public/css/dist/`、`public/js/schedule.js` 或部署后注入版本号的 `public/index.html`。
- 修改排班源码后运行 `npm run bundle:schedule`，修改前端后运行 `npm run build`。
- SQLite 生产环境保持单进程写入；不要把 PM2 改成 cluster 或多实例。
- API 必须保持企业隔离、角色权限和审计边界；认证改动同时运行 security/email 测试。
- 迁移必须幂等；不要提交 `db/*.db`、WAL 文件、测试数据库、Playwright 报告或临时目录。
- 生产密码、SSH 私钥、SMTP/企业微信/Webhook secret 不写入仓库。连接服务器使用本机 SSH 配置、SSH agent 或外部密钥管理。
- 不要用 `git reset --hard` 或 `git checkout --` 覆盖用户改动；不要为了整理目录移动运行时文件，除非同时更新部署和所有引用并完成验证。

## 常用命令

```bash
npm ci
npm run build
npm test
npm run test:all
bash -n deploy.sh
git diff --check
```

测试脚本和隔离数据库说明见 [测试指南](docs/development/testing.md)。部署后必须按 [生产部署手册](docs/operations/deployment.md) 检查 PM2 和 `/api/health`。
