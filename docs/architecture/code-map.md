# 代码地图

## 请求入口

`server.js` 负责初始化数据库、配置 Express、挂载静态资源和路由，并监听本机 `PORT`（默认 `3000`）。认证中间件先作用于 `/api`，之后按下面的边界分流：

```text
/api/health       -> server.js（无需登录）
/api/auth/*       -> routes/auth.js（认证、账号、邀请、密码重置）
/api/*            -> routes/api.js -> routes/api/index.js -> routes/api/*.js
静态资源与 SPA    -> public/index.html
```

`routes/api.js` 只保留兼容入口：

```js
module.exports = require('./api/index');
```

新增业务 API 时，编辑对应的 `routes/api/<domain>.js`，并在 `routes/api/index.js` 中确认该模块已注册。不要把新的业务逻辑继续堆回 `routes/api.js`。

## 后端目录

| 目录或文件 | 职责 | 修改提示 |
| --- | --- | --- |
| `server.js` | Express 启动、静态资源、API 挂载、健康检查、过期会话清理 | 中间件顺序会影响认证和缓存 |
| `routes/auth.js` | 注册、登录、登出、账号设置、邀请、密码重置 | 改认证行为时同时看 `utils/authz.js` 和 `utils/rateLimit.js` |
| `routes/api/index.js` | 业务路由注册表和共享上下文入口 | 新增领域模块必须在这里注册 |
| `routes/api/shared.js` | API 上下文、权限辅助、头像保存等共享逻辑 | 不放具体业务 endpoint |
| `routes/api/permissions.js` | 当前用户权限、节假日查询 | 权限字段有旧版兼容别名 |
| `routes/api/resources.js` | 人员/资源 CRUD | 仅管理员可写 |
| `routes/api/clients.js` | 客户 CRUD | 与项目权限联动 |
| `routes/api/projects.js` | 项目与工作范围 | manager 只可编辑自己负责或协同的项目 |
| `routes/api/schedule-data.js` | 排班页聚合读取 | 读取资源、排班、休假、节假日 |
| `routes/api/bookings.js` | 排班 CRUD、冲突检查、审计、通知 | 写入后可能触发 SSE 和 IM 通知 |
| `routes/api/timesheets.js` | 工时填报与查询 | 注意项目/工作范围唯一性 |
| `routes/api/leave.js` | 请假记录 | 与节假日数据联动 |
| `routes/api/reports.js` | 利用率、项目和工时报告 | 大范围查询要关注 SQLite 查询成本 |
| `routes/api/export.js` | Excel 导出 | 使用 `exceljs`，不要混入普通 JSON API |
| `routes/api/wecom.js` | 企业微信同步相关 API | 密钥只从配置读取，不写日志 |
| `routes/api/sse.js` | Server-Sent Events 推送 | 连接生命周期和企业隔离需要一起验证 |
| `routes/api/audit.js` | 管理员审计日志 | 新增敏感写操作时检查是否需要审计 |
| `utils/` | 邮件、权限、审计、冲突、企业微信等共享能力 | 领域路由调用这里的 helper |
| `db/schema.js` | 建表、幂等迁移、演示数据 | 迁移必须可重复执行 |
| `db/holidays.js` | 节假日静态数据和查询辅助 | 由 `scripts/update-holidays.js` 更新 |

## 前端目录

`public/index.html` 当前加载顺序是 Bootstrap、本地化静态资源、i18n、core、schedule、timesheets、reports、manage、enterprise。页面是原生 JS SPA，没有独立的 bundler 配置。

| 文件或目录 | 职责 | 源码规则 |
| --- | --- | --- |
| `public/index.html` | SPA 壳、页面容器、脚本和样式加载 | 保留 `__VERSION__` 占位符 |
| `public/js/core.js` | API 请求、Auth、SSE、全局页面基础能力 | 其他模块依赖它 |
| `public/js/i18n.js` | 中英文文案和语言切换 | 修改文案优先改源码 |
| `public/js/schedule/*.js` | 排班页面按功能拆分的源码 | 按数字前缀的顺序合并 |
| `public/js/schedule.js` | 排班源码合并后的 IIFE | 运行 `npm run bundle:schedule` 生成，不直接编辑 |
| `public/js/{timesheets,reports,manage,enterprise}.js` | 对应业务页面 | 修改后由构建命令压缩 |
| `public/js/dist/*.min.js` | 浏览器实际加载的压缩 JS | 由 `npm run build` 或部署脚本生成 |
| `public/css/style.css` | CSS 总入口，导入模块 | 修改 `base/layout/components/schedule/pages` 等源码 |
| `public/css/*.css` | 样式模块 | 不直接编辑 `public/css/dist/` |
| `public/css/dist/*.min.css` | 发布 CSS 产物 | `npm run build` 或部署脚本生成 |
| `public/vendor/`、`public/fonts/` | 第三方静态资源 | 生产部署会检查缺失资源 |

### 源码与产物

```text
public/js/schedule/*.js
        └─ npm run bundle:schedule
             └─ public/js/schedule.js
                  └─ npm run build / deploy.sh
                       └─ public/js/dist/schedule.min.js

public/js/*.js
        └─ npm run build / deploy.sh
             └─ public/js/dist/*.min.js

public/css/style.css + @import 的模块
        └─ npm run build / deploy.sh
             └─ public/css/dist/style.min.css
```

本地 `npm run build` 负责 CSS 压缩（`scripts/build-css.js`）、排班合并和 JS 压缩；生产 `deploy.sh` 也会压缩 CSS 并注入静态资源版本号。

## 数据与后台任务

- 数据库默认文件是 `db/resource-guru.db`，测试使用 `tests/.tmp/` 或 `e2e/.tmp/` 下的临时数据库。
- `ecosystem.config.js` 定义主服务和定时任务：主服务 `crewboard`、节假日更新、三类提醒、认证看门狗。
- `scripts/auth-watchdog.js` 每 10 分钟验证登录和 `/api/auth/me`；它不代替日志和健康检查。
- `scripts/reminder-*.js` 发送企业微信提醒（排程、工时、项目编号补全）；`scripts/wecom-test.js` 是人工诊断脚本。
- `scripts/update-holidays.js` 更新 `db/holidays.js`，不要手动编辑生成区块后再运行更新脚本覆盖。

## 快速定位命令

```bash
# 找 endpoint 的实现
rg -n "router\\.(get|post|put|patch|delete)" routes/auth.js routes/api

# 找前端请求和页面入口
rg -n "fetch\\(|/api/|render[A-Z]" public/js public/index.html

# 找表结构和迁移
rg -n "CREATE TABLE|ALTER TABLE|CREATE INDEX" db/schema.js

# 找 PM2 任务与运行入口
rg -n "script:|cron_restart|PORT|DB_PATH" ecosystem.config.js server.js
```
