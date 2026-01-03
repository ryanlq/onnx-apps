/**
 * Transformers.js 全局配置
 *
 * 必须在任何导入 @huggingface/transformers 之前加载
 */

// 在浏览器环境中，确保 SharedArrayBuffer 可用
if (typeof crossOriginIsolated === 'undefined' || !crossOriginIsolated) {
  console.warn('[Transformers Config] SharedArrayBuffer is not available. Performance may be degraded.');
}

export const isTransformersReady = true;
