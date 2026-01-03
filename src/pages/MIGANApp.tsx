/**
 * MI-GAN Image Inpainting (Simple Version)
 *
 * 使用 ONNXWorkerManager + OpenCV.js
 */

import { useRef, useState, useEffect } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import AppHeader from '../components/AppHeader';
import { ImgComparisonSlider } from '@img-comparison-slider/react';
import ONNXWorkerManager from '../utils/onnxWorkerManager';
import { getModelUrl } from '../config/deployment';
import './AppCommon.css';
import './MIGANApp.css';

// 导入适配器
import inpaint from '../adapters/migan-adapter';

interface MIGANAppSimpleProps {
  onBack: () => void;
}

// 历史记录接口
interface HistoryItem {
  id: string;
  imageSrc: string;  // 该历史记录的图片数据URL
  timestamp: number;
  label: string;     // 显示标签（如"原始图片"、"修复 #1"等）
}

export default function MIGANAppSimple({ onBack }: MIGANAppSimpleProps) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string>('');
  const [resultSrc, setResultSrc] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [brushSize, setBrushSize] = useState(40);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasMask, setHasMask] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(100);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [showComparison, setShowComparison] = useState(false); // 是否显示对比图

  // 历史记录相关状态
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);

  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 初始化 ONNX Worker
  useEffect(() => {
    const initialize = async () => {
      try {
        console.log('[MIGANApp] 开始初始化 ONNX Worker...');

        // 显示持久化的加载提示
        const loadingToast = toast.info('⏳ 正在加载模型...', {
          autoClose: false,
          closeButton: false,
          closeOnClick: false,
          draggable: false
        });

        const manager = ONNXWorkerManager.getInstance();

        if (!manager.isModelLoaded('migan')) {
          console.log('[MIGANApp] 加载 MI-GAN 模型...');
          const modelUrl = getModelUrl('migan_pipeline_v2.ort');
          console.log('[MIGANApp] 模型 URL:', modelUrl);

          await manager.loadModel('migan', modelUrl, {
            onProgress: (progress) => {
              // 更新 toast 显示进度
              toast.update(loadingToast, {
                render: `⏳ 正在加载模型... ${progress}%`,
              });
            }
          });
        } else {
          console.log('[MIGANApp] MI-GAN 模型已加载，跳过');
        }

        setIsInitialized(true);
        toast.dismiss(loadingToast);
        toast.success('✅ 模型已就绪');
        console.log('✅ [MIGANApp] 初始化完成');
      } catch (error) {
        console.error('[MIGANApp] 初始化错误:', error);
        toast.error(`初始化失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    };

    initialize();

    return () => {
      // 全局 Worker 由 Manager 统一管理
    };
  }, []);

  // 计算图片显示尺寸
  const calculateImageSize = (imgWidth: number, imgHeight: number) => {
    if (!containerRef.current) return null;

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();

    const availableWidth = containerRect.width;
    const availableHeight = window.innerHeight - containerRect.top - 31;

    const imgRatio = imgWidth / imgHeight;
    const containerRatio = availableWidth / availableHeight;

    let finalWidth: number;
    let finalHeight: number;

    if (imgRatio > containerRatio) {
      finalWidth = availableWidth;
      finalHeight = availableWidth / imgRatio;
    } else {
      finalHeight = availableHeight;
      finalWidth = availableHeight * imgRatio;
    }

    return {
      width: Math.floor(finalWidth),
      height: Math.floor(finalHeight)
    };
  };

  // 窗口大小改变时重新计算
  useEffect(() => {
    if (!imageCanvasRef.current) return;

    const handleResize = () => {
      const img = imageCanvasRef.current;
      if (!img) return;
      const size = calculateImageSize(img.width, img.height);
      if (size) {
        setImageSize(size);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [imageSrc]);

  // 当从对比模式返回编辑模式时，重新绘制修复结果到 canvas
  useEffect(() => {
    if (!showComparison && resultSrc && imageCanvasRef.current) {
      // 从对比模式返回编辑模式，需要重新绘制修复结果
      const img = new Image();
      img.onload = () => {
        if (imageCanvasRef.current && maskCanvasRef.current) {
          imageCanvasRef.current.width = img.width;
          imageCanvasRef.current.height = img.height;
          maskCanvasRef.current.width = img.width;
          maskCanvasRef.current.height = img.height;

          const ctx = imageCanvasRef.current.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
          }

          // 更新容器尺寸
          const size = calculateImageSize(img.width, img.height);
          if (size) {
            setImageSize(size);
          }
        }
      };
      img.src = resultSrc;
    }
  }, [showComparison]);

  // 文件上传处理
  const handleFileSelect = (file: File) => {
    if (!file || !file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }

    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      setImageSrc(src);
      setResultSrc('');
      setHasMask(false);
      setSliderValue(100);
      setShowComparison(false);

      // 清空历史记录并添加原始图片
      const originalId = `original_${Date.now()}`;
      setHistory([{
        id: originalId,
        imageSrc: src,
        timestamp: Date.now(),
        label: '原始图片'
      }]);
      setCurrentHistoryId(originalId);

      // 图片加载完成后初始化canvas
      const img = new Image();
      img.onload = () => {
        if (imageCanvasRef.current && maskCanvasRef.current) {
          // 设置 canvas 的实际像素尺寸为图片原始尺寸
          imageCanvasRef.current.width = img.width;
          imageCanvasRef.current.height = img.height;
          maskCanvasRef.current.width = img.width;
          maskCanvasRef.current.height = img.height;

          const ctx = imageCanvasRef.current.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
          }

          // 计算并设置图片显示尺寸（用于容器）
          const size = calculateImageSize(img.width, img.height);
          if (size) {
            setImageSize(size);
          }
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

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

  const downloadResult = () => {
    if (!resultSrc) return;

    const link = document.createElement('a');
    link.download = `migan_result_${Date.now()}.png`;
    link.href = resultSrc;
    link.click();
  };

  const resetAll = () => {
    setImageFile(null);
    setImageSrc('');
    setResultSrc('');
    setSliderValue(100);
    setImageSize(null);
    setHasMask(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    // 清空canvas
    if (maskCanvasRef.current) {
      const ctx = maskCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
      }
    }
  };

  // 获取鼠标位置
  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = imageCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX: number, clientY: number;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  // 开始绘制
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setIsDrawing(true);

    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;

    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    const { x, y } = getCoordinates(e);

    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    maskCtx.lineWidth = brushSize;
    maskCtx.strokeStyle = 'rgba(255, 0, 0, 0.5)';

    maskCtx.beginPath();
    maskCtx.moveTo(x, y);
  };

  // 绘制中
  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();

    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;

    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    const { x, y } = getCoordinates(e);

    maskCtx.lineTo(x, y);
    maskCtx.stroke();
  };

  // 停止绘制
  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;

    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    maskCtx.closePath();

    // 检查是否有蒙版
    const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        setHasMask(true);
        return;
      }
    }
    setHasMask(false);
  };

  // 清空蒙版
  const clearMask = () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;

    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    setHasMask(false);
  };

  // 处理图片
  const handleProcess = async () => {
    if (!imageFile || !maskCanvasRef.current) {
      toast.error('请先绘制蒙版再修复');
      return;
    }

    setIsProcessing(true);

    try {
      console.log('[MIGANApp] 开始处理...');
      toast.info('⏳ 正在修复...');

      const maskDataUrl = maskCanvasRef.current.toDataURL();
      const result = await inpaint(imageFile, maskDataUrl);

      setResultSrc(result);

      // 将修复结果加载到 canvas 上，作为新的底图
      const img = new Image();
      img.onload = () => {
        if (imageCanvasRef.current && maskCanvasRef.current) {
          imageCanvasRef.current.width = img.width;
          imageCanvasRef.current.height = img.height;
          maskCanvasRef.current.width = img.width;
          maskCanvasRef.current.height = img.height;

          const ctx = imageCanvasRef.current.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
          }

          // 清空蒙版
          const maskCtx = maskCanvasRef.current.getContext('2d');
          if (maskCtx) {
            maskCtx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
          }

          setHasMask(false);
          setShowComparison(false);
          setSliderValue(50);

          // 更新 imageFile 为修复结果，以便下次修复使用
          fetch(result)
            .then(res => res.blob())
            .then(blob => {
              const file = new File([blob], 'migan_result.png', { type: 'image/png' });
              setImageFile(file);
            });

          // 添加到历史记录
          const repairCount = history.filter(h => h.label.startsWith('修复')).length + 1;
          const newHistoryId = `repair_${Date.now()}`;
          const newHistoryItem: HistoryItem = {
            id: newHistoryId,
            imageSrc: result,
            timestamp: Date.now(),
            label: `修复 #${repairCount}`
          };

          setHistory(prev => [...prev, newHistoryItem]);
          setCurrentHistoryId(newHistoryId);

          toast.success('✅ 修复完成！可继续修复或点击对比');
        }
      };
      img.src = result;
    } catch (error) {
      console.error('[MIGANApp] 处理错误:', error);
      toast.error(`处理失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // 点击历史记录项，恢复到该状态
  const handleHistoryItemClick = (historyItem: HistoryItem) => {
    const img = new Image();
    img.onload = () => {
      if (imageCanvasRef.current && maskCanvasRef.current) {
        imageCanvasRef.current.width = img.width;
        imageCanvasRef.current.height = img.height;
        maskCanvasRef.current.width = img.width;
        maskCanvasRef.current.height = img.height;

        const ctx = imageCanvasRef.current.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
        }

        // 清空蒙版
        const maskCtx = maskCanvasRef.current.getContext('2d');
        if (maskCtx) {
          maskCtx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
        }

        // 更新容器尺寸
        const size = calculateImageSize(img.width, img.height);
        if (size) {
          setImageSize(size);
        }

        // 更新状态
        setCurrentHistoryId(historyItem.id);
        setHasMask(false);
        setShowComparison(false);
        setResultSrc(historyItem.imageSrc);

        // 更新 imageFile
        fetch(historyItem.imageSrc)
          .then(res => res.blob())
          .then(blob => {
            const file = new File([blob], 'history_restore.png', { type: 'image/png' });
            setImageFile(file);
          });
      }
    };
    img.src = historyItem.imageSrc;
  };

  return (
    <div className="app-container">
      <AppHeader
        title="图像修复 (MI-GAN)"
        icon="✨"
        onBack={onBack}
        actions={
          <>
            {imageSrc && (
              <>
                {!showComparison && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '12px' }}>
                      <label style={{ color: '#9ca3af', fontSize: '12px', whiteSpace: 'nowrap' }}>笔刷: {brushSize}</label>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        value={brushSize}
                        onChange={(e) => setBrushSize(Number(e.target.value))}
                        style={{ width: '80px' }}
                      />
                    </div>
                    <button
                      className="app-header-btn app-header-btn-secondary"
                      onClick={clearMask}
                      disabled={!hasMask}
                    >
                      清空蒙版
                    </button>
                    <button
                      className="app-header-btn app-header-btn-primary"
                      onClick={handleProcess}
                      disabled={!isInitialized || isProcessing || !hasMask}
                    >
                      {isProcessing ? '处理中...' : '✨ 开始修复'}
                    </button>
                  </>
                )}
                {resultSrc && showComparison && (
                  <button
                    className="app-header-btn app-header-btn-primary"
                    onClick={() => setShowComparison(false)}
                  >
                    ✏️ 返回编辑
                  </button>
                )}
                {resultSrc && !showComparison && (
                  <button
                    className="app-header-btn app-header-btn-primary"
                    onClick={() => setShowComparison(true)}
                  >
                    🔍 对比原图
                  </button>
                )}
                {resultSrc && (
                  <>
                    <button
                      className="app-header-btn app-header-btn-secondary"
                      onClick={resetAll}
                      disabled={isProcessing}
                    >
                      🗑️ 重新开始
                    </button>
                    <button
                      className="app-header-btn app-header-btn-primary"
                      onClick={downloadResult}
                    >
                      💾 下载结果
                    </button>
                  </>
                )}
              </>
            )}
          </>
        }
      />

      <div className="app-content" style={{ display: 'flex', flexDirection: 'row' }}>
        {/* 历史记录侧边栏 */}
        {history.length > 0 && (
          <div className="history-sidebar">
            <div className="history-header">
              <h3>修复历史</h3>
            </div>
            <div className="history-list">
              {history.map((item) => (
                <div
                  key={item.id}
                  className={`history-item ${item.id === currentHistoryId ? 'history-item-active' : ''}`}
                  onClick={() => handleHistoryItemClick(item)}
                >
                  <div className="history-item-thumbnail">
                    <img src={item.imageSrc} alt={item.label} />
                  </div>
                  <div className="history-item-info">
                    <div className="history-item-label">{item.label}</div>
                    <div className="history-item-time">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  {item.id === currentHistoryId && (
                    <div className="history-item-indicator">✓</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 主内容区域 */}
        <div className="app-main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden' }}>
        {!imageSrc ? (
          <div className="app-upload-section">
            <div className="upload-notice" style={{
              padding: '2px',
              borderRadius: '5px',
              marginBottom: '5px',
              textAlign: 'center',
              fontSize: '12px'
            }}>
              ✨ <strong>本地运行，不会上传您的照片</strong>
            </div>
            <div
              className="app-upload-area"
              ref={uploadAreaRef}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="app-upload-icon">📸</div>
              <div className="app-upload-text">点击上传图片</div>
              <div className="app-upload-subtext">拖拽图片到这里，上传后涂抹需要修复的区域</div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileInputChange}
                accept="image/*"
                style={{ display: 'none' }}
              />
            </div>
          </div>
        ) : (
          <>
            {/* 编辑模式 - 显示 Canvas 双层结构 (只要不在对比模式就显示) */}
            {!showComparison && (
              <div className="app-result-section" ref={containerRef}>
                <div
                  className="app-slider-container"
                  style={{
                    ...(imageSize ? { width: imageSize.width, height: imageSize.height } : {}),
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {/* 图片层 */}
                  <canvas
                    ref={imageCanvasRef}
                    style={{
                      display: 'block',
                      maxWidth: '100%',
                      maxHeight: '100%',
                      width: 'auto',
                      height: 'auto',
                      objectFit: 'contain'
                    }}
                  />

                  {/* 蒙版层 - 绝对定位叠加 */}
                  <canvas
                    ref={maskCanvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      maxWidth: '100%',
                      maxHeight: '100%',
                      width: 'auto',
                      height: 'auto',
                      cursor: 'crosshair',
                      zIndex: 1
                    }}
                  />
                </div>
              </div>
            )}

            {/* 对比模式 - 使用 ImgComparisonSlider */}
            {showComparison && resultSrc && (
              <div className="app-result-section" ref={containerRef}>
                <div
                  className="app-slider-container"
                  style={{
                    ...(imageSize ? { width: imageSize.width, height: imageSize.height } : {})
                  }}
                >
                  <ImgComparisonSlider
                    className="img-slider"
                    value={sliderValue}
                    style={imageSize ? { width: imageSize.width, height: imageSize.height } : { height: '100%', width: '100%' }}
                    onSlide={(event: any) => setSliderValue(Number(event.target.value))}
                  >
                    <img
                      slot="first"
                      src={imageSrc}
                      alt="原始图片"
                      style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
                    />
                    <img
                      slot="second"
                      src={resultSrc}
                      alt="修复结果"
                      style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center' }}
                    />
                  </ImgComparisonSlider>
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </div>

      {isProcessing && (
        <div className="app-processing-overlay show">
          <div className="app-processing-content">
            <div className="app-spinner"></div>
            <h3>正在修复中...</h3>
            <p>MI-GAN 模型正在处理</p>
          </div>
        </div>
      )}

      <ToastContainer rtl autoClose={2000} position="bottom-right" />
    </div>
  );
}
