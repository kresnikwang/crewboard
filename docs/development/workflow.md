# 开发工作流

## 本地准备

需要已安装 Node.js、npm 和项目依赖。首次进入仓库：

```bash
npm ci
```

本地开发使用仓库自己的 SQLite 文件。不要把生产数据库复制进仓库，也不要把真实 SMTP、企业微信或 Webhook 密钥写进源码。

## 启动与构建

```bash
# 只生成前端发布产物
npm run build

# 启动服务（默认 3000；会使用当前 public/ 产物）
npm start

# 先构建，再启动服务
npm run dev
```

服务默认绑定 `127.0.0.1`。需要演示数据时，使用独立的本地数据库和环境变量，例如：

```bash
SEED_DEMO=1 npm start
```

`npm run dev` 不是热更新开发服务器；修改后需要重新运行构建或重启 Node 进程。

## 前端修改顺序

1. 排班功能：修改 `public/js/schedule/` 中对应的数字前缀文件。
2. 运行 `npm run bundle:schedule`，确认生成 `public/js/schedule.js`。
3. 运行 `npm run build`，更新 `public/js/dist/`。
4. 其他页面直接修改 `public/js/*.js` 后运行 `npm run build`。
5. 样式修改 `public/css/*.css` 源文件；生产部署阶段会生成 CSS 压缩产物。

不要直接改 `public/js/dist/`、`public/css/dist/` 或部署后被注入版本号的 `public/index.html`。

## 后端修改顺序

1. 先在 [代码地图](../architecture/code-map.md) 找到领域模块。
2. API endpoint 放在 `routes/api/<domain>.js`，认证 endpoint 放在 `routes/auth.js`。
3. 共享权限或数据逻辑放入已有 `utils/` helper，避免把跨领域逻辑复制到多个路由。
4. 表结构变化写入 `db/schema.js` 的幂等迁移，并为新行为补测试。
5. 涉及企业隔离、权限、认证、通知、SSE 的修改，需要同时检查相邻模块和安全测试。

## 常用检查

```bash
# 检查部署脚本语法
bash -n deploy.sh

# 检查构建产物能否生成
npm run build

# 查看当前工作树，确认没有误生成数据库或报告
git status --short
```

## 交付前顺序

```text
修改源码
  -> 运行相关窄测试
  -> npm test
  -> npm run build
  -> git diff --check
  -> 检查 git status 中没有 db/*.db、测试报告和 dist 之外的临时物
  -> 提交并推送
  -> 按部署手册执行生产发布
```

如果本次没有 E2E 覆盖，要在交付说明中明确写出，并至少完成对应的 API/回归测试。
