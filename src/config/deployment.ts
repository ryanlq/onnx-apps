/**
 * 部署环境配置
 *
 * 用于管理不同环境下的模型资源路径
 */

export interface DeploymentConfig {
  // 模型来源类型
  modelSource: "local" | "r2" | "cdn";
  // R2 或 CDN 的基础 URL
  modelBaseUrl?: string;
  // 可用的模型列表
  availableModels: string[];
}

/**
 * 获取当前环境的配置
 *
 * 使用方式：
 * 1. 本地开发：从 .env 读取
 * 2. Cloudflare Pages：从环境变量读取
 * 3. 默认：使用本地路径
 */
export function getDeploymentConfig(): DeploymentConfig {
  // 从环境变量读取配置
  const modelBaseUrl = import.meta.env.VITE_MODEL_BASE_URL || "";

  // 判断是否使用远程存储
  const useRemoteStorage = Boolean(modelBaseUrl);

  return {
    modelSource: useRemoteStorage ? "r2" : "local",
    modelBaseUrl: useRemoteStorage ? modelBaseUrl : undefined,
    // 根据实际情况列出你的模型
    availableModels: [
      "rmbg_quantized.ort",
      "migan_pipeline_v2.ort",
      "whisper-base-ONNX",
      "RealESR_Gx4_fp16.ort", // Real-ESRGAN 图像增强
      // 添加其他小模型...
    ],
  };
}

/**
 * 获取模型的完整 URL
 */
export function getModelUrl(modelName: string): string {
  const config = getDeploymentConfig();

  if (config.modelSource === "r2" && config.modelBaseUrl) {
    // 使用 R2 或 CDN
    return `${config.modelBaseUrl}/${modelName}`;
  }

  // 本地开发或直接托管
  return `/onnx-models/${modelName}`;
}

/**
 * 检查模型是否可用
 *
 * 对于大模型，建议只在用户需要时才显示选项
 */
export function isModelAvailable(modelName: string): boolean {
  const config = getDeploymentConfig();

  // 如果是本地模式，检查文件大小
  if (config.modelSource === "local") {
    // 建议只加载小于 25MB 的模型
    const smallModels = [
      "rmbg_quantized.ort",
      "migan_pipeline_v2.ort",
      "whisper-base-ONNX",
      "RealESR_Gx4_fp16.ort", // 5.05 MB
    ];
    return smallModels.includes(modelName);
  }

  // 远程存储模式，所有列出的模型都可用
  return config.availableModels.includes(modelName);
}

/**
 * 获取模型的显示名称
 */
export function getModelDisplayName(modelName: string): string {
  const displayNames: Record<string, string> = {
    "rmbg_quantized.ort": "背景移除 (RMBG)",
    "migan_pipeline_v2.ort": "图像修复 (MI-GAN)",
    "whisper-base-ONNX": "语音识别 (Whisper)",
    "RealESR_Gx4_fp16.ort": "图像增强 (Real-ESRGAN)",
  };

  return displayNames[modelName] || modelName;
}
