/**
 * ONNX Runtime Web 配置
 * 优化：使用 CDN 加载 WASM 文件以减少构建体积
 */

/**
 * 初始化 ONNX Runtime Web 配置
 * 必须在使用任何 ONNX 功能之前调用
 */
export function initONNXConfig() {
  // 检查是否在浏览器环境
  if (typeof window === 'undefined') {
    return;
  }

  // 使用 CDN 加载 WASM 文件
  // 优势：
  // 1. 减少 21 MB 的构建体积
  // 2. 利用 CDN 缓存
  // 3. 全球加速
  // 4. 自动更新
  try {
    // @ts-ignore - ort 对象由 onnxruntime-web 注入
    if (window.ort?.env?.wasm) {
      // @ts-ignore
      window.ort.env.wasm.wasmPaths =
        'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

      console.log('✅ ONNX Runtime: Using CDN for WASM files');
    }
  } catch (error) {
    console.warn('⚠️  Failed to set ONNX CDN path:', error);
  }
}

/**
 * 获取当前 ONNX 配置信息
 */
export function getONNXConfigInfo() {
  // @ts-ignore
  const wasmPaths = window.ort?.env?.wasm?.wasmPaths;

  return {
    usingCDN: wasmPaths?.includes('cdn.jsdelivr.net') || false,
    wasmPaths: wasmPaths || 'local',
  };
}
