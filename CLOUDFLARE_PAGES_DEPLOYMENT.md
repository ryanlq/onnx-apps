# Cloudflare Pages 部署指南

## 📋 部署前检查清单

### ✅ 已完成的配置

- [x] 生产构建成功（`pnpm run build`）
- [x] COOP/COEP 头部配置（`public/_headers`）
- [x] Git 依赖配置（GitHub）
- [x] 模型托管（Hugging Face）
- [x] 环境变量配置（`.env`）

---

## 🚀 部署方式选择

### 方式 A：通过 GitHub 连接部署（推荐）⭐⭐⭐⭐⭐

**优点**：
- 自动 CI/CD
- 推送代码自动部署
- 预览部署
- 回滚功能

**步骤**：

#### 1. 推送代码到 GitHub

```bash
cd E:/代码/onnx-web-package-test/onnx-apps

# 初始化 Git（如果还没有）
git init

# 添加所有文件
git add .

# 提交
git commit -m "feat: deploy ONNX web apps to Cloudflare Pages"

# 推送到 GitHub
# 方式 1: HTTPS（需要 Personal Access Token）
git remote add origin https://github.com/ryanlq/onnx-apps.git
git branch -M main
git push -u origin main

# 方式 2: SSH（需要配置 SSH 密钥）
git remote add origin git@github.com:ryanlq/onnx-apps.git
git branch -M main
git push -u origin main
```

#### 2. 在 Cloudflare Pages 创建项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 选择 **Workers & Pages**
3. 点击 **Create application**
4. 选择 **Pages** → **Connect to Git**
5. 选择 **GitHub**（需要授权）
6. 选择你的仓库：`onnx-apps`

#### 3. 配置构建设置

在 **Set up builds and deployments** 页面：

**基础配置：**
```
Project name: onnx-apps (或自定义)
Production branch: main
Build command: pnpm run build
Build output directory: dist
Root directory: (留空)
```

**环境变量（Environment Variables）：**

点击 **Environment variables** 添加：

```bash
# 模型源配置
NODE_ENV=production
VITE_MODEL_BASE_URL=https://huggingface.co/ryanli123/onnx/resolve/main
```

**重要**：点击 **Save** 保存配置

#### 4. 开始部署

点击 **Save and Deploy**，Cloudflare Pages 会：
1. 克隆你的代码
2. 运行 `pnpm install` 安装依赖
3. 运行 `pnpm run build` 构建
4. 将 `dist/` 目录部署到 CDN

#### 5. 验证部署

部署完成后（约 3-5 分钟），你会看到：
- ✅ Deployment successful
- 🌐 访问 URL：`https://onnx-apps.pages.dev`

**测试清单**：
- [ ] 访问主页是否正常
- [ ] 测试 RMBG 应用（背景移除）
- [ ] 测试 MIGAN 应用（图像修复）
- [ ] 测试 Whisper 应用（语音识别）
- [ ] 检查浏览器控制台是否有错误
- [ ] 验证模型从 Hugging Face 加载

---

### 方式 B：手动上传部署（快速测试）

**优点**：
- 无需 GitHub
- 快速测试
- 一次性部署

**步骤**：

#### 1. 构建生产版本

```bash
cd E:/代码/onnx-web-package-test/onnx-apps

# 清理旧构建
rm -rf dist

# 构建
pnpm run build

# 验证 dist 目录存在
ls dist
```

应该看到：
```
dist/
├── index.html
├── assets/
│   ├── worker-*.js
│   ├── onnxruntime-*.js
│   ├── onnxruntime-worker-*.js
│   ├── ort-wasm-*.wasm
│   └── ...
```

#### 2. 在 Cloudflare Pages 创建项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 选择 **Workers & Pages**
3. 点击 **Create application**
4. 选择 **Pages** → **Upload Assets**

#### 3. 上传文件

1. 给项目命名：`onnx-apps`
2. 点击 **Browse** 或拖拽
3. 选择整个 `dist/` 文件夹
4. 点击 **Upload**

#### 4. 验证部署

部署完成后会提供访问 URL。

**注意**：手动上传需要：
- 每次更新都要重新上传
- 没有 CI/CD
- 不适合频繁更新

---

## 🔧 高级配置

### 自定义域名

#### 1. 添加自定义域名

1. 在 Cloudflare Pages 项目中
2. 点击 **Custom domains**
3. 点击 **Set up a custom domain**
4. 输入你的域名：`app.yourdomain.com`
5. 点击 **Activate**

#### 2. 配置 DNS

Cloudflare 会自动创建 DNS 记录。如果你的域名在其他注册商：

1. 复制 Cloudflare 提供的 CNAME 记录
2. 在你的域名注册商添加 CNAME 记录
3. 等待 DNS 生效（最多 48 小时）

### 环境变量管理

#### 生产环境变量

在 Cloudflare Pages → **Settings** → **Environment variables**：

