#!/bin/bash
# Cloudflare Pages 快速部署脚本

echo "================================"
echo "Cloudflare Pages 部署准备脚本"
echo "================================"
echo ""

# 检查当前分支
CURRENT_BRANCH=$(git branch --show-current)
echo "当前分支: $CURRENT_BRANCH"

# 检查是否有未提交的更改
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  检测到未提交的更改"
    echo "未提交的文件："
    git status --short
    echo ""
    read -p "是否继续部署？(y/n): " choice
    if [ "$choice" != "y" ]; then
        echo "❌ 已取消部署"
        exit 1
    fi
fi

# 确保构建通过
echo ""
echo "🔨 正在构建..."
pnpm run build

if [ $? -ne 0 ]; then
    echo "❌ 构建失败，请修复错误后重试"
    exit 1
fi

echo "✅ 构建成功"
echo ""

# 检查 dist 目录
if [ ! -d "dist" ]; then
    echo "❌ dist 目录不存在"
    exit 1
fi

echo "📦 构建产物："
du -sh dist
echo ""

# 显示必要文件
echo "✅ 必要文件检查："
[ -f "dist/index.html" ] && echo "  ✓ index.html" || echo "  ✗ index.html 缺失"
[ -f "dist/assets/worker-Dkh-YTfp.js" ] && echo "  ✓ worker.js" || echo "  ✗ worker.js 缺失"
[ -f "public/_headers" ] && echo "  ✓ _headers" || echo "  ✗ _headers 缺失"
echo ""

# Git 配置检查
echo "📋 Git 远程仓库："
git remote -v | grep "origin"
echo ""

echo "================================"
echo "部署准备完成！"
echo "================================"
echo ""
echo "📌 下一步操作："
echo ""
echo "方式 1：通过 GitHub 连接部署（推荐）"
echo "  1. 确保代码已推送到 GitHub"
echo "  2. 访问 https://dash.cloudflare.com/"
echo "  3. 选择 Workers & Pages → Create application"
echo "  4. 连接 GitHub 仓库"
echo "  5. 配置构建设置："
echo "     - Build command: pnpm run build"
echo "     - Build output: dist"
echo "     - Environment: NODE_ENV=production"
echo "     - Environment: VITE_MODEL_BASE_URL=https://huggingface.co/ryanli123/onnx/resolve/main"
echo ""
echo "方式 2：手动上传（快速测试）"
echo "  1. 访问 https://dash.cloudflare.com/"
echo "  2. 选择 Workers & Pages → Create application"
echo "  3. 选择 Upload Assets"
echo "  4. 上传 dist/ 文件夹"
echo ""
echo "📖 详细指南：查看 CLOUDFLARE_PAGES_DEPLOYMENT.md"
echo ""
