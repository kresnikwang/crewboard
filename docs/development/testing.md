# 测试指南

测试脚本会创建临时 SQLite 数据库和本地 HTTP 服务，默认不触碰开发数据库。测试之间应顺序运行，因为部分历史脚本使用固定端口。

## 命令矩阵

| 命令 | 覆盖范围 | 说明 |
| --- | --- | --- |
| `npm test` | security + regression + email | 当前默认 API 测试集合 |
| `npm run test:security` | 租户隔离、权限、限流、冲突、审计 | 认证和授权改动优先运行 |
| `npm run test:regression` | 认证、主数据、排班、请假、工时、报表 | 后端回归烟测 |
| `npm run test:email` | 忘记密码、邀请邮件 | 使用本地 SMTP sink，不发送真实邮件 |
| `npm run test:project` | 新建项目及权限场景 | 历史独立脚本，固定使用 `3099`，需先启动测试服务 |
| `npm run test:resource` | 协同管理、工作范围、报表导出 | 历史独立脚本，固定使用 `3099`，需先启动测试服务 |
| `npm run test:features` | 三个前端功能验证 | 需要可用的本地测试服务和测试账号 |
| `npm run test:e2e` | Playwright 全量 UI 流程 | 自动先执行 `npm run build`，使用 `e2e/.tmp/` 数据库 |
| `npm run test:all` | 默认 API 测试 + Playwright | 时间较长，适合发布前运行 |

也可以使用 `npm run test:e2e:headed` 或 `npm run test:e2e:ui` 调试浏览器流程。

`test:project` 和 `test:resource` 是早期的外部集成脚本，不会自动启动服务。需要先用临时数据库启动 `PORT=3099` 的本地服务，再顺序执行它们；不要指向生产服务。

## 测试数据位置

- `tests/test_security.js`、`tests/test_regression.js`、`tests/test_email_flows.js` 使用带时间戳的 `tests/.tmp/*.db`。
- `e2e/start-server.js` 使用 `e2e/.tmp/e2e.db`，Playwright 结束后由测试生命周期清理或覆盖。
- `e2e-report/`、`test-results/`、`playwright-report/` 等是测试输出，不提交。
- 若测试中途异常退出，先确认对应端口和 Node 进程已结束，再重新运行。

## 修改与测试对应关系

| 改动 | 最低验证 | 建议补充 |
| --- | --- | --- |
| 登录、会话、密码重置、限流 | `npm run test:security`、`npm run test:email` | `npm run test:e2e -- e2e/auth.spec.js` |
| 业务 API 或权限 | `npm run test:security`、`npm run test:regression` | 对应页面 E2E |
| 排班或工时 UI | `npm run build`、`npm run test:e2e` | 手动检查桌面与移动视图 |
| 数据库迁移 | 相关 API 测试、重启服务 | 在临时数据库上重复启动验证幂等性 |
| 邮件或企业微信 | 对应 mock/诊断脚本 | 不要在测试中使用生产密钥 |
| `deploy.sh` 或 PM2 | `bash -n deploy.sh` | 生产发布后执行健康检查 |

## E2E 调试提示

Playwright 配置在 `playwright.config.js`。它使用 `3399` 作为默认隔离端口，通过 `e2e/global-setup.js` 构建前端，再启动 `e2e/start-server.js`。如果只改了后端，不需要手动启动生产服务来跑 E2E。