```bash
# 模型源
VITE_MODEL_BASE_URL=https://huggingface.co/ryanli123/onnx/resolve/main

# 其他配置
NODE_ENV=production
```

#### 预览环境变量

可以为 Preview deployments 设置不同的变量。

### 重定向规则（可选）

创建 `public/_redirects` 文件：

```javascript
# SPA 路由支持
/*    /index.html   200
```

---

## 📊 监控和调试

### 查看部署日志

1. 在 Cloudflare Pages 项目中
2. 点击 **Deployments**
3. 选择一个部署记录
4. 点击 **Logs** 查看构建日志

### 实时日志

1. 点击 **Functions** → **Real-time logs**
2. 可以查看服务器端日志

### 分析

1. 点击 **Analytics**
2. 查看访问统计、性能指标

---

## 🐛 常见问题

### 问题 1: 构建失败

**错误**：`Error: Cannot find module 'onnx-web-framework'`

**原因**：pnpm 无法从 GitHub 下载依赖

**解决方案**：

在 `package.json` 中确保使用完整的 Git URL：

```json
{
  "dependencies": {
    "onnx-web-framework": "github:ryanlq/onnx-web-framework-package#v2.0.0"
  }
}
```

### 问题 2: COOP/COEP 错误

**错误**：`SharedArrayBuffer is not defined`

**原因**：缺少 COOP/COEP 头部

**解决方案**：

确保 `public/_headers` 文件存在且包含：

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### 问题 3: 模型加载失败

**错误**：`Failed to fetch model`

**原因**：Hugging Face 访问限制

**解决方案**：

确保环境变量正确设置：
```bash
VITE_MODEL_BASE_URL=https://huggingface.co/ryanli123/onnx/resolve/main
```

### 问题 4: Worker 错误

**错误**：`Failed to load worker`

**原因**：Worker 文件路径错误

**解决方案**：

1. 检查 `dist/assets/` 中是否有 `worker-*.js`
2. 检查浏览器控制台的网络请求

### 问题 5: WASM 文件 404

**错误**：`Failed to load WASM file`

**原因**：WASM 文件路径错误

**解决方案**：

确保 `public/_headers` 中包含 WASM 缓存规则：
```
/*.wasm
  Cache-Control: public, max-age=31536000, immutable
```

---

## 🔄 CI/CD 工作流

### 自动部署触发条件

连接 GitHub 后，以下操作会自动触发部署：

1. **Push 到 main 分支** → Production 部署
2. **Pull Request** → Preview 部署
3. **Merge PR** → Production 部署

### 跳过部署

在 commit message 中包含：
```
[skip ci]
[ci skip]
```

---

## 📈 性能优化建议

### 1. 启用 Cloudflare 缓存

已在 `_headers` 中配置：
- 静态资源：1 年缓存
- WASM 文件：1 年缓存

### 2. 使用 Cloudflare CDN

- 全球 CDN 节点
- 自动 HTTP/3
- Brotli 压缩

### 3. 图片优化

建议使用：
- WebP 格式
- 响应式图片
- 图片压缩

---

## 🔒 安全配置

### 1. 启用 HTTPS

Cloudflare Pages 默认启用 HTTPS。

### 2. 设置 CSP（可选）

在 `_headers` 中添加：

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
```

### 3. 访问控制（可选）

在 **Settings** → **Access control** 中：
- 密码保护
- IP 白名单
- Cloudflare Access

---

## 📝 部署后检查清单

### 功能测试

- [ ] **RMBG 应用**
  - [ ] 上传图片
  - [ ] 点击"处理"按钮
  - [ ] 查看处理结果
  - [ ] 下载结果

- [ ] **MIGAN 应用**
  - [ ] 上传图片
  - [ ] 绘制蒙版
  - [ ] 点击"修复"按钮
  - [ ] 查看修复结果
  - [ ] 对比原图

- [ ] **Whisper 应用**
  - [ ] 上传音频
  - [ ] 选择语言
  - [ ] 点击"转录"按钮
  - [ ] 查看转录结果
  - [ ] 下载文本

### 性能测试

- [ ] 首次加载时间 < 5 秒
- [ ] 模型加载进度显示
- [ ] 处理速度正常
- [ ] 无内存泄漏

### 兼容性测试

- [ ] Chrome (最新版)
- [ ] Edge (最新版)
- [ ] Firefox (最新版)
- [ ] 移动端浏览器

---

## 🎉 完成！

部署完成后，你会得到：
- ✅ 生产环境 URL：`https://onnx-apps.pages.dev`
- ✅ 自动 CI/CD
- ✅ 全球 CDN 加速
- ✅ 免费 SSL 证书
- ✅ DDoS 保护

**下一步**：
1. 测试所有功能
2. 配置自定义域名（可选）
3. 设置监控告警（可选）
4. 邀请用户测试

**需要帮助？**
- 查看 [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- 查看 [部署常见问题](https://developers.cloudflare.com/pages/platform/troubleshooting/)
