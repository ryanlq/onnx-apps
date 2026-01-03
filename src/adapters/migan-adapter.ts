/**
 * MI-GAN Inpainting Adapter
 *
 * 使用 ONNXWorkerManager + OpenCV.js
 * 参考 inpaint-web 项目：https://github.com/lxfater/inpaint-web
 */

import cv, { type Mat } from 'opencv-ts';
import ONNXWorkerManager from '../utils/onnxWorkerManager';
import { getModelUrl } from '../config/deployment';

/**
 * 加载图片
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image from ${url}`));
    img.src = url;
  });
}

/**
 * 图像预处理：使用 OpenCV.js 转换为 NCHW 格式
 */
function imgProcess(img: Mat): Uint8Array {
  const channels = new cv.MatVector();
  cv.split(img, channels); // 分割通道
  const C = channels.size(); // 通道数
  const H = img.rows; // 图像高度
  const W = img.cols; // 图像宽度
  const chwArray = new Uint8Array(C * H * W); // 创建新的数组来存储转换后的数据

  for (let c = 0; c < C; c++) {
    const channelData = channels.get(c).data; // 获取单个通道的数据
    for (let h = 0; h < H; h++) {
      for (let w = 0; w < W; w++) {
        chwArray[c * H * W + h * W + w] = channelData[h * W + w];
      }
    }
  }
  channels.delete(); // 清理内存
  return chwArray; // 返回转换后的数据
}

/**
 * 蒙版预处理：转换为灰度并二值化
 */
function markProcess(img: Mat): Uint8Array {
  const channels = new cv.MatVector();
  cv.split(img, channels); // 分割通道
  const H = img.rows; // 图像高度
  const W = img.cols; // 图像宽度
  const chwArray = new Uint8Array(H * W); // 创建新的数组来存储转换后的数据

  const channelData = channels.get(0).data; // 获取第一个通道的数据

  // 统计蒙版数据
  let paintedPixels = 0;
  let unpaintedPixels = 0;

  for (let h = 0; h < H; h++) {
    for (let w = 0; w < W; w++) {
      const pixelValue = channelData[h * W + w];
      // MI-GAN 蒙版格式：0=inpaint区域，255=保留区域
      // 我们的蒙版绘制的是红色（255），需要反转
      if (pixelValue > 0) {
        // 有绘制（红色 > 0），设为 0 表示需要修复
        chwArray[h * W + w] = 0;
        paintedPixels++;
      } else {
        // 无绘制（透明），设为 255 表示保留
        chwArray[h * W + w] = 255;
        unpaintedPixels++;
      }
    }
  }

  console.log(`[MIGAN Adapter] 蒙版统计 - 绘制像素: ${paintedPixels}, 未绘制像素: ${unpaintedPixels}`);
  console.log(`[MIGAN Adapter] 蒙版数据前20个值:`, Array.from(chwArray.slice(0, 20)));

  channels.delete(); // 清理内存
  return chwArray; // 返回转换后的数据
}

/**
 * 处理图像：将 HTMLImageElement 转换为 OpenCV Mat 并预处理
 */
function processImage(img: HTMLImageElement): Uint8Array {
  const src = cv.imread(img);
  const src_rgb = new cv.Mat();
  // 将图像从RGBA转换为RGB
  cv.cvtColor(src, src_rgb, cv.COLOR_RGBA2RGB);

  const result = imgProcess(src_rgb);

  src.delete();
  src_rgb.delete();

  return result;
}

/**
 * 处理蒙版：将 HTMLImageElement 转换为灰度蒙版
 */
function processMark(img: HTMLImageElement): Uint8Array {
  const src = cv.imread(img);
  const src_grey = new cv.Mat();
  // 将图像从RGBA转换为灰度
  cv.cvtColor(src, src_grey, cv.COLOR_BGR2GRAY);

  const result = markProcess(src_grey);

  src.delete();
  src_grey.delete();

  return result;
}

/**
 * 后处理：将 NCHW 格式的输出转换为 RGBA
 */
