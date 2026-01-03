/**
 * Worker 版本的 RMBG 应用
 *
 * 演示如何使用 Web Worker 进行非阻塞的 ONNX 推理
 */

import React, { useState, useRef, useEffect } from 'react';
import ONNXWorkerManager from '../utils/onnxWorkerManager';
import AppHeader from '../components/AppHeader';
import { ImgComparisonSlider } from '@img-comparison-slider/react';
import { getModelUrl } from '../config/deployment';
import './RMBGApp.css';
import { ToastContainer,toast } from 'react-toastify';

interface RMBGAppProps {
  onBack: () => void;
}

// interface ProcessingHistory {
//   id: string;
//   originalImage: HTMLImageElement;
//   result: string;
//   timestamp: number;
// }

const RMBGAppWorker: React.FC<RMBGAppProps> = ({ onBack }) => {
  const [currentImage, setCurrentImage] = useState<HTMLImageElement | null>(null);
  const [processedResult, setProcessedResult] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(100); // 100 = 只显示原图，50 = 对比
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  // const [processingHistory, setProcessingHistory] = useState<ProcessingHistory[]>([]);
  // const [currentHistoryIndex, setCurrentHistoryIndex] = useState<number>(-1); // -1 表示当前正在处理的图片
  const [backgroundType, setBackgroundType] = useState<string>('checkerboard-dark'); // 背景类型
  const [showBackgroundPicker, setShowBackgroundPicker] = useState(false); // 是否显示背景选择器

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const backgroundPickerRef = useRef<HTMLDivElement>(null);

  // 背景样式配置
  const backgroundStyles = {
    'checkerboard-dark': {
      name: '深色棋盘格',
      style: {
        backgroundColor: '#1a1a1a',
        backgroundImage: `
          linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
          linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
          linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
      }
    },
    'checkerboard-light': {
      name: '浅色棋盘格',
      style: {
        backgroundColor: '#ffffff',
        backgroundImage: `
          linear-gradient(45deg, #e0e0e0 25%, transparent 25%),
          linear-gradient(-45deg, #e0e0e0 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #e0e0e0 75%),
          linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
      }
    },
    'checkerboard-blue': {
      name: '蓝色棋盘格',
      style: {
        backgroundColor: '#ffffff',
        backgroundImage: `
          linear-gradient(45deg, #d4e5f7 25%, transparent 25%),
          linear-gradient(-45deg, #d4e5f7 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #d4e5f7 75%),
          linear-gradient(-45deg, transparent 75%, #d4e5f7 75%)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
      }
    },
    'checkerboard-pink': {
      name: '粉色棋盘格',
      style: {
        backgroundColor: '#ffffff',
        backgroundImage: `
          linear-gradient(45deg, #ffeef8 25%, transparent 25%),
          linear-gradient(-45deg, #ffeef8 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #ffeef8 75%),
          linear-gradient(-45deg, transparent 75%, #ffeef8 75%)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
      }
    },
    'solid-white': {
      name: '纯白色',
      style: {
        backgroundColor: '#ffffff'
      }
    },
    'solid-gray': {
      name: '浅灰色',
      style: {
        backgroundColor: '#f0f0f0'
      }
    },
    'solid-black': {
      name: '纯黑色',
      style: {
        backgroundColor: '#000000'
      }
    }
  };

  // 获取当前背景样式
  const getBackgroundStyle = () => {
    const bg = backgroundStyles[backgroundType as keyof typeof backgroundStyles];
    return bg?.style || backgroundStyles['checkerboard-dark'].style;
  };

  // 计算图片显示尺寸以适应可见区域
  const calculateImageSize = (imgWidth: number, imgHeight: number) => {
    if (!containerRef.current) return null;

    // 获取容器尺寸
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();

    // 减去 padding、边框和 slider 组件内部的空间
    const availableWidth = containerRect.width ; // 预留更多空间给边框和间隙
    const availableHeight = window.innerHeight - containerRect.top - 31; // 留出 header、底部和状态提示的空间

    // 计算宽高比
    const imgRatio = imgWidth / imgHeight;
    const containerRatio = availableWidth / availableHeight;

    let finalWidth: number;
    let finalHeight: number;

    if (imgRatio > containerRatio) {
      // 图片更宽，以宽度为基准
      finalWidth = availableWidth;
      finalHeight = availableWidth / imgRatio;
    } else {
      // 图片更高，以高度为基准
      finalHeight = availableHeight;
      finalWidth = availableHeight * imgRatio;
    }

    // 向下取整避免小数
    return {
      width: Math.floor(finalWidth),
      height: Math.floor(finalHeight)
    };
  };

  // 初始化 ONNX Worker（使用全局共享 Worker）
  useEffect(() => {
    const initialize = async () => {
      try {
        console.log('[RMBGWorkerApp] 开始初始化 ONNX Worker...');

        // 显示持久化的加载提示
        const loadingToast = toast.info('⏳ 正在加载模型...', {
          autoClose: false,
          closeButton: false,
          closeOnClick: false,
          draggable: false
        });

        // 使用全局共享 Worker Manager
        const manager = ONNXWorkerManager.getInstance();

        // 加载模型（如果尚未加载）
        if (!manager.isModelLoaded('rmbg')) {
          console.log('[RMBGWorkerApp] 加载 RMBG 模型...');
          const modelUrl = getModelUrl('rmbg_quantized.ort');
          console.log('[RMBGWorkerApp] 模型 URL:', modelUrl);

          await manager.loadModel('rmbg', modelUrl, {
            onProgress: (progress) => {
              // 更新 toast 显示进度
              toast.update(loadingToast, {
                render: `⏳ 正在加载模型... ${progress}%`,
              });
            }
          });
        } else {
          console.log('[RMBGWorkerApp] RMBG 模型已加载，跳过');
        }

        setIsInitialized(true);
        toast.dismiss(loadingToast);
        toast.success('✅ 模型已就绪');
        console.log('✅ [RMBGWorkerApp] 初始化完成 (Worker 模式)');

      } catch (error) {
        console.error('[RMBGWorkerApp] 初始化错误:', error);
        toast.error(`初始化失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    };

    initialize();

    // 清理函数（不释放全局 Worker，只清理本地状态）
    return () => {
      // 全局 Worker 由 Manager 统一管理，这里不需要释放
    };
  }, []);

  // 文件上传处理
  const handleFileSelect = (file: File) => {
    if (!file || !file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setCurrentImage(img);
        setProcessedResult(null); // 清空之前的结果
        setSliderValue(100); // 设置为只显示原图（divider 在最右侧）
        // setProcessingHistory([]); // 清空历史记录
        // setCurrentHistoryIndex(-1);

        // 计算并设置图片显示尺寸
        const size = calculateImageSize(img.width, img.height);
        if (size) {
          setImageSize(size);
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // 使用当前处理结果作为新的输入图片
  const useResultAsInput = () => {
    if (!processedResult || !currentImage) return;

    const img = new Image();
    img.onload = () => {
      // 保存当前状态到历史记录
      // const historyItem: ProcessingHistory = {
      //   id: Date.now().toString(),
      //   originalImage: currentImage,
      //   result: processedResult,
      //   timestamp: Date.now()
      // };

      // setProcessingHistory(prev => [...prev, historyItem]);
      // setCurrentHistoryIndex(prev => prev + 1);

      // 使用结果作为新的输入
      setCurrentImage(img);
      setProcessedResult(null);
      setSliderValue(100);

      // 重新计算尺寸
      const size = calculateImageSize(img.width, img.height);
      if (size) {
        setImageSize(size);
      }
    };
    img.src = processedResult!;
  };

  // 窗口大小改变时重新计算图片尺寸
  useEffect(() => {
    if (!currentImage) return;

    const handleResize = () => {
      const size = calculateImageSize(currentImage.width, currentImage.height);
      console.log("photo size",size)

      if (size) {
        setImageSize(size);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [currentImage]);

  // 点击背景选择器外部时关闭面板
  useEffect(() => {
    if (!showBackgroundPicker) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        backgroundPickerRef.current &&
        !backgroundPickerRef.current.contains(event.target as Node)
      ) {
        setShowBackgroundPicker(false);
      }
    };

    // 使用 mousedown 事件可以更快地响应
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showBackgroundPicker]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    uploadAreaRef.current?.classList.add('drag-over');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    uploadAreaRef.current?.classList.remove('drag-over');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    uploadAreaRef.current?.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  // 预处理图片
  const preprocessImage = (img: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) throw new Error('无法创建2D上下文');

    const modelConfig = {
      do_normalize: true,
      do_rescale: true,
      rescale_factor: 0.00392156862745098,
      image_mean: [0.5, 0.5, 0.5],
      image_std: [1.0, 1.0, 1.0]
    };

    const targetSize = 1024;
    canvas.width = targetSize;
    canvas.height = targetSize;

    ctx.drawImage(img, 0, 0, targetSize, targetSize);

    const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
    const data = imageData.data;

    const input = new Float32Array(3 * targetSize * targetSize);

    for (let i = 0; i < data.length; i += 4) {
      const pixelIndex = i / 4;
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (modelConfig.do_rescale) {
        r = r * modelConfig.rescale_factor;
        g = g * modelConfig.rescale_factor;
        b = b * modelConfig.rescale_factor;
      }

      if (modelConfig.do_normalize) {
        r = (r - modelConfig.image_mean[0]) / modelConfig.image_std[0];
        g = (g - modelConfig.image_mean[1]) / modelConfig.image_std[1];
        b = (b - modelConfig.image_mean[2]) / modelConfig.image_std[2];
      }

      input[pixelIndex] = r;
      input[pixelIndex + targetSize * targetSize] = g;
      input[pixelIndex + 2 * targetSize * targetSize] = b;
    }

    // 创建适合 Worker 的输入格式
    return {
      input: {  // 模型期望的输入名称
        data: input,
        dims: [1, 3, targetSize, targetSize],
        type: 'float32' as const
      }
    };
  };

  // 后处理结果 (与主线程版本相同)
  const postprocessResult = async (result: any, originalImg: HTMLImageElement) => {
    const outputTensor = result.output || result[Object.keys(result)[0]];
    const outputData = outputTensor.data;
    const outputDims = outputTensor.dims;

    const height = outputDims[2];
    const width = outputDims[3];

    console.log('[RMBGWorkerApp] 输出维度:', outputDims);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');

    if (!maskCtx) throw new Error('无法创建蒙版2D上下文');

    const maskImageData = maskCtx.createImageData(width, height);
    const processedData = new Float32Array(width * height);

    for (let i = 0; i < outputData.length; i++) {
      let value = outputData[i];
      if (value > 10 || value < -10) {
        value = 1 / (1 + Math.exp(-value));
      }
      value = Math.max(0, Math.min(1, value));
      processedData[i] = value;
    }

    const otsuThreshold = calculateOtsuThreshold(processedData, width, height);

    for (let i = 0; i < processedData.length; i++) {
      const value = processedData[i] > otsuThreshold ? 1.0 : 0.0;
      const pixelIndex = i * 4;
      maskImageData.data[pixelIndex] = value * 255;
      maskImageData.data[pixelIndex + 1] = value * 255;
      maskImageData.data[pixelIndex + 2] = value * 255;
      maskImageData.data[pixelIndex + 3] = value * 255;
    }

    maskCtx.putImageData(maskImageData, 0, 0);

    const fullResCanvas = document.createElement('canvas');
    const fullResCtx = fullResCanvas.getContext('2d');
    if (!fullResCtx) throw new Error('无法创建高分辨率canvas');
    fullResCanvas.width = originalImg.width;
    fullResCanvas.height = originalImg.height;

    fullResCtx.drawImage(originalImg, 0, 0);

    const fullResMaskCanvas = document.createElement('canvas');
    const fullResMaskCtx = fullResMaskCanvas.getContext('2d');
    if (!fullResMaskCtx) throw new Error('无法创建高分辨率蒙版canvas');
    fullResMaskCanvas.width = originalImg.width;
    fullResMaskCanvas.height = originalImg.height;

    fullResMaskCtx.drawImage(maskCanvas, 0, 0, width, height, 0, 0, originalImg.width, originalImg.height);

    fullResCtx.globalCompositeOperation = 'destination-in';
    fullResCtx.drawImage(fullResMaskCanvas, 0, 0);
    fullResCtx.globalCompositeOperation = 'source-over';

    return fullResCanvas.toDataURL('image/png');
  };

  const calculateOtsuThreshold = (data: Float32Array, width: number, height: number): number => {
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i++) {
      const bin = Math.min(255, Math.floor(data[i] * 255));
      histogram[bin]++;
    }

    const total = width * height;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * histogram[i];
    }

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let varMax = 0;
    let threshold = 0;

    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;

      wF = total - wB;
      if (wF === 0) break;

      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;

      const varBetween = wB * wF * (mB - mF) * (mB - mF);

      if (varBetween > varMax) {
        varMax = varBetween;
        threshold = t;
      }
    }

    return threshold / 255.0;
  };

  // 处理图片 (使用 Worker)
  const processImage = async () => {
    if (!currentImage) return;

    try {
      setIsProcessing(true);
      toast.info('⏳ 正在处理...');

      // 预处理
      const processedInput = preprocessImage(currentImage);

      // ⭐ 关键：从 Manager 获取 proxy 并运行推理
      const manager = ONNXWorkerManager.getInstance();
      const result = await manager.run('rmbg', processedInput);

      console.log('[RMBGWorkerApp] ✅ Worker 推理完成');

      // 后处理
      const resultDataUrl = await postprocessResult(result, currentImage);
      setProcessedResult(resultDataUrl);
      setSliderValue(50); // 设置为中间位置，方便对比

      // 保存到历史记录
      // const historyItem: ProcessingHistory = {
      //   id: Date.now().toString(),
      //   originalImage: currentImage,
      //   result: resultDataUrl,
      //   timestamp: Date.now()
      // };
      // setProcessingHistory(prev => [...prev, historyItem]);
      // setCurrentHistoryIndex(prev => prev + 1);

      toast.success('✅ 处理完成！拖动滑块对比效果');
    } catch (error) {
      toast.error(`处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
      console.error('[RMBGWorkerApp] 处理错误:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadResult = () => {
    if (!processedResult) return;

    const link = document.createElement('a');
    link.download = `rmbg_worker_result_${Date.now()}.png`;
    link.href = processedResult;
    link.click();
  };

  const resetAll = () => {
    setCurrentImage(null);
    setProcessedResult(null);
    setSliderValue(100);
    setImageSize(null);
    // setProcessingHistory([]);
    // setCurrentHistoryIndex(-1);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="rmbg-container">
      <AppHeader
        title="一键去背景 (Worker版)"
        icon="⚡"
        onBack={onBack}
        actions={
          <>
            {currentImage && !processedResult && (
              <button
                className="app-header-btn app-header-btn-primary"
                onClick={processImage}
                disabled={!isInitialized || isProcessing}
              >
                {isProcessing ? '处理中（Worker）...' : '⚡ Worker处理'}
              </button>
            )}
            {processedResult && (
              <button
                className="app-header-btn app-header-btn-primary"
                onClick={useResultAsInput}
                disabled={isProcessing}
              >
                🔄 使用结果再次处理
              </button>
            )}
            {currentImage && (
              <button className="app-header-btn app-header-btn-secondary" onClick={resetAll}>
                🗑️ 重新开始
              </button>
            )}
            {processedResult && (
              <button className="app-header-btn app-header-btn-primary" onClick={downloadResult}>
                💾 下载结果
              </button>
            )}
          </>
        }
      />

      <div className="rmbg-content">
        {!currentImage && (
          <div className="rmbg-upload-section">
            <div className="upload-notice" style={{
              // background: '#e3f2fd',
              padding: '2px',
              borderRadius: '5px',
              marginBottom: '5px',
              textAlign: 'center',
              fontSize: '12px'
            }}>
              ⚡ <strong>本地运行，不会上传您的照片</strong>
            </div>
            <div
              className="rmbg-upload-area"
              ref={uploadAreaRef}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="rmbg-upload-icon">📸</div>
              <div className="rmbg-upload-text">点击上传图片</div>
              <div className="rmbg-upload-subtext">拖拽图片到这里 (支持 JPG, PNG, WebP)</div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileInputChange}
                accept="image/*"
                style={{ display: 'none' }}
              />
            </div>
          </div>
        )}

        {currentImage && (
          <div className="rmbg-result-section" ref={containerRef}>
            <div
              className="rmbg-slider-container"
              style={{
                ...(imageSize ? { width:imageSize.width, height: imageSize.height, maxHeight:imageSize.height } : {}),
                ...getBackgroundStyle(),
                border: '1px solid rgba(255, 255, 255, 0.05)'
              }}
            >
              <ImgComparisonSlider
                className="img-slider"
                value={sliderValue}
                style={imageSize ? { width:imageSize.width,height: imageSize.height,maxHeight:imageSize.height } :{ height: '100%', width: '100%' }}
                // 只在有结果时才允许拖动
                {...(processedResult && {
                  onSlide: (event: any) => setSliderValue(Number(event.target.value))
                })}
              >
                <img
                  slot="first"
                  src={currentImage.src}
                  alt="原始图片"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
                />
                <img
                    slot="second"
                    src={processedResult||currentImage.src}
                    alt="处理后图片"
                    style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
                />

              </ImgComparisonSlider>
            </div>
          </div>
        )}

      </div>

      {/* 背景选择器悬浮工具条 */}
      {currentImage && (
        <div className="background-picker-container" ref={backgroundPickerRef}>
          <button
            className="background-picker-toggle"
            onClick={() => setShowBackgroundPicker(!showBackgroundPicker)}
            title="切换背景"
          >
            🎨
          </button>
          {showBackgroundPicker && (
            <div className="background-picker-panel">
              <div className="background-picker-header">背景样式</div>
              <div className="background-picker-options">
                {Object.entries(backgroundStyles).map(([key, config]) => (
                  <button
                    key={key}
                    className={`background-option ${backgroundType === key ? 'active' : ''}`}
                    onClick={() => {
                      setBackgroundType(key);
                      // toast.success(`已切换为: ${config.name}`);
                    }}
                    title={config.name}
                  >
                    <div
                      className="background-preview"
                      style={config.style}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isProcessing && (
        <div className="rmbg-processing-overlay show">
          <div className="rmbg-processing-content">
            <div className="rmbg-spinner"></div>
            <h3>正在处理中...</h3>
          </div>
        </div>
      )}
      <ToastContainer  rtl  autoClose={2000} position="bottom-right"/>
    </div>
  );
};

export default RMBGAppWorker;
