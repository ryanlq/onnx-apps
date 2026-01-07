/**
 * BGE-Small-ZH-v1.5 Embedding 适配器
 *
 * 使用 onnx-web-framework 进行中文文本嵌入
 * 基于 ONNX Runtime Web
 * 仅使用 transformers.js 的 tokenizer，模型推理使用 onnx-web-framework
 */

import ONNXWorkerManager from "../utils/onnxWorkerManager";
import { AutoTokenizer, env } from "@huggingface/transformers";

// 配置 transformers.js 使用本地模型
env.allowLocalModels = true;
env.useBrowserCache = true;

let manager: ONNXWorkerManager | null = null;
let modelLoaded = false;
let tokenizer: any = null;
let localTokenizerConfig: any = null;

/**
 * 初始化 BGE 模型
 */
export async function initializeBGEModel(): Promise<void> {
  if (modelLoaded) return;

  try {
    console.log("[BGE Adapter] 正在初始化模型...");

    // 预加载本地 tokenizer.json 配置
    console.log("[BGE Adapter] 正在加载本地 tokenizer 配置...");
    try {
      const response = await fetch("/bge-small-zh-v1.5/tokenizer.json");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      localTokenizerConfig = await response.json();
      console.log("[BGE Adapter] ✅ 本地 tokenizer 配置加载成功");

      // 既然本地配置已加载成功，就不需要尝试从网络加载 tokenizer 了
      // 标记为使用本地 tokenizer
      if (typeof window !== 'undefined') {
        (window as any).__bgeTokenizerFallback = false; // 不是降级，是主动使用本地
      }
      console.log("[BGE Adapter] 📦 使用本地 tokenizer.json（无需网络加载）");
    } catch (error) {
      console.warn(
        "[BGE Adapter] ⚠️ 本地 tokenizer.json 加载失败，尝试从网络加载...",
        error,
      );

      // 如果本地加载失败，尝试从网络加载
      console.log("[BGE Adapter] 正在从网络加载 tokenizer...");
      try {
        tokenizer = await AutoTokenizer.from_pretrained(
          "Xenova/bge-small-zh-v1.5",
        );
        console.log("[BGE Adapter] ✅ Tokenizer 加载完成");
      } catch (networkError) {
        console.warn(
          "[BGE Adapter] ⚠️ 网络 tokenizer 加载失败，将使用简化版本（准确性可能降低）:",
          networkError,
        );
        if (typeof window !== 'undefined') {
          (window as any).__bgeTokenizerFallback = true;
        }
      }
    }

    manager = ONNXWorkerManager.getInstance();

    // 使用用户指定的模型
    // const modelUrl =
    //   "https://huggingface.co/ryanli123/onnx/resolve/main/bge-small-zh-v1.5/model_int8.ort";
    const modelUrl =
      "https://www.modelscope.cn/models/Xenova/bge-small-zh-v1.5/resolve/master/onnx/model_int8.onnx";
    console.log("[BGE Adapter] 正在加载 ONNX 模型...");
    await manager.loadModel("bge", modelUrl);

    modelLoaded = true;
    console.log("[BGE Adapter] ✅ 模型加载完成");
  } catch (error) {
    console.error("[BGE Adapter] ❌ 模型加载失败:", error);
    throw error;
  }
}

/**
 * 使用 transformers.js 的 tokenizer，或简化版本
 */
async function tokenize(text: string): Promise<number[]> {
  if (!tokenizer) {
    await initializeBGEModel();
  }

  // 如果 tokenizer 可用，使用它
  if (tokenizer && typeof tokenizer.encode === "function") {
    try {
      const tokens = await tokenizer.encode(text);
      return tokens.token_ids || tokens.ids || tokens;
    } catch (error) {
      console.warn("[BGE Adapter] Tokenizer 失败，使用简化版本:", error);
    }
  }

  // 简化版本：使用本地 tokenizer.json
  return await tokenizeWithLocalConfig(text);
}

/**
 * 使用本地 tokenizer.json 进行分词（简化版）
 */
