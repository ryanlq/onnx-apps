/**
 * Whisper Speech Recognition Adapter
 *
 * 使用 @huggingface/transformers 进行浏览器端语音识别
 */

// 延迟导入，确保配置已加载
let transformersModule: any = null;
let envInitialized = false;

async function getTransformers() {
  if (!transformersModule) {
    transformersModule = await import('@huggingface/transformers');
  }
  return transformersModule;
}

// 初始化环境配置
async function initEnv() {
  if (envInitialized) return;

  const { env } = await getTransformers();

  // 配置基本设置
  env.allowLocalModels = false;
  env.allowRemoteModels = true;

  // 配置 WASM 后端
  if (env.backends) {
    if (env.backends.onnx && env.backends.onnx.wasm) {
      // 禁用代理（使用内置 WASM 后端）
      env.backends.onnx.wasm.proxy = false;
      // 单线程模式
      env.backends.onnx.wasm.numThreads = 1;
    }

    // 确保使用 WASM 后端
    if (env.backends && env.backends.backends) {
      env.backends.backends.push('wasm');
    }
  }

  envInitialized = true;
  console.log('[Whisper Adapter] Environment initialized');
}

export interface WhisperChunk {
  text: string;
  timestamp: [number, number | null];
}

export interface WhisperResult {
  text: string;
  chunks: WhisperChunk[];
}

export type WhisperModel = 'Xenova/whisper-tiny' | 'Xenova/whisper-base' | 'Xenova/whisper-small';
export type WhisperTask = 'transcribe' | 'translate';

export interface WhisperOptions {
  model?: WhisperModel;
  language?: string; // 'chinese', 'english', 'auto', etc.
  task?: WhisperTask;
  quantized?: boolean;
  onProgress?: (progress: number, file: string) => void;
  onUpdate?: (text: string, chunks: WhisperChunk[]) => void;
}

// 全局 pipeline 实例，避免重复加载
let transcriberInstance: any = null;
let currentModel = '';
let currentQuantized = false;

/**
 * 语音转录函数
 *
 * @param audioFile - 音频文件 (File 或 Blob)
 * @param options - 配置选项
 * @returns 转录结果
 */
export async function transcribe(
  audioFile: File | Blob | Float32Array,
  options: WhisperOptions = {}
): Promise<WhisperResult> {
  const {
    model = 'Xenova/whisper-tiny',
    language = 'chinese',
    task = 'transcribe',
    quantized = true,
    onProgress,
    onUpdate
  } = options;

  try {
    // 初始化环境
    await initEnv();

    const { pipeline } = await getTransformers();

    // 检查是否需要重新加载模型
    if (transcriberInstance && (currentModel !== model || currentQuantized !== quantized)) {
      // 释放旧模型
      await transcriberInstance.dispose();
      transcriberInstance = null;
    }

    // 创建新的 pipeline 实例
    if (!transcriberInstance) {
      transcriberInstance = await pipeline(
        'automatic-speech-recognition',
        model,
        {
          quantized,
          progress_callback: (data: any) => {
            if (data.status === 'downloading' && onProgress) {
              onProgress(data.progress, data.file);
            } else if (data.status === 'loading' && onProgress) {
              onProgress(data.progress, data.file);
            }
          },
          // 对于 medium 模型，使用 no_attentions 版本避免内存溢出
          revision: model.includes('whisper-medium') ? 'no_attentions' : 'main'
        }
      );

      currentModel = model;
      currentQuantized = quantized;
    }

    // 准备音频输入
    // @huggingface/transformers v3+ 需要解码音频文件
    let audioInput: any;

    if (audioFile instanceof Blob) {
      // 对于 Blob/File，使用 Web Audio API 解码
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000
      });
      const arrayBuffer = await audioFile.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // 获取音频数据并转换为 Float32Array
      const audioData = audioBuffer.getChannelData(0); // 单声道

      audioInput = audioData;
    } else if (audioFile instanceof Float32Array) {
      audioInput = audioFile;
    } else {
      throw new Error('Unsupported audio input type');
    }

    // 运行推理
    const output: any = await transcriberInstance(audioInput, {
      language: language === 'auto' ? null : language,
      task,
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      callback_function: (item: any) => {
        // 实时更新回调
        if (onUpdate && item && item[0]) {
          onUpdate(item[0], item[1]?.chunks || []);
        }
      }
    });

    // 返回结果
    return {
      text: output?.text || '',
      chunks: output?.chunks || []
    };

  } catch (error) {
    console.error('[Whisper Adapter] Transcription error:', error);
    throw new Error(`转录失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 释放模型资源
 */
export async function disposeModel(): Promise<void> {
  if (transcriberInstance) {
    await transcriberInstance.dispose();
    transcriberInstance = null;
    currentModel = '';
    currentQuantized = false;
  }
}

/**
 * 获取支持的语言列表
 */
export const SUPPORTED_LANGUAGES = {
  auto: '自动检测',
  zh: '中文',
  en: '英语',
  yue: '粤语',
  ja: '日语',
  ko: '韩语',
  es: '西班牙语',
  fr: '法语',
  de: '德语',
  ru: '俄语',
  ar: '阿拉伯语',
  hi: '印地语',
  it: '意大利语',
  pt: '葡萄牙语',
  th: '泰语',
  vi: '越南语'
};

/**
 * 获取可用的模型列表
 */
export const AVAILABLE_MODELS = {
  'Xenova/whisper-tiny': {
    name: 'Tiny',
    size: '~39MB',
    speed: '⚡⚡⚡',
    accuracy: '⭐⭐',
    description: '最快，适合实时转录'
  },
  'Xenova/whisper-base': {
    name: 'Base',
    size: '~74MB',
    speed: '⚡⚡',
    accuracy: '⭐⭐⭐',
    description: '平衡速度和准确度'
  },
  'Xenova/whisper-small': {
    name: 'Small',
    size: '~244MB',
    speed: '⚡',
    accuracy: '⭐⭐⭐⭐',
    description: '更准确，适合长音频'
  }
};
