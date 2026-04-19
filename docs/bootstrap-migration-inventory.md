# Bootstrap 5 迁移基线与审计清单

**作者：Manus AI**

## 1. 迁移原则与目标

本清单记录了 Crewboard 项目引入 Bootstrap 5 的基线状态。
核心原则：**业务不中断优先于视觉统一**，**保留语义类名作为 JS 选择器锚点**。

## 2. 页面与模块迁移矩阵

| 页面/模块 | 当前典型类名 | 是否被 JS 直接依赖 | Bootstrap 替换策略 |
|---|---|---|---|
| 登录/注册 | `.auth-*`, `.text-input`, `.btn` | 部分依赖 | 外层布局与表单可迁移，保留 ID 与关键语义类 |
| 资源管理 | `.resource-list`, `.form-group`, `.btn-*` | 中度依赖 | 表单、表格、按钮优先迁移 |
| 项目/客户管理 | `.pc-tab`, `.pc-table`, `.search-box` | 高 | Tabs/Table/Search 渐进迁移，保留业务类 |
| 企业设置 | `.enterprise-*`, `.theme-option` | 中 | Cards/Forms/List groups 可迁移 |
| 报表 | `.report-*` | 中 | Cards/Tables/Grid 可迁移 |
| 排班主网格 | `.schedule-*`, `.booking-*`, `.m-*` | 高 | 核心区域暂不直接迁移，仅做外围整理 |
| 全局模态框 | `.modal-*` | 高 | 后期切换到 Bootstrap Modal，前期保持原样 |

## 3. 关键 CSS 类名保留清单（禁止在第一轮删除）

以下类名在 `public/js/*.js` 中被用作 DOM 选择器或状态切换，**在完全重构对应 JS 逻辑前，必须保留在 HTML 元素上**：

- `.auth-view` (用于登录/注册视图切换)
- `.pc-tab` (用于项目/客户面板切换)
- `.modal` / `.modal-content` (全局弹窗基础结构)
- `.schedule-table` / `.booking-cell` / `.booking-block` (排班核心交互)
- `.toast` (全局提示)

## 4. 阶段 1 实施记录

- [x] 在 `public/index.html` 引入 Bootstrap 5 CSS (CDN)
- [x] 在 `public/index.html` 引入 Bootstrap 5 JS Bundle (CDN)
- [x] 确保 `style.css` 在 Bootstrap CSS 之后加载
- [x] 在 `public/js/core.js` 增加 Bootstrap 可用性检测

## 5. 阶段 2 实施记录

- [x] 新增 `public/css/bootstrap-bridge.css` 兼容层
- [x] `index.html` 中引入 `bootstrap-bridge.css`（位于 `style.css` 之后）
- [x] CSS 加载顺序：Bootstrap CSS → style.css → bootstrap-bridge.css

**兼容层主要内容：**

| 内容 | 说明 |
|---|---|
| 设计令牌映射 | Crewboard `--primary`/`--bg`/`--border`/`--font`/`--radius` 映射到 Bootstrap `--bs-*` 变量 |
| Bootstrap Reboot 修正 | 保持 14px 基准字号，防止 Reboot 改变全局字体大小 |
| 组件外观对齐 | `.btn`/`.form-control`/`.table`/`.card`/`.nav-tabs`/`.modal` 对齐 Crewboard 视觉 |
| 桥接类 | `.text-input`/`.select-input`/`.form-group`/`.section-card` 与 Bootstrap 共存 |
| 工具类补充 | `.bg-primary-light`/`.bg-surface`/`.text-primary-custom` 等业务常用辅助类 |

## 6. 阶段 3 实施记录

- [x] 登录视图：输入框叠加 `form-control`，`form-group` 叠加 `mb-3`，`label` 叠加 `form-label`，按钮叠加 `w-100 d-flex justify-content-center`
- [x] 注册视图：双列表单改用 `row g-2` + `col-6`，其余同登录视图
- [x] 首次登录改密视图：同步迁移
- [x] 忘记密码视图：同步迁移
- [x] 重置密码视图：同步迁移
- [x] `bootstrap-bridge.css` 新增第6节：阶段3 认证页专项修正（图标定位、错误提示、按钮样式）

