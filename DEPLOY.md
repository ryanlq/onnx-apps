# 🚀 快速部署到 Cloudflare Pages

## 方式 1：通过 GitHub 自动部署（推荐）

### 步骤 1：准备 Git 仓库

```bash
# 初始化 Git（如果还没有）
git init

# 添加所有文件
git add .

# 提交
git commit -m "feat: deploy ONNX web apps to Cloudflare Pages"

# 添加远程仓库（替换为你的仓库地址）
git remote add origin https://github.com/ryanlq/onnx-apps.git

# 推送代码
git push -u origin main
```

### 步骤 2：在 Cloudflare Pages 创建项目

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 点击 **Workers & Pages**
3. 点击 **Create application**
4. 选择 **Pages** → **Connect to Git**
5. 选择 **GitHub** 并授权
6. 选择仓库：`onnx-apps`
7. 配置构建设置：

```
Project name: onnx-apps
Production branch: main
Build command: pnpm run build
Build output directory: dist
```

8. 添加环境变量：

```
NODE_ENV=production
VITE_MODEL_BASE_URL=https://huggingface.co/ryanli123/onnx/resolve/main
```

9. 点击 **Save and Deploy**

### 步骤 3：等待部署完成

- 构建时间：约 3-5 分钟
- 部署完成后会显示：`https://onnx-apps.pages.dev`

---

## 方式 2：手动上传部署

### 步骤 1：构建

```bash
# 构建生产版本
pnpm run build

# 检查构建产物
ls dist/
```

### 步骤 2：上传

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 点击 **Workers & Pages**
3. 点击 **Create application**
4. 选择 **Pages** → **Upload Assets**
5. 上传整个 `dist/` 文件夹
6. 部署完成

---

## ✅ 部署后检查

### 测试清单

- [ ] 访问应用主页
- [ ] 测试 RMBG（背景移除）
- [ ] 测试 MIGAN（图像修复）
- [ ] 测试 Whisper（语音识别）
- [ ] 检查浏览器控制台（无错误）
- [ ] 验证模型从 Hugging Face 加载

---

## 🔧 配置文件说明

### `public/_headers`

配置 COOP/COEP 头部以支持 `SharedArrayBuffer`：

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### `wrangler.toml.example`

Cloudflare Workers 配置示例（可选）

### `.env`

环境变量配置：

```bash
VITE_MODEL_BASE_URL=https://huggingface.co/ryanli123/onnx/resolve/main
```

---

## 📚 详细文档

查看完整部署指南：[CLOUDFLARE_PAGES_DEPLOYMENT.md](./CLOUDFLARE_PAGES_DEPLOYMENT.md)

---

## 🆘 需要帮助？

- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [部署常见问题](https://developers.cloudflare.com/pages/platform/troubleshooting/)
- [GitHub Issues](https://github.com/ryanlq/onnx-apps/issues)