async function tokenizeWithLocalConfig(text: string): Promise<number[]> {
  try {
    // 使用预加载的 tokenizer 配置
    if (!localTokenizerConfig) {
      throw new Error("Local tokenizer config not loaded");
    }

    const vocab = localTokenizerConfig.model?.vocab || {};
    const unkTokenId = vocab["[UNK]"] || 100;
    const clsTokenId = vocab["[CLS]"] || 101;
    const sepTokenId = vocab["[SEP]"] || 102;

    const tokens = [clsTokenId];

    // 简单的字符级分词
    for (const char of text) {
      const tokenId = vocab[char];
      tokens.push(tokenId !== undefined ? tokenId : unkTokenId);
    }

    tokens.push(sepTokenId);

    return tokens.slice(0, 512); // 限制最大长度
  } catch (error) {
    console.warn("[BGE Adapter] ⚠️ 本地 tokenizer 加载失败，使用降级方案（准确性降低）:", error);

    // 最后的回退方案：纯字符编码
    const tokens = [101]; // [CLS]
    for (let i = 0; i < Math.min(text.length, 510); i++) {
      const code = text.charCodeAt(i);
      // 确保在词汇表范围内 (0-21127)
      tokens.push(Math.min(code % 20000, 21127));
    }
    tokens.push(102); // [SEP]
    return tokens;
  }
}

/**
 * 将 tokens 转换为 input tensor
 */
interface TensorData {
  data: BigInt64Array;
  dims: number[];
  type: 'int64';
}

interface PreparedInput {
  input_ids: TensorData;
  attention_mask: TensorData;
  token_type_ids: TensorData;
}

function prepareInput(tokens: number[]): PreparedInput {
  const maxLength = 512;
  const truncatedTokens = tokens.slice(0, maxLength);

  return {
    input_ids: {
      data: new BigInt64Array(truncatedTokens.map((n) => BigInt(n))),
      dims: [1, truncatedTokens.length],
      type: "int64" as const,
    },
    attention_mask: {
      data: new BigInt64Array(truncatedTokens.map(() => BigInt(1))),
      dims: [1, truncatedTokens.length],
      type: "int64" as const,
    },
    token_type_ids: {
      data: new BigInt64Array(truncatedTokens.map(() => BigInt(0))),
      dims: [1, truncatedTokens.length],
      type: "int64" as const,
    },
  };
}

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 生成单个文本的 embedding
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  if (!modelLoaded || !manager) {
    await initializeBGEModel();
  }

  try {
    // Tokenize
    const tokens = await tokenize(text);

    // Prepare input
    const inputs = prepareInput(tokens);

    // Run inference
    const result = await manager!.run("bge", inputs);

    // Get embedding output
    // BGE 模型输出格式：last_hidden_state or pooler_output
    const outputKey =
      Object.keys(result).find(
        (key) => key.includes("output") || key.includes("hidden"),
      ) || Object.keys(result)[0];

    const output = result[outputKey];
    const data = output.data as Float32Array;
    const dims = output.dims;

    // BGE 输出格式: [batch_size, sequence_length, hidden_size]
    // 例如: [1, 128, 768]
    const sequenceLength = dims[1];
    const hiddenSize = dims[2];

    // 使用 Mean Pooling: 对所有 token 的 embedding 取平均
    // 注意：排除 [CLS] (索引0) 和 [SEP] (最后一个) token
    const meanEmbedding = new Float32Array(hiddenSize);

    // 只对内容token做平均（排除 [CLS] 和 [SEP]）
    const contentStart = 1; // 跳过 [CLS]
    const contentEnd = sequenceLength - 1; // 排除 [SEP]

    if (contentEnd > contentStart) {
      for (let i = contentStart; i < contentEnd; i++) {
        for (let j = 0; j < hiddenSize; j++) {
          const idx = i * hiddenSize + j;
          meanEmbedding[j] += data[idx];
        }
      }

      // 取平均
      const numTokens = contentEnd - contentStart;
      for (let j = 0; j < hiddenSize; j++) {
        meanEmbedding[j] /= numTokens;
      }
    } else {
      // 如果序列太短，直接使用 [CLS] token
      for (let j = 0; j < hiddenSize; j++) {
        meanEmbedding[j] = data[j];
      }
    }

    // L2 normalize
    const norm = Math.sqrt(
      meanEmbedding.reduce((sum, val) => sum + val * val, 0),
    );
    for (let i = 0; i < meanEmbedding.length; i++) {
      meanEmbedding[i] /= norm;
    }

    return meanEmbedding;
  } catch (error) {
    console.error("[BGE Adapter] Embedding 生成失败:", error);
    throw error;
  }
}

/**
 * 批量生成 embeddings（优化版）
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<Float32Array[]> {
  const embeddings: Float32Array[] = [];

  for (let i = 0; i < texts.length; i++) {
    const embedding = await generateEmbedding(texts[i]);
    embeddings.push(embedding);

    if (onProgress) {
      onProgress(i + 1, texts.length);
    }
  }

  return embeddings;
}
