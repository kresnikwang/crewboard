# CrewBoard — 项目开发文档

## 项目简介

**神马排班 CrewBoard** — 团队资源排程与工时管理系统（中文界面）。

- 可视化排程（拖拽日历）、工时追踪、数据报表、企业协作
- 多角色权限：`admin`（全权）/ `manager`（创建/编辑自己的）/ `basic`（只读）
- 通知集成：钉钉、企微（WeCom）、飞书 Webhook

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express 4 |
| 数据库 | better-sqlite3（SQLite，WAL 模式）|
| 前端 | 原生 JS（多文件模块）+ Bootstrap 5.3 |
| 进程管理 | PM2（`ecosystem.config.js`）|
| 反向代理 | Nginx |
| 邮件 | Nodemailer |
| Excel 导出 | ExcelJS |

---

## 目录结构

```
crewboard/
├── server.js               # Express 入口
├── ecosystem.config.js     # PM2 配置（固定 PORT=3000）
├── nginx.conf              # Nginx 反代 + 静态缓存策略
├── deploy.sh               # 部署脚本（git pull + 版本号注入 + pm2 reload）
├── db/
│   ├── schema.js           # initDB() + migrate() + seedDemoData()
│   ├── holidays.js         # 节假日数据
│   └── resource-guru.db    # SQLite 数据库（勿提交）
├── routes/
│   ├── api.js              # 所有业务 API + SSE 推送
│   ├── auth.js             # 注册/登录/密码重置/邀请
│   └── webhook.js          # 钉钉/企微/飞书通知
├── utils/
│   ├── email.js            # Nodemailer 封装
│   └── wecom.js            # 企微应用消息封装
├── public/
│   ├── index.html          # SPA 入口（含 __VERSION__ 占位符）
│   ├── css/
│   │   ├── style.css       # 样式入口（按顺序 @import 模块）
│   │   ├── base.css        # reset、设计变量、基础元素
│   │   ├── layout.css      # 应用外壳、侧边栏、页面框架
│   │   ├── components.css  # 通用按钮、输入、弹窗表单等组件
│   │   ├── schedule.css    # 排程表格、booking 条、月视图
│   │   ├── pages.css       # 登录、报表、管理、企业、账号页面
│   │   └── bootstrap-bridge.css  # 设计令牌映射桥接层
│   ├── js/
│   │   ├── core.js         # 核心：Auth、API、SSE、i18n 基础
│   │   ├── schedule.js     # 排程视图
│   │   ├── timesheets.js   # 工时填报
│   │   ├── reports.js      # 报表
│   │   ├── manage.js       # 资源/项目/客户管理
│   │   ├── enterprise.js   # 企业设置
│   │   └── i18n.js         # 国际化字符串
│   └── img/                # 静态图片
├── scripts/
│   └── update-holidays.js  # 年度节假日更新（每年 12/15 自动触发）
└── tests/
    └── test_new_project.js
```

---

## 数据库 Schema（主表）

| 表 | 说明 |
|---|---|
| `enterprises` | 企业实体（多租户隔离，所有业务表含 `enterprise_id`）|
| `users` | 用户（角色：`admin/manager/basic`）|
| `resources` | 员工/资源（可关联 user）|
| `clients` | 客户 |
| `projects` | 项目（关联 client）|
| `bookings` | 排班记录 |
| `timesheets` | 工时记录 |
| `leave_entries` | 请假记录 |
| `sessions` | 登录会话 Token |
| `invitations` | 邀请链接 |
| `join_requests` | 加入企业申请 |
| `password_reset_tokens` | 密码重置 Token |

迁移通过 `migrate()` 函数在每次启动时幂等执行（`ALTER TABLE IF NOT EXISTS` 风格）。

---

## 权限模型（三角色）

```
admin   → 全权（管理用户、资源、排班、报表、企业设置）
manager → 创建/编辑自己的排班和项目/客户；查看报表
basic   → 只能查看自己的排班（只读）
```

旧的 `owner/member + perm_*` 字段已在 migrate() 中自动升级。

---

## API 路由概览

- `GET  /api/permissions` — 当前用户有效权限
- `GET  /api/holidays` — 节假日查询
- `POST /api/auth/register` — 注册（自动登录）
- `POST /api/auth/login` — 登录
- SSE  `/api/events` — 实时推送（排班变更广播至同企业所有在线用户）

---

## 部署信息

### 服务器
- **IP**: 47.241.10.142
- **用户**: root / `ABab123.`
- **域名**: resource.skandstudio.com（HTTPS）
- **面板**: 宝塔（BaoTa Panel）

### 服务器路径
- **应用目录**: `/www/wwwroot/resource.skandstudio.com`
- **Nginx 配置**: 通过宝塔管理
- **SSL 证书**: `/www/server/panel/vhost/cert/resource.skandstudio.com/`

### 进程管理
```bash
pm2 status crewboard           # 查看状态
pm2 logs crewboard             # 查看日志
pm2 restart crewboard          # 重启（不推荐，用下面的）
pm2 startOrReload ecosystem.config.js --update-env  # 正确重启方式
```

### 部署流程（在服务器上执行）
```bash
cd /www/wwwroot/resource.skandstudio.com
bash deploy.sh
```

`deploy.sh` 步骤：
1. 备份 SQLite 数据库
2. `git stash`（清除上次部署注入的版本号）
3. `git pull origin main --ff-only`
4. 用 commit hash 替换 `index.html` 中的 `__VERSION__` 占位符
5. `pm2 startOrReload ecosystem.config.js --update-env`

### 本地推送后在服务器部署
```bash
# 本地 push 代码后，SSH 到服务器执行：
ssh root@47.241.10.142
cd /www/wwwroot/resource.skandstudio.com && bash deploy.sh
```

---

## 缓存策略

| 文件类型 | 策略 |
|---|---|
| `index.html` | `no-cache, no-store`（每次必须重新请求）|
| `.js` / `.css` | `?v={commit-hash}` 版本号 + `no-cache, must-revalidate`（URL 变化触发重新下载）|
| 图片/字体 | `max-age=30d`（长期缓存）|

---

## 开发注意事项

- SQLite 单进程写入，PM2 用 `fork` 模式（不用 cluster）
- 前端是原生 JS SPA（无构建步骤），修改 `public/` 下文件直接生效
- `index.html` 中的 `__VERSION__` 是占位符，不要手动替换——由 `deploy.sh` 自动注入
- CSS 自定义样式必须在 Bootstrap 之后加载；`style.css` 是源入口，部署时由 `cleancss` 内联 `base/layout/components/schedule/pages` 后生成 `dist/style.min.css`
- `bootstrap-bridge.css` 是设计令牌桥接层，处理 Bootstrap 变量与业务样式的映射
- 节假日数据由 `scripts/update-holidays.js` 管理，PM2 每年 12 月 15 日自动运行
- 企微消息通知配置在企业设置中（`wecom_corp_id`, `wecom_agent_id`, `wecom_secret`）
