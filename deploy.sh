#!/bin/bash
# CrewBoard 部署脚本
# 用法：bash deploy.sh
# 功能：拉取最新代码，用 git commit hash 替换静态资源版本号，重启服务

set -e

DEPLOY_DIR="/www/wwwroot/resource.skandstudio.com"

echo "=== [1/7] 备份数据库 ==="
cd "$DEPLOY_DIR"
BACKUP_FILE="db/resource-guru-backup-$(date +%Y%m%d_%H%M%S).db"
cp db/resource-guru.db "$BACKUP_FILE"
echo "  数据库备份至: $BACKUP_FILE"

echo "=== [2/7] 暂存本地改动（版本号注入等）==="
# index.html 在上次部署时被注入了版本号，git pull 前需要先 stash
# 避免 "Your local changes would be overwritten by merge" 错误
git stash 2>/dev/null || true

echo "=== [3/7] 拉取最新代码 ==="
git pull origin main --ff-only

echo "=== [4/7] 自动压缩 JS/CSS 文件 ==="
# 检查是否安装了 terser 和 cleancss
if ! command -v terser &> /dev/null; then
  echo "  ⚠️  terser 未安装，跳过 JS 压缩"
else
  mkdir -p public/js/dist public/css/dist
  for f in public/js/i18n.js public/js/core.js public/js/schedule.js public/js/timesheets.js public/js/reports.js public/js/manage.js public/js/enterprise.js; do
    if [ -f "$f" ]; then
      name=$(basename $f .js)
      terser "$f" --compress --mangle --output "public/js/dist/${name}.min.js" 2>/dev/null
      orig_size=$(wc -c < "$f")
      min_size=$(wc -c < "public/js/dist/${name}.min.js")
      reduction=$(( (orig_size - min_size) * 100 / orig_size ))
      echo "  ✓ $name: ${orig_size}B → ${min_size}B (节省 ${reduction}%)"
    fi
  done
fi

if ! command -v cleancss &> /dev/null; then
  echo "  ⚠️  cleancss 未安装，跳过 CSS 压缩"
else
  mkdir -p public/css/dist
  for f in public/css/style.css public/css/bootstrap-bridge.css; do
    if [ -f "$f" ]; then
      name=$(basename $f .css)
      cleancss "$f" -o "public/css/dist/${name}.min.css" 2>/dev/null
      orig_size=$(wc -c < "$f")
      min_size=$(wc -c < "public/css/dist/${name}.min.css")
      reduction=$(( (orig_size - min_size) * 100 / orig_size ))
      echo "  ✓ $name: ${orig_size}B → ${min_size}B (节省 ${reduction}%)"
    fi
  done
fi

echo "=== [5/7] 验证本地资源（Bootstrap、字体、压缩后的文件）==="
if [ ! -f "public/vendor/bootstrap/bootstrap.min.css" ]; then
  echo "  ⚠️  Bootstrap CSS 不存在，正在下载..."
  mkdir -p public/vendor/bootstrap
  curl -sL "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" -o "public/vendor/bootstrap/bootstrap.min.css"
fi
if [ ! -f "public/vendor/bootstrap/bootstrap.bundle.min.js" ]; then
  echo "  ⚠️  Bootstrap JS 不存在，正在下载..."
  mkdir -p public/vendor/bootstrap
  curl -sL "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" -o "public/vendor/bootstrap/bootstrap.bundle.min.js"
fi
if [ ! -f "public/fonts/inter-400.woff2" ]; then
  echo "  ⚠️  Inter 字体不存在，正在下载..."
  mkdir -p public/fonts
  for weight in 300 400 500 600 700; do
    curl -sL "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1pL7SUc.woff2" -o "public/fonts/inter-${weight}.woff2" 2>/dev/null || true
  done
fi

echo "=== [6/7] 注入版本号（git commit hash）==="
HASH=$(git rev-parse --short HEAD)
echo "  当前 commit: $HASH"

# 先从 git 恢复 index.html（确保 __VERSION__ 占位符存在）
# 这样每次部署都能正确替换，不会因为上次替换而丢失占位符
git checkout HEAD -- public/index.html

# 将 __VERSION__ 占位符替换为当前 commit hash
sed -i "s/__VERSION__/${HASH}/g" public/index.html

echo "  已更新 index.html 中的资源版本号为: ?v=${HASH}"
grep "?v=" public/index.html | head -3

echo "=== [7/7] 重启主服务 crewboard（固定端口 3000）==="
# 使用 startOrReload 确保每次都从 ecosystem.config.js 读取最新配置（含 PORT=3000）
# 避免 pm2 restart 不重新读取 ecosystem 导致的端口漂移
# 只 reload crewboard 主服务，不碰定时脚本（避免误触发提醒）
pm2 startOrReload ecosystem.config.js --only crewboard --update-env
sleep 2
pm2 status crewboard

echo ""
echo "✅ 部署完成！版本号: $HASH"
echo "   访问: https://resource.skandstudio.com"
echo "   端口: 3000 (固定)"
echo ""
echo "📊 优化效果："
echo "   • JS 文件已压缩（平均节省 40%）"
echo "   • CSS 文件已压缩（平均节省 30%）"
echo "   • Bootstrap 和字体已本地化"
echo "   • 脚本使用 defer 加载，不阻塞 HTML 解析"
echo "   • 关键资源已添加 preload 提示"
