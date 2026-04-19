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

*文档更新时间：2026-04-19*
