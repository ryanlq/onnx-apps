/**
 * Real-ESRGAN 图像超分辨率适配器（支持切片处理）
 *
 * 使用 ONNXWorkerManager 进行浏览器端超分辨率处理
 * 支持 Tiling 模式处理大图片
 */

import ONNXWorkerManager from "../utils/onnxWorkerManager";
import PQueue from "p-queue";
import {
  tileImage,
  stitchTiles,
  trimTileOverlap,
  calculateTileParams,
} from "../utils/imageTiling";

/**
 * 预处理图片
 * - 转换为 NCHW 格式
 * - 归一化到 [0, 1]
 */
function preprocessImageData(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const input = new Float32Array(3 * width * height);

  for (let i = 0; i < data.length; i += 4) {
    const pixelIdx = i / 4;
    const r = data[i] / 255.0;
    const g = data[i + 1] / 255.0;
    const b = data[i + 2] / 255.0;

    // NCHW 格式
    input[pixelIdx] = r;
    input[pixelIdx + width * height] = g;
    input[pixelIdx + 2 * width * height] = b;
  }

  return input;
}

/**
 * 后处理结果
 * - NCHW -> RGBA
 * - 反归一化到 [0, 255]
 */
function postprocessOutput(
  outputData: Float32Array,
  outputWidth: number,
  outputHeight: number,
): ImageData {
  const size = outputWidth * outputHeight;
  const imageData = new ImageData(outputWidth, outputHeight);

  for (let i = 0; i < size; i++) {
    const r = Math.min(255, Math.max(0, outputData[i] * 255));
    const g = Math.min(255, Math.max(0, outputData[i + size] * 255));
    const b = Math.min(255, Math.max(0, outputData[i + 2 * size] * 255));

    imageData.data[i * 4] = r;
    imageData.data[i * 4 + 1] = g;
    imageData.data[i * 4 + 2] = b;
    imageData.data[i * 4 + 3] = 255;
  }

  return imageData;
}

/**
 * 处理单个 Tile
 */
async function processTile(
  tile: {
    data: ImageData;
    x: number;
    y: number;
    width: number;
    height: number;
  },
  manager: ONNXWorkerManager,
  overlap: number,
): Promise<{
  data: ImageData;
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  // 预处理
  const input = preprocessImageData(tile.data);

  // 构建输入张量
  const inputTensor = {
    input: {
      data: input,
      dims: [1, 3, tile.height, tile.width],
      type: "float32" as const,
    },
  };

  // 推理
  const result = await manager.run("realesrgan", inputTensor);

  // 获取输出
  const outputTensor = result.output || result[Object.keys(result)[0]];
  const outputData = outputTensor.data as Float32Array;
  const dims = outputTensor.dims;

  // 后处理
  const outputHeight = dims[2];
  const outputWidth = dims[3];
  const imageData = postprocessOutput(outputData, outputWidth, outputHeight);

  // 裁剪 overlap 区域（只保留中心干净区域）
  const cleanData = trimTileOverlap(imageData, overlap);

  // 计算输出坐标（4x 放大，不需要再加 overlap）
  // 因为裁剪后的 cleanData 已经是去掉 overlap 的干净区域
  // 直接按照 tile 的原始位置放大 4 倍即可
  const outputX = tile.x * 4;
  const outputY = tile.y * 4;
  const cleanWidth = cleanData.width;
  const cleanHeight = cleanData.height;

  return {
    data: cleanData,
    x: outputX,
    y: outputY,
    width: cleanWidth,
    height: cleanHeight,
  };
}

/**
 * 增强配置
 */
export interface EnhanceOptions {
  modelUrl?: string;
  tileSize?: number;
  overlap?: number;
  concurrency?: number;
  onProgress?: (progress: number, message: string) => void;
  signal?: AbortSignal;
}

/**
 * 主函数：执行超分辨率处理（支持切片）
 */