function postProcess(uint8Data: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const chwToHwcData = new Uint8ClampedArray(width * height * 4);
  const size = width * height;

  for (let h = 0; h < height; h++) {
    for (let w = 0; w < width; w++) {
      for (let c = 0; c < 3; c++) {
        // RGB通道
        const chwIndex = c * size + h * width + w;
        const pixelVal = uint8Data[chwIndex];
        const pixelIndex = (h * width + w) * 4 + c;
        chwToHwcData[pixelIndex] = pixelVal;
      }
      // Alpha通道
      chwToHwcData[(h * width + w) * 4 + 3] = 255;
    }
  }

  return chwToHwcData;
}

/**
 * 调整蒙版大小
 */
function resizeMark(
  image: HTMLImageElement,
  width: number,
  height: number
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    // 将图片绘制到canvas上，并调整大小
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Unable to get canvas context'));
      return;
    }
    ctx.drawImage(image, 0, 0, width, height);

    // 获取调整大小后的图片URL
    const resizedImageUrl = canvas.toDataURL();

    // 创建一个新的Image对象并设置其src为调整大小后的图片URL
    const resizedImage = new Image();
    resizedImage.onload = () => resolve(resizedImage);
    resizedImage.onerror = () => reject(new Error('Failed to load resized image'));
    resizedImage.src = resizedImageUrl;
  });
}

/**
 * 主函数：执行图像修复
 */
export default async function inpaint(
  imageFile: File | HTMLImageElement,
  maskBase64: string
): Promise<string> {
  console.time('inpaint_total');

  try {
    console.log('[MIGAN Adapter] 开始处理...');

    // 1. 加载图像和蒙版
    const [originalImg, originalMark] = await Promise.all([
      imageFile instanceof HTMLImageElement
        ? imageFile
        : loadImage(URL.createObjectURL(imageFile)),
      loadImage(maskBase64)
    ]);

    console.log('[MIGAN Adapter] 图像尺寸:', originalImg.width, 'x', originalImg.height);

    // 2. 使用 OpenCV.js 预处理
    console.time('preprocess');
    const [img, mark] = await Promise.all([
      processImage(originalImg),
      processMark(await resizeMark(originalMark, originalImg.width, originalImg.height))
    ]);
    console.timeEnd('preprocess');

    // 3. 准备张量数据
    const imageTensor = {
      data: img,
      dims: [1, 3, originalImg.height, originalImg.width], // NCHW 格式
      type: 'uint8' as const
    };

    const maskTensor = {
      data: mark,
      dims: [1, 1, originalImg.height, originalImg.width], // NCHW 格式
      type: 'uint8' as const
    };

    // 4. 使用 ONNXWorkerManager 运行推理
    console.time('inference');
    const manager = ONNXWorkerManager.getInstance();

    // 确保模型已加载
    const modelUrl = getModelUrl('migan_pipeline_v2.ort');
    console.log('[MIGAN Adapter] 模型 URL:', modelUrl);
    await manager.loadModel('migan', modelUrl);

    const result = await manager.run('migan', {
      image: imageTensor,
      mask: maskTensor
    });
    console.timeEnd('inference');

    // 5. 后处理结果
    console.time('postprocess');
    const outputTensor = result.result || result.output || result[Object.keys(result)[0]];
    const outputData = outputTensor.data as Uint8Array;
    const dims = outputTensor.dims;

    console.log('[MIGAN Adapter] 输出维度:', dims);

    // NCHW -> RGBA
    const imageData = postProcess(
      outputData,
      originalImg.width,
      originalImg.height
    );

    // 6. 转换为 DataURL
    const canvas = document.createElement('canvas');
    canvas.width = originalImg.width;
    canvas.height = originalImg.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法获取 canvas context');
    }

    const resultImageData = new ImageData(imageData as any, originalImg.width, originalImg.height);
    ctx.putImageData(resultImageData, 0, 0);

    const resultDataUrl = canvas.toDataURL('image/png');
    console.timeEnd('postprocess');
    console.timeEnd('inpaint_total');

    return resultDataUrl;
  } catch (error) {
    console.error('[MIGAN Adapter] 处理失败:', error);
    throw error;
  }
}
