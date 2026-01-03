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
  assetsInclude: ['**/*.onnx', '**/*.wasm', '**/*.jsep.mjs'],
  optimizeDeps: {
    exclude: [
      // 排除项目中的 onnxruntime-web
      'onnxruntime-web',
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
      // 不要 external onnxruntime-web，让它被打包进 bundle
      output: {
        // 将 transformers 相关代码分离到单独的 chunk
        manualChunks: {
          'transformers': ['@huggingface/transformers'],
          // 其他 vendor 代码
          'vendor': ['react', 'react-dom', 'react-toastify'],
          // ONNX runtime 单独 chunk
          'onnxruntime': ['onnxruntime-web']
        }
      }
    }
  }
})