export default async function enhance(
  imageFile: File | HTMLImageElement,
  options: EnhanceOptions = {},
): Promise<string> {
  console.time("realesrgan_total");

  try {
    console.log("[Real-ESRGAN Adapter] 开始处理...");

    // 默认配置
    const config: Required<
      Omit<EnhanceOptions, "modelUrl" | "onProgress" | "signal">
    > = {
      tileSize: options.tileSize || 256,
      overlap: options.overlap || 16,
      concurrency: options.concurrency || 1, // 串行处理，避免 OOM
    };

    // 1. 加载图像
    const img =
      imageFile instanceof HTMLImageElement
        ? imageFile
        : await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Failed to load image"));
            img.src = URL.createObjectURL(imageFile);
          });

    console.log("[Real-ESRGAN Adapter] 原始尺寸:", img.width, "x", img.height);

    // 2. 创建 canvas
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    // 3. 初始化 ONNX Worker
    console.time("initialization");
    const manager = ONNXWorkerManager.getInstance();
    const defaultModelUrl =
      "https://huggingface.co/ryanli123/onnx/resolve/main/RealESR_Gx4_fp16.ort";
    const finalModelUrl = options.modelUrl || defaultModelUrl;

    await manager.loadModel("realesrgan", finalModelUrl);
    console.timeEnd("initialization");

    // 4. 计算切片参数
    const { totalTiles } = calculateTileParams(img.width, img.height, config);
    console.log(`[Real-ESRGAN Adapter] 图片将被分割为 ${totalTiles} 个块`);

    // 5. 切片
    console.time("tiling");
    options.onProgress?.(0, "正在切片图片...");
    const tiles = tileImage(canvas, config);
    console.timeEnd("tiling");
    console.log(`[Real-ESRGAN Adapter] 切片完成，共 ${tiles.length} 块`);

    // 6. 创建并发队列
    const queue = new PQueue({
      concurrency: config.concurrency,
      autoStart: true,
    });

    // 7. 处理所有 tiles
    console.time("inference");
    const processedTiles: Array<{
      data: ImageData;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];

    let completedTiles = 0;

    // 检查中止信号
    const checkAborted = () => {
      if (options.signal?.aborted) {
        queue.pause();
        queue.clear();
        throw new Error("Processing cancelled by user");
      }
    };

    // 创建所有任务
    const tileTasks = tiles.map((tile, index) => {
      return queue.add(async () => {
        checkAborted();

        const startTime = Date.now();
        console.log(
          `[Real-ESRGAN Adapter] 处理 Tile ${index + 1}/${tiles.length}`,
        );

        // 处理当前 tile
        const result = await processTile(tile, manager, config.overlap);

        const elapsed = Date.now() - startTime;
        console.log(
          `[Real-ESRGAN Adapter] Tile ${index + 1}/${tiles.length} 完成 (${elapsed}ms)`,
        );

        // 保存结果
        processedTiles[index] = result;

        // 更新进度
        completedTiles++;
        const progress = completedTiles / tiles.length;
        options.onProgress?.(
          progress,
          `处理中: ${completedTiles}/${tiles.length} (${Math.round(progress * 100)}%)`,
        );

        return result;
      });
    });

    // 等待所有任务完成
    await Promise.all(tileTasks);
    console.timeEnd("inference");

    // 8. 拼接结果
    console.time("stitching");
    options.onProgress?.(0.95, "正在拼接结果...");
    const outputWidth = img.width * 4;
    const outputHeight = img.height * 4;
    const resultCanvas = stitchTiles(processedTiles, outputWidth, outputHeight);
    console.timeEnd("stitching");

    // 9. 转换为 DataURL
    console.time("encoding");
    options.onProgress?.(0.98, "正在生成图片...");
    const resultDataUrl = resultCanvas.toDataURL("image/png");
    console.timeEnd("encoding");

    console.timeEnd("realesrgan_total");
    console.log("[Real-ESRGAN Adapter] ✅ 处理完成");
    console.log(
      "[Real-ESRGAN Adapter] 输出尺寸:",
      outputWidth,
      "x",
      outputHeight,
    );

    options.onProgress?.(1, "处理完成");

    return resultDataUrl;
  } catch (error) {
    console.error("[Real-ESRGAN Adapter] ❌ 处理失败:", error);
    throw error;
  }
}
