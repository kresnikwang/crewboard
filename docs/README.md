# CrewBoard 开发文档

这里是 CrewBoard 的开发与运维索引。先看本页，再进入对应专题；不要从旧的目录树猜运行时路径。

## 从哪里开始

| 任务 | 先看 | 主要代码 |
| --- | --- | --- |
| 修改服务启动、中间件或健康检查 | [代码地图](architecture/code-map.md) | `server.js` |
| 修改注册、登录、邀请或密码重置 | [代码地图](architecture/code-map.md) | `routes/auth.js`、`utils/authz.js`、`utils/rateLimit.js` |
| 修改业务 API | [代码地图](architecture/code-map.md) | `routes/api/index.js`、`routes/api/<domain>.js` |
| 修改排班前端 | [代码地图](architecture/code-map.md) | `public/js/schedule/*.js` |
| 修改其他前端页面 | [代码地图](architecture/code-map.md) | `public/js/{core,timesheets,reports,manage,enterprise,i18n}.js` |
| 修改样式 | [代码地图](architecture/code-map.md) | `public/css/*.css` |
| 修改表结构或迁移 | [代码地图](architecture/code-map.md) | `db/schema.js` |
| 运行本地开发流程 | [开发工作流](development/workflow.md) | `package.json` |
| 选择测试命令 | [测试指南](development/testing.md) | `tests/`、`e2e/` |
| 发布到生产环境 | [部署手册](operations/deployment.md) | `deploy.sh`、`ecosystem.config.js` |
| 处理认证或 SSH 告警 | [安全运行手册](operations/security.md) | `routes/auth.js`、`scripts/auth-watchdog.js` |

## 关键事实

- `routes/api.js` 是兼容转发文件，真正的业务路由在 `routes/api/`。
- `public/js/schedule/*.js` 是排班前端的源码；`public/js/schedule.js` 是合并产物，不直接编辑。
- `public/js/dist/*.min.js` 和 `public/css/dist/*.min.css` 是发布产物，不是源码入口。
- `public/index.html` 中的 `__VERSION__` 由部署脚本注入，开发时不要手动替换。
- SQLite 是单进程写入模型，生产 PM2 必须使用 fork 模式；不要把应用改成 cluster。
- 生产凭据不存放在仓库文档中，应由本机 SSH 配置、SSH agent 或部署环境提供。

## 文档分层

- `docs/architecture/`：代码边界、请求入口、源码与生成物关系。
- `docs/development/`：本地启动、构建、测试和改动验证。
- `docs/operations/`：生产部署、PM2、认证告警和安全操作。
- `docs/plans/`：一次性实施计划和历史方案，不作为当前架构事实的唯一来源。

产品介绍和用户可见功能说明仍在根目录 [README.md](../README.md)。代理规则和必须遵守的仓库约束在 [AGENTS.md](../AGENTS.md)。
