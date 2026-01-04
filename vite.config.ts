import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react()
  ],
  resolve: {
    alias: {
      // 确保 onnxruntime-web 能被正确解析
      'onnxruntime-web': path.resolve(__dirname, 'node_modules/onnxruntime-web')
    }
  },
  // 仅包含 ONNX 模型文件，排除 WASM 文件（WASM 将从 CDN 动态加载）
  assetsInclude: ['**/*.onnx'],
  optimizeDeps: {
    exclude: [
      // 排除：使用 CDN 加载
      'onnxruntime-web',
      // 排除：自定义框架
      'onnx-web-framework',
      'onnx-web-framework/worker'
    ],
    include: [
      // 预构建 @huggingface/transformers
      '@huggingface/transformers'
    ]
  },
  // ✅ Worker 配置 - 支持从 npm 包导入 Worker
  worker: {
    format: 'es',
    plugins: () => [react()],
    rollupOptions: {
      output: {
        // Worker 也要包含 onnxruntime-web
        manualChunks: (id) => {
          // 为 worker 打包 onnxruntime-web
          if (id.includes('onnxruntime-web')) {
            return 'onnxruntime-worker';
          }
        }
      }
    }
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    fs: {
      strict: false
    }
  },
  // 添加构建优化配置
  build: {
    rollupOptions: {
      output: {
        // 优化的代码分割策略
        manualChunks: (id) => {
          // Vendor 库：React 生态
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-toastify')) {
            return 'vendor';
          }

          // Transformers：单独打包
          if (id.includes('@huggingface/transformers')) {
            return 'transformers';
          }

          // ONNX Runtime：单独打包（虽然我们使用 CDN，但 JS wrapper 仍需要）
          if (id.includes('onnxruntime-web')) {
            return 'onnxruntime';
          }

          // OpenCV：单独打包
          if (id.includes('opencv-ts')) {
            return 'opencv';
          }
        },
        // 更好的 chunk 命名
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 设置 chunk 大小警告阈值
    chunkSizeWarningLimit: 1000
  }
})
