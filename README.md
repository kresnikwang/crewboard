# CrewBoard — 团队资源排程与工时管理系统

**神马排班 CrewBoard** 是一款轻量级、高性能的团队资源排程与工时管理系统，旨在帮助企业和团队轻松搞定“谁在什么时间做什么项目”的问题。系统基于敏捷管理思想设计，提供直观的拖拽式排班日历、工时表追踪、数据报表分析以及主流办公协同软件（微信企业号、钉钉、飞书）的实时通知集成。

---

## 目录
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [系统架构与原理](#系统架构与原理)
- [数据库设计](#数据库设计)
- [角色与权限模型](#角色与权限模型)
- [快速开始 (本地运行)](#快速开始-本地运行)
- [生产环境部署](#生产环境部署)
- [三方集成指南](#三方集成指南)
  - [三方 Webhook 机器人通知](#三方-webhook-机器人通知)
  - [企业微信自建应用同步](#企业微信自建应用同步)
- [进阶维护](#进阶维护)
  - [节假日自动更新](#节假日自动更新)
  - [前端静态版本缓存策略](#前端静态版本缓存策略)

---

## 核心特性

1. **可视化资源排程 (Visual Scheduling)**
   - **双视图切换**：支持周视图和月视图，直观展示团队每名成员每天的工作饱合度。
   - **直观交互**：采用 Bootstrap 与原生 JS 实现的响应式网格布局，支持新增、修改和快捷编辑排班。
   - **预订状态区分**：支持“正式排程”与“临时/意向排程”（Tentative, 界面上以虚线边框样式呈现），方便项目前期筹备规划。
   - **请假与假期整合**：中国法定节假日（包含放假和调休）自动高亮显示，支持员工批量请假登记，防止排程冲突。

2. **工时表与实际追踪 (Timesheets & Actuals)**
   - **工时填报**：员工可以按天、按项目记录实际消耗的工时，并支持填写备注信息。
   - **快捷一键复制**：支持“从排程复制”功能，一键将本周排班计划转换为工时草稿，极大减少日常填报负担。

3. **多维度数据报表 (Reports & Analytics)**
   - **资源利用率报表**：按人员或部门分析工时分布，自动计算团队成员的利用率百分比，发现负荷过重或闲置情况。
   - **项目投入报表**：按客户和项目维度统计累计工时，支持按具体人员穿透钻取（Drill-down）明细。
   - **Excel 深度导出**：后端基于 `exceljs` 动态生成格式美观的多 Sheet 报表，包括人员利用率总览、各项目工时占比等，直接对接财务或管理分析。

4. **实时协同同步 (Real-time SSE Broadcast)**
   - 采用 **SSE (Server-Sent Events)** 协议。当管理员或项目经理添加、修改或删除排班时，变更会在秒级内自动广播推送到同企业所有在线用户的浏览器上，无需刷新即可实现排班表多端联动。

5. **企业级协作与权限**
   - **多租户隔离**：支持多企业（租户）独立注册，每个企业使用专属的企业代码（Enterprise Code），保障数据安全隔离。
   - **自主申请/邀请制**：新员工可通过企业代码申请加入，或者由管理员通过邮箱发送带有 Token 的专属邀请链接，保障企业边界。
   - **密码保障**：支持首次登录强制修改初始密码，以及基于邮件重置密码的安全流程。

6. **三方应用与通知集成**
   - **IM 通知**：集成钉钉、企业微信、飞书群机器人 Webhook，在新建、修改或取消排班时自动推送通知至群组。
   - **企业微信深度集成**：支持通过企业微信 API，一键同步企业微信的组织架构和成员到系统中，并向员工推送排程变更的微信卡片通知。

---

## 技术栈

| 分层 | 选用技术 / 框架 | 备注 |
| :--- | :--- | :--- |
| **后端** | Node.js + Express 4 | 轻量、高并发性能，完全异步架构 |
| **数据库** | SQLite + better-sqlite3 | 启用 WAL (Write-Ahead Logging) 模式，单文件数据库，无缝应对读写分离并发 |
| **前端** | 原生 JavaScript SPA + Bootstrap 5.3 | 无重度打包步骤，极速加载，CSS 精细模块化管理，极佳的本地部署体验 |
| **进程管理** | PM2 | 支持优雅重载（pm2 reload）与日志轮转 |
| **反向代理** | Nginx | 静态资源强缓存与反向代理，SSE 连接长效保持配置 |
| **通知与邮件** | Nodemailer / Fetch API | 用于发送系统邮件以及三方 Webhook / 企业微信 API 调用 |
| **报表导出** | ExcelJS | 支持格式化、公式、样式的复杂 Excel 导出 |

---

## 目录结构

以下为项目核心的目录结构：
```
crewboard/
├── server.js               # Express 启动文件（挂载路由、初始化 DB、启用 WAL）
├── ecosystem.config.js     # PM2 进程配置文件（固定端口 3000，使用 fork 模式）
├── nginx.conf              # Nginx 生产环境配置（含 SSE keep-alive 及静态资源缓存）
├── deploy.sh               # 自动化部署脚本（自动备份 DB、注入 Git 版本号、热重载）
├── db/
│   ├── schema.js           # 数据库建表、多版本幂等迁移及 Seed 演示数据逻辑
│   ├── holidays.js         # 中国法定节假日预置数据与辅助函数
│   └── resource-guru.db    # SQLite 数据库文件（生产环境自动生成，不提交 git）
├── routes/
│   ├── api.js              # 核心业务 API（排班、工时、报表导出、微信同步、SSE）
│   ├── auth.js             # 企业注册/登录、邀请加入、密码重置、权限控制
│   └── webhook.js          # 钉钉/企业微信/飞书 Webhook 消息发送逻辑
├── utils/
│   ├── email.js            # 基于 Nodemailer 的密码重置与邀请邮件发送封装
│   └── wecom.js            # 企业微信自建应用获取 AccessToken 及推送卡片消息的 API 封装
├── public/
│   ├── index.html          # 前端单页面应用 (SPA) 入口（含前端 __VERSION__ 占位符）
│   ├── css/
│   │   ├── style.css       # CSS 总入口（通过 @import 组织各个子文件）
│   │   ├── base.css        # Reset、全局 CSS 变量（设计令牌）、基础排版
│   │   ├── layout.css      # 侧边栏、移动端 Topbar、多页面自适应外壳
│   │   ├── components.css  # 通用按钮、表格、表单控件及弹窗样式
│   │   ├── schedule.css    # 核心排班表格、日历 booking 条、休假背景高亮
│   │   ├── pages.css       # 登录、报表明细、管理后台、企业设置等特有样式
│   │   └── bootstrap-bridge.css  # 设计令牌与 Bootstrap 默认样式的映射桥接层
│   ├── js/
│   │   ├── core.js         # 前端运行基石（Auth 会话管理、API 请求器、SSE 接收、全局 i18n 渲染）
│   │   ├── schedule.js     # 资源排程页面（拖拽、Booking 弹窗、周/月日历渲染）
│   │   ├── timesheets.js   # 工时表填报页面逻辑
│   │   ├── reports.js      # 报表统计及详情钻取展示逻辑
│   │   ├── manage.js       # 人员管理、项目管理、客户管理及存档功能
│   │   ├── enterprise.js   # 企业设置后台（含成员角色修改、邀请、三方通知配置）
│   │   └── i18n.js         # 国际化语料包（支持中/英双语，全静态资源匹配）
│   └── img/                # 系统静态图标及 Logo
├── scripts/
│   └── update-holidays.js  # 法定节假日抓取脚本（调用 timor.tech API 自动生成 db/holidays.js）
└── tests/
    └── test_new_project.js  # 自动化测试脚本
```

---

## 系统架构与原理

### SSE 实时广播机制
系统使用 Server-Sent Events (SSE) 实现实时同步，通道位于 `/api/sse`。
- 用户登录进入主页后，前端会自动发起长连接建立 SSE 监听。
- 后端在收到增删改排班请求（`POST/PUT/DELETE /api/bookings`）并成功写入数据库后，会向全局 SSE 连接池中的所有属于 **同一企业** 的在线客户端发送类型为 `booking_change` 的事件广播。
- 其他用户的浏览器接收到事件后，会自动刷新排程数据（`GET /api/schedule-data`），从而使不同显示终端时刻保持数据一致。

### SQLite WAL 模式
为了在本地部署时提供极高的读写性能，CrewBoard 开启了 SQLite 的 **Write-Ahead Log (WAL)** 模式。
- WAL 模式下，写操作不会阻塞读操作，支持多线程并发读取。
- 事务写入直接写入 WAL 缓冲文件，由系统自动 checkpoint 同步，确保数据落盘且极大降低了 I/O 延迟。
- 数据库连接采用 `better-sqlite3`，性能优于异步的 `sqlite3` 驱动，更加适合单进程 Node 服务。

---

## 数据库设计

系统共包含 12 张核心表，全部定义在 [db/schema.js](file:///Users/kresnikwang/Work/crewboard/db/schema.js) 中：

1. **`enterprises` (企业租户表)**
   - 记录企业名称、企业代码 (code)、所有者 (owner_id)、三方 Webhook 链接和企业微信应用配置（ID、Secret、AgentID）。
2. **`users` (用户账号表)**
   - 记录用于登录的手机号、邮箱、密码 Hash（加盐 scrypt 算法）、绑定的资源 ID (`resource_id`)、系统角色（`role`：`admin`/`manager`/`basic`）及管理权限细项。
3. **`resources` (人员/资源表)**
   - 记录用于排班的员工实体。包括姓名、对应邮箱、角色/工种、所属团队、看板显示颜色及每天标准工时（默认8小时）。可关联对应的 `users` 账号。
4. **`clients` (客户表)** & **`projects` (项目表)**
   - 项目关联客户。包含项目编码、起止日期、预算工时、计费状态 (billable) 以及当前是否归档的标志 (`is_archived`)。
5. **`bookings` (排班记录表)**
   - 排班的核心数据，按天记录员工绑定的项目及对应的小时数（支持非 8 小时的零碎排班）。
6. **`timesheets` (工时记录表)**
   - 记录员工每日在各项目上实际填报的工时。包含唯一索引 `idx_timesheets_unique (resource_id, project_id, date)`，防止重复填报。
7. **`leave_entries` (休假记录表)**
   - 记录员工的具体请假类型（如年假、事假、病假等）与日期。在排班日历中表现为灰色斑马线高亮。
8. **`sessions` (会话 Token 表)** & **`invitations` (成员邀请表)** & **`join_requests` (加入企业申请表)** & **`password_reset_tokens` (重置密码凭证表)**
   - 用于管理用户生命周期、会话保持与认证安全。

---

## 角色与权限模型

CrewBoard 使用三角色模型，具体权限边界如下：

| 功能模块 | 系统管理员 (`admin`) | 项目经理 (`manager`) | 基础成员 (`basic`) |
| :--- | :--- | :--- | :--- |
| **企业设置** | 可编辑（三方配置、结算货币等） | 无权访问 | 无权访问 |
| **成员管理** | 修改角色、邀请成员、审批申请 | 查看列表 | 无权访问 |
| **人员/资源管理** | 全权（增/删/改/活跃状态） | 只读 | 无权访问 |
| **客户与项目** | 全权创建、修改和归档 | 只能创建/修改自己负责的项目 | 只读 |
| **可视化排班** | 任意排班添加与修改 | 只能为自己负责的项目安排人员 | 只读（只能看自己的排班） |
| **工时表** | 全权查看，代他人录入工时 | 查看报表 | 只能填报及编辑自己的工时 |
| **数据报表** | 查看并导出所有项目与人员报表 | 只能查看自己相关项目的报表 | 无权访问 |

---

## 快速开始 (本地运行)

### 前置条件
- 安装 **Node.js** (推荐 v18 或更高版本)。
- 系统不需要安装任何外部数据库（如 MySQL/Postgres），数据库使用内嵌的 SQLite。

### 1. 安装依赖
克隆项目后，在根目录下运行以下命令安装所需 Node 模块：
```bash
npm install
```

### 2. 初始化数据库与演示数据
CrewBoard 支持通过环境变量自动注入一组演示数据（包含 8 名员工、4 个客户、5 个项目以及跨越三周的完整排班和用户账号），用于本地测试。
```bash
# Windows 命令提示符 (CMD)
set SEED_DEMO=1
node server.js

# macOS / Linux / Windows PowerShell
SEED_DEMO=1 node server.js
```
运行后，终端将输出 `Demo data seeded.`，并在 [db/](file:///Users/kresnikwang/Work/crewboard/db/) 目录下生成 `resource-guru.db` 数据库文件。

### 3. 开发模式启动
启动开发服务器（支持热代码调用，默认端口为 3000）：
```bash
npm run dev
```
打开浏览器访问 [http://127.0.0.1:3000](http://127.0.0.1:3000) 即可开始使用。
- **系统预置超级管理员账号**：
  - 账号：`admin@company.com`
  - 密码：`admin123`
- **普通员工演示账号**：
  - 账号：`zhangwei@company.com` 至 `zhoujie@company.com`
  - 密码：`123456`

---

## 生产环境部署

在生产环境中，建议使用 **Nginx** 作为反向代理并提供 SSL 证书，并配合 **PM2** 进行 Node 进程的常驻管理。

### 1. PM2 进程配置
项目根目录下提供了 [ecosystem.config.js](file:///Users/kresnikwang/Work/crewboard/ecosystem.config.js)。它被配置为单实例 `fork` 模式，以避免 SQLite 多进程并发写入锁库。
启动/热重载命令：
```bash
# 启动应用
npm run pm2:start

# 优雅重载进程 (无缝平滑重载)
pm2 startOrReload ecosystem.config.js --update-env

# 查看实时日志
npm run pm2:logs
```

### 2. Nginx 配置
为了使 SSE 实时广播长连接不被 Nginx 超时断开，并且让静态资源拥有正确的缓存，请参考 [nginx.conf](file:///Users/kresnikwang/Work/crewboard/nginx.conf) 的核心逻辑进行配置：
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # 强制跳转 HTTPS (推荐)
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.key;

    # 静态资源缓存配置
    root /www/wwwroot/crewboard/public;

    location / {
        try_files $uri $uri/ /index.html;
        expires -1; # index.html 不缓存
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # 带版本号的 JS/CSS 开启 revalidate 缓存
    location ~* \.(js|css)$ {
        add_header Cache-Control "public, no-cache, must-revalidate";
    }

    # 图片/字体强缓存 30 天
    location ~* \.(png|jpg|jpeg|gif|ico|svg|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000";
    }

    # 代理后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # 核心：SSE 长连接必要配置，防止代理超时断开
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s; # 延长读取超时时间至 1 小时
        proxy_buffering off;      # 关闭缓冲，使事件实时推送
        proxy_cache off;          # 禁用缓存
    }
}
```

### 3. 一键部署脚本 (`deploy.sh`)
服务器上的更新通常可以使用本地推送后在服务器端执行 [deploy.sh](file:///Users/kresnikwang/Work/crewboard/deploy.sh) 的流程：
1. 自动热备份当前的 SQLite 数据库。
2. 丢弃部署临时修改（如占位符），拉取最新 `main` 分支代码。
3. 获取最新的 Git Commit Hash，自动替换前端 [index.html](file:///Users/kresnikwang/Work/crewboard/public/index.html) 中引入的 `?v=__VERSION__` 占位符，触发浏览器端资源强行更新。
4. 调用 `pm2 reload` 实现零停机平滑重启。

```bash
# SSH 连接至服务器并执行部署
ssh root@your-server-ip "cd /www/wwwroot/your-app-path && bash deploy.sh"
```

---

## 三方集成指南

### 三方 Webhook 机器人通知
1. 以管理员账号登录系统，进入 **企业管理** (Enterprise Settings)。
2. 在 **通知配置** 部分，填入对应平台的群机器人 Webhook 地址：
   - **钉钉 Webhook**：格式为 `https://oapi.dingtalk.com/robot/send?access_token=...`
   - **企业微信 Webhook**：格式为 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`
   - **飞书 Webhook**：格式为 `https://open.feishu.cn/open-apis/bot/v2/hook/...`
3. 保存设置。系统将在产生新排程、排程被修改、排程被取消时，向配置好的机器人发送通知。

### 企业微信自建应用同步
系统内置了直接与企业微信自建应用同步组织架构和推行应用卡片通知的功能。

#### 步骤一：创建企业微信自建应用
1. 登录企业微信管理后台，在 **应用管理** -> **自建** 中创建一个名为 “神马排班” 的应用。
2. 记录以下关键配置信息：
   - **企业 ID (CorpID)** (在“我的企业”最下方)
   - **应用 AgentId**
   - **应用 Secret**

#### 步骤二：在系统中配置应用凭证
1. 在 **企业管理** 后台，填入上述三个配置信息。
2. 填入 **自建应用关联部门 ID**（默认为 1，即根部门）。
3. 点击 **保存企业微信配置**。

#### 步骤三：同步人员及绑定
1. 点击 **同步企业微信架构** 按钮，系统会调用企业微信接口获取该部门下的所有员工，并在“人员管理”中自动创建对应的“资源”。
2. 为了能推送单人卡片通知，请确保在 **人员管理** 中编辑员工时，填写了正确的 **企业微信 UserID** (可在企微后台的成员详情中获取)。

---

## 进阶维护

### 节假日自动更新
系统的考勤和排程日历需要依赖每年的国家法定节假日发布。
- 系统在 [scripts/update-holidays.js](file:///Users/kresnikwang/Work/crewboard/scripts/update-holidays.js) 中提供了自动化脚本，调用 timor.tech 公开 API 抓取下一年度的放假及调休安排。
- **定时任务**：PM2 在启动时会根据配置在每年 **12 月 15 日** 自动运行该脚本，更新 `db/holidays.js` 文件，无需人工干预。手动运行命令：
  ```bash
  npm run update-holidays
  ```

### 前端静态版本缓存策略
为了保障流畅的加载体验同时避免版本更新时产生缓存不一致，CrewBoard 在前后端进行了联动设计：
- **HTML (index.html)**：在后端（`server.js`）及 Nginx 中配置为完全不缓存（`no-cache, no-store`）。浏览器每次加载页面都必须先请求服务器获取最新的 HTML。
- **JS/CSS 依赖**：前端所有主要的 JS/CSS 链接都在 `index.html` 中通过带有 `?v=__VERSION__` 的形式加载。
- 部署时，部署脚本将 `__VERSION__` 动态替换为当前的 Git Commit 哈希。当代码更新后，HTML 内的链接版本号改变，浏览器会立即丢弃旧的 CSS/JS 缓存并下载最新版本，而未更改时则继续利用本地缓存。
- **静态图片/字体**：配置了 30 天的强缓存（`Cache-Control: max-age=2592000`），避免重复请求无变动的资源，提高二次访问速度。

---

祝您使用 **神马排班 CrewBoard** 愉快！如有任何问题或二次开发需求，请联系团队管理员。
