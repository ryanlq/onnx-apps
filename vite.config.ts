import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'ONNX Web 应用集合',
        short_name: 'ONNX Apps',
        description: '基于 ONNX Runtime Web 的 AI 应用工具箱',
        theme_color: '#101010',
        background_color: '#101010',
        display: 'standalone',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        // 增加最大缓存文件大小限制
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024, // 30 MB

        // 配置 WASM 文件的缓存策略
        runtimeCaching: [
          {
            // 缓存 ONNX Runtime WASM 文件（从 CDN）
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@.*\/.*\.wasm$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'onnx-wasm-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 天
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // 缓存 ONNX Runtime JS wrapper 文件
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@.*\/.*\.(js|mjs)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'onnx-js-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30
              }
            }
          },
          {
            // 缓存 Hugging Face 模型文件
            urlPattern: /^https:\/\/huggingface\.co\/.*\/.*\.ort$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'onnx-models-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // 缓存图片和其他静态资源
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true, // 开发环境也启用 Service Worker
        type: 'module'
      }
    })
  ],
  resolve: {
    alias: {
      // 确保 onnxruntime-web 能被正确解析
      'onnxruntime-web': path.resolve(__dirname, 'node_modules/onnxruntime-web')
    }
  },
  // 包含 ONNX 模型文件和 WASM 文件
  assetsInclude: ['**/*.onnx', '**/*.wasm', '**/*.jsep.mjs'],
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

          // ONNX Runtime：单独打包
          if (id.includes('onnxruntime-web')) {
            return 'onnxruntime';
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