**迁移原则遵守情况：**

| 项目 | 处理方式 |
|---|---|
| 所有表单控件 `id` | 全部保留，JS 选择器不受影响 |
| `.auth-view` / `.auth-view.active` | 保留，登录/注册视图切换逻辑不受影响 |
| `.text-input` | 保留，叠加 `form-control`（双类并存） |
| `.btn-block` | 保留，叠加 `w-100 d-flex justify-content-center` |
| `.auth-error` / `.auth-hint` | 保留，在 bridge.css 中增强样式 |

## 7. 阶段 4 实施记录

- [x] `index.html`：视图切换按钮叠加 `.btn-group`，报表工具栏 `select` 叠加 `.form-select`，日期输入叠加 `.form-control`，报表预设按钮叠加 `.btn-group`，搜索框改为 `.input-group`，pc-tabs 叠加 `.nav-tabs .nav-link`
- [x] `manage.js`：`res-table` 叠加 `.table .table-hover .table-sm .align-middle`，`pc-table`（项目/客户/存档全部4处）叠加 `.table .table-hover .table-sm .align-middle`，角色下拉叠加 `.form-select-sm`，tab 点击处理器同步 `aria-selected`
- [x] `reports.js`：`report-summary` 改为 Bootstrap `.row .g-3`，`summary-card` 叠加 `.card`，`report-charts` 改为 Bootstrap `.row .g-3`，`report-chart-card` 叠加 `.card`，`report-table` 叠加 `.table .table-hover .table-sm`，`drill-table` 叠加 `.table .table-sm`
- [x] `enterprise.js`：`section-card` 叠加 `.card .mb-3`，`form-group` 叠加 `.mb-3`，`form-row` 叠加 `.row .g-3`，所有 `.text-input` 叠加 `.form-control`
- [x] `bootstrap-bridge.css`：新增阶段4专项修正（section-card、summary-card、report-chart-card、res-table、pc-table、report-table、drill-table、form-select、form-control、input-group、nav-tabs、btn-group 等）

**保留的 JS 钩子（未改动）：**

| 保留项 | 原因 |
|---|---|
| 所有 `id` 属性 | JS 事件绑定依赖 |
| `.res-table` / `.pc-table` / `.report-table` | JS DOM 操作钩子 |
| `.section-card` / `.form-group` / `.form-row` | JS 内容渲染钩子 |
| `.pc-tab` / `data-tab` | 标签页切换逻辑 |
| `pcActiveTab` / `pcSearchQuery` 状态变量 | 搜索/筛选逻辑 |

## 8. 阶段 5 实施记录

- [x] `index.html`：将 `#modal-overlay` + `#modal` 替换为标准 Bootstrap Modal HTML（`.modal.fade` + `.modal-dialog.modal-dialog-centered.modal-dialog-scrollable` + `.modal-content`），保留所有 `#modal-title`/`#modal-body`/`#modal-footer` ID
- [x] `core.js`：重写 `showModal`/`closeModal` 使用 `bootstrap.Modal.getOrCreateInstance()`，内容清空改为监听 `hidden.bs.modal` 事件，移除旧的手动事件监听器
- [x] `manage.js`：将 `rg-modal`/`bk-modal` 类名清除改为监听 `hidden.bs.modal` 事件
- [x] `bootstrap-bridge.css`：新增阶段5修正（modal 内容区对齐、rg-modal/bk-modal 宽度、backdrop 颜色、body.modal-open 修正）

**新增功能：**

| 功能 | 说明 |
|---|---|
| ESC 键关闭 | Bootstrap Modal 原生支持 |
| 点击背景关闭 | Bootstrap Modal 原生支持 |
| 无障碍属性 | `aria-labelledby`、`aria-hidden`、`role="dialog"` |
| 关闭动画 | Bootstrap `.fade` 动画 |
| 滑动内容 | `modal-dialog-scrollable` |
| 垂直居中 | `modal-dialog-centered` |
| 尺寸切换 | `rg-modal`(540px) / `bk-modal`(520px) 通过 `:has()` CSS 选择器控制 |

*文档更新时间：2026-04-19*
