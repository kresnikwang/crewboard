#!/bin/bash
# CrewBoard 部署脚本
# 用法：bash deploy.sh
# 功能：拉取最新代码，用 git commit hash 替换静态资源版本号，重启服务

set -e

DEPLOY_DIR="/www/wwwroot/resource.skandstudio.com"

echo "=== [1/5] 备份数据库 ==="
cd "$DEPLOY_DIR"
BACKUP_FILE="db/resource-guru-backup-$(date +%Y%m%d_%H%M%S).db"
cp db/resource-guru.db "$BACKUP_FILE"
echo "  数据库备份至: $BACKUP_FILE"

echo "=== [2/5] 暂存本地改动（版本号注入等）==="
# index.html 在上次部署时被注入了版本号，git pull 前需要先 stash
# 避免 "Your local changes would be overwritten by merge" 错误
git stash 2>/dev/null || true

echo "=== [3/5] 拉取最新代码 ==="
git pull origin main --ff-only

echo "=== [4/5] 注入版本号（git commit hash）==="
HASH=$(git rev-parse --short HEAD)
echo "  当前 commit: $HASH"

# 先从 git 恢复 index.html（确保 __VERSION__ 占位符存在）
# 这样每次部署都能正确替换，不会因为上次替换而丢失占位符
git checkout HEAD -- public/index.html

# 将 __VERSION__ 占位符替换为当前 commit hash
sed -i "s/__VERSION__/${HASH}/g" public/index.html

echo "  已更新 index.html 中的资源版本号为: ?v=${HASH}"
grep "?v=" public/index.html | head -3

echo "=== [5/5] 重启服务（固定端口 3000）==="
# 使用 startOrReload 确保每次都从 ecosystem.config.js 读取最新配置（含 PORT=3000）
# 避免 pm2 restart 不重新读取 ecosystem 导致的端口漂移
pm2 startOrReload ecosystem.config.js --update-env
sleep 2
pm2 status crewboard

echo ""
echo "✅ 部署完成！版本号: $HASH"
echo "   访问: https://resource.skandstudio.com"
echo "   端口: 3000 (固定)"
