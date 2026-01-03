# 🎭 RMBG 一键去背景工具

基于 React + Vite + TypeScript 开发的智能抠图网页应用，使用 `onnx-web-framework` 和 RMBG 模型实现高质量背景分离。

## ✨ 功能特性

- **🖼️ 一键去背景**：上传图片，点击处理，即可获得无背景图片
- **🔄 实时对比**：使用图片对比滑块查看处理前后效果
- **💾 本地优先**：优先使用本地模型，支持离线使用
- **🌐 在线备用**：如果本地模型不存在，自动使用在线模型
- **📱 响应式设计**：完美适配桌面和移动设备
- **⚡ 现代技术栈**：React 19 + TypeScript + Vite + Tailwind CSS

## 🚀 快速开始

### 1. 环境要求

- Node.js 18+
- pnpm (推荐)

### 2. 安装依赖

```bash
pnpm install
```

### 3. 开发模式

```bash
pnpm run dev
```

访问：http://localhost:5173

### 4. 构建生产版本

```bash
pnpm run build
```

构建产物位于 `dist` 目录。

### 5. 预览构建结果

```bash
pnpm run preview
```

## 📁 项目结构

```
rmbg/
├── src/
│   ├── RMBGApp.tsx          # 主应用组件
│   ├── App.tsx              # 根组件
│   ├── App.css              # 全局样式
│   ├── vite-env.d.ts        # Vite 类型声明
│   └── types/               # 自定义类型定义
│       └── onnx-web-framework.d.ts
├── public/
│   └── onnx-models/         # 模型文件目录
│       └── rmbg_quantized.ort # RMBG 模型 (43MB)
├── dist/                    # 构建输出目录
├── package.json             # 项目配置
├── vite.config.ts           # Vite 配置
├── tsconfig.app.json        # TypeScript 应用配置
└── README.md               # 项目说明
```

## 🛠️ 技术栈

### 前端框架
- **React 19.2** - 用户界面框架
- **TypeScript 5.9** - 类型安全的 JavaScript
- **Vite 7.3** - 现代前端构建工具

### UI 组件
- **img-comparison-slider** - 图片对比滑块组件（Web Component）
- **自定义样式** - 基于现代 CSS 的响应式设计

### AI 模型集成
- **onnx-web-framework** - 自定义 ONNX 推理框架
- **onnxruntime-web** - ONNX 模型运行时
- **RMBG 模型** - 背景分离深度学习模型

### 开发工具
- **ESLint** - 代码质量检查
- **pnpm** - 包管理器

## 🎯 使用说明

1. **上传图片**：
   - 点击上传区域选择图片
   - 或直接拖拽图片到上传区域
   - 支持 JPG、PNG、WebP 格式

2. **处理图片**：
   - 点击"开始处理"按钮
   - 等待 AI 分析和处理（约 2-5 秒）
   - 处理过程中显示进度提示

3. **查看结果**：
   - 左右滑动滑块对比处理前后效果
   - 滑块左侧显示原始图片
   - 滑块右侧显示去除背景后的图片

4. **下载结果**：
   - 点击"下载无背景图片"按钮
   - 保存为 PNG 格式的透明背景图片

## 🔧 配置选项

### 模型配置

可以在 `src/RMBGApp.tsx` 中修改模型配置：

```typescript
// 本地模型路径（优先）
const modelUrl = '/onnx-models/rmbg_quantized.ort';

// 在线备用模型
const fallbackUrl = 'https://www.modelscope.cn/models/duchao/rmbg_quantized/resolve/master/rmbg_quantized.ort';
```

### ONNX 框架配置

```typescript
const framework = new ONNXWebFramework({
  executionProviders: ['wasm', 'webgl'],  // 执行提供者
  enableProfiling: false,                 // 性能分析
  debug: false,                           // 调试模式
  useWorker: true                         // 使用 Web Worker
});
```

## 📊 性能优化

- **Web Worker**：模型推理在后台线程运行，不阻塞 UI
- **模型缓存**：自动缓存模型文件，减少重复下载
- **分块下载**：大型模型文件支持断点续传
- **代码分割**：onnx-web-framework 作为独立 chunk 加载

## 🐛 故障排除

### 常见问题

1. **模型加载失败**：
   - 检查 `public/onnx-models/rmbg_quantized.ort` 是否存在
   - 检查网络连接（在线模型需要）
   - 查看浏览器控制台错误信息

2. **构建失败**：
   - 确保 `onnx-web-framework` 包正确链接
   - 检查 Vite 配置中的路径别名
   - 清理缓存：`rm -rf node_modules/.vite`

3. **类型错误**：
   - 检查 TypeScript 配置
   - 确保 `vite-env.d.ts` 文件存在
   - 运行 `pnpm run lint` 检查代码质量

### 调试模式

在开发时可以启用调试模式：

```typescript
const framework = new ONNXWebFramework({
  executionProviders: ['wasm', 'webgl'],
  enableProfiling: true,  // 启用性能分析
  debug: true,           // 启用调试日志
  useWorker: true
});
```

## 🔄 开发工作流

1. **修改 onnx-web-framework**：
   ```bash
   cd ../onnx-web-framework-package
   npm run build:watch
   ```

2. **开发 RMBG 应用**：
   ```bash
   cd ../rmbg
   pnpm run dev
   ```

3. **测试完整流程**：
   - 在浏览器中测试功能
   - 运行 `pnpm run build` 测试构建
   - 使用 `pnpm run preview` 预览生产版本

## 📱 浏览器兼容性

| 浏览器 | 版本要求 | 备注 |
|--------|----------|------|
| Chrome | 89+ | 完全支持 |
| Firefox | 88+ | 完全支持 |
| Safari | 14+ | 完全支持 |
| Edge | 89+ | 完全支持 |

## 📄 许可证

本项目基于 MIT 许可证开源。

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📞 技术支持

如果遇到问题，请：

1. 查看浏览器控制台的错误信息
2. 检查网络连接状态
3. 确认模型文件完整性
4. 提交 Issue 并附上详细的错误信息和环境信息

---

**注意**：本项目依赖于 `onnx-web-framework` npm 包的本地开发版本。确保该包已正确构建和链接。