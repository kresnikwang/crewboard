# Resource Archive Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 管理员可存档和重新启用人员，保留人员资料及历史排班、休假、工时。

**Architecture:** 沿用项目的独立 `is_archived` 标记，`is_active` 继续表示未删除。默认人员列表、排班和提醒只使用未存档人员；历史读取和报表保持可用。新增企业隔离、管理员限定的 PATCH 操作，记录审计并广播 resource-change。

**Tech Stack:** Express 4、better-sqlite3、原生 JavaScript、Bootstrap、Playwright。

---

### Task 1: 数据与 API

**Files:** `db/schema.js`, `routes/api/resources.js`, `utils/server-i18n.js`, `tests/test_regression.js`。

1. 在回归测试增加存档、恢复、历史保留、角色拒绝、跨企业拒绝、已删除不可恢复的场景；运行 `npm run test:regression`，新场景应失败。
2. 幂等添加 `resources.is_archived INTEGER NOT NULL DEFAULT 0`，不把旧删除记录转为存档。
3. GET `/resources?archived=1` 返回存档人员；默认只返回未存档人员。PATCH `/resources/:id/archive` 和 `/unarchive` 修改该标记，只接受本企业管理员，已删除记录返回 404；重复操作幂等。

### Task 2: 排班与提醒

**Files:** `routes/api/schedule-data.js`, `routes/api/bookings.js`, `routes/api/leave.js`, `routes/api/wecom.js`, `scripts/reminder-*.js`。

1. 默认排班、企业微信映射和提醒排除存档人员。
2. 新建、改派和移动排班以及新增休假拒绝存档人员；保留历史读取和工时补录能力。
3. 使用回归测试验证存档后不可排班，恢复后原记录及 ID 保留。

### Task 3: 管理界面

**Files:** `public/js/manage.js`, `public/js/core.js`, `public/js/i18n.js`, `public/css/pages.css`, `e2e/resource-archive.spec.js`。

1. 应用 @frontend-design 和 @ui-ux-pro-max；保留 Inter 字体和现有蓝色按钮、白色表面、灰色说明文案，使用现有设计变量。
2. 在人员列表上方增加“启用中 / 已存档”筛选；存档列表有文字状态和“重新启用”操作，列表数据独立于排班的 `state.resources`。
3. 编辑窗口增加“存档人员 / 重新启用”；说明保留历史及账号权限不变，确认存档并提供成功/失败反馈；请求期间禁用按钮。
4. 本浏览器操作后及 SSE 事件后刷新相关缓存，切回排班或工时页读取最新人员。
5. 增加完整 UI 存档/恢复流程以及移动端布局检查。

### Task 4: 验证

1. `npm test`：默认 API、权限和邮件回归全部通过。
2. `npm run build`：生成排班、CSS、JS 产物。
3. `npm run test:e2e -- e2e/resource-archive.spec.js e2e/navigation.spec.js e2e/ux.spec.js e2e/schedule.spec.js`：人员及相关界面验证通过。
4. 临时数据库重复初始化验证迁移幂等；`git diff --check` 和 `git status --short` 检查交付，不包含数据库及测试输出。

## 完成与验证

- 已完成以上实现；删除仍是原有软删除，旧删除记录不会自动进入存档列表。
- `npm test`：security 91、regression 64、email 50，全部通过。
- 前端构建成功；人员存档、导航、排班及 UX 共 25 个不同的浏览器测试通过，包含多人 SSE 同步、失败重试、键盘筛选和手机编辑窗口。
- 临时数据库重复初始化两次，存档和删除标记保留，未重复添加字段；手机截图已检查。
- `git diff --check` 通过；测试数据库、截图及报告均在忽略目录。尚未发布生产。
