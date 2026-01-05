/**
 * Real-ESRGAN 图像超分辨率应用（支持切片处理）
 *
 * 使用 ONNXWorkerManager 进行 4x 图像放大
 * 支持大图片切片处理
 */

import React, { useState, useRef, useEffect } from "react";
import ONNXWorkerManager from "../utils/onnxWorkerManager";
import AppHeader from "../components/AppHeader";
import { ImgComparisonSlider } from "@img-comparison-slider/react";
import enhance, { type EnhanceOptions } from "../adapters/realesrgan-adapter";
import "./RMBGApp.css";
import { ToastContainer, toast } from "react-toastify";

interface RealESRGANAppProps {
  onBack: () => void;
}

const RealESRGANApp: React.FC<RealESRGANAppProps> = ({ onBack }) => {
  const [currentImage, setCurrentImage] = useState<HTMLImageElement | null>(
    null,
  );
  const [processedResult, setProcessedResult] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(100);
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // 进度相关状态
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
      height: Math.floor(finalHeight),
    };
  };

  // 初始化 ONNX Worker
  useEffect(() => {
    const initialize = async () => {
      try {
        console.log("[RealESRGANApp] 开始初始化 ONNX Worker...");

        const loadingToast = toast.info("⏳ 正在加载模型...", {
          autoClose: false,
          closeButton: false,
          closeOnClick: false,
          draggable: false,
        });

        const manager = ONNXWorkerManager.getInstance();

        if (!manager.isModelLoaded("realesrgan")) {
          console.log("[RealESRGANApp] 加载 Real-ESRGAN 模型...");
          const modelUrl =
            "https://huggingface.co/ryanli123/onnx/resolve/main/RealESR_Gx4_fp16.ort";

          await manager.loadModel("realesrgan", modelUrl, {
            onProgress: (progress) => {
              toast.update(loadingToast, {
                render: `⏳ 正在加载模型... ${progress}%`,
              });
            },
          });
        } else {
          console.log("[RealESRGANApp] Real-ESRGAN 模型已加载，跳过");
        }

        setIsInitialized(true);
        toast.dismiss(loadingToast);
        toast.success("✅ 模型已就绪！上传图片开始增强");
        console.log("✅ [RealESRGANApp] 初始化完成");
      } catch (error) {
        console.error("[RealESRGANApp] 初始化错误:", error);
        toast.error(
          `初始化失败: ${error instanceof Error ? error.message : "未知错误"}`,
        );
      }
    };

    initialize();

    return () => {
      // 清理可能存在的 AbortController
      if (abortController) {
        abortController.abort();
      }
    };
  }, []);

  // 窗口大小改变时重新计算
  useEffect(() => {
    if (!currentImage) return;

    const handleResize = () => {
      const size = calculateImageSize(currentImage.width, currentImage.height);
      if (size) {
        setImageSize(size);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [currentImage]);

  // 文件上传处理
  const handleFileSelect = (file: File) => {
    if (!file || !file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setCurrentImage(img);
        setProcessedResult(null);
        setSliderValue(100);
        setProcessingProgress(0);
        setProcessingStatus("");

        const size = calculateImageSize(img.width, img.height);
        if (size) {
          setImageSize(size);
        }

        // 显示图片信息
        const fileSize = (file.size / 1024 / 1024).toFixed(2);
        toast.success(
          `✅ 图片已加载: ${img.width}×${img.height} (${fileSize} MB)`,
        );
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    uploadAreaRef.current?.classList.add("drag-over");
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    uploadAreaRef.current?.classList.remove("drag-over");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    uploadAreaRef.current?.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  // 取消处理
  const cancelProcessing = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsProcessing(false);
      setProcessingProgress(0);
      setProcessingStatus("");
      toast.info("已取消处理");
    }
  };

  // 处理图片
  const processImage = async () => {
    if (!currentImage) return;

    // 创建 AbortController
    const controller = new AbortController();
    setAbortController(controller);

    try {
      setIsProcessing(true);
      setProcessingProgress(0);
      setProcessingStatus("正在准备...");

      console.time("[RealESRGANApp] 处理时间");

      const options: EnhanceOptions = {
        tileSize: 256,
        overlap: 16,
        concurrency: 1, // 串行处理，避免 OOM
        signal: controller.signal,
        onProgress: (progress, message) => {
          setProcessingProgress(progress);
          setProcessingStatus(message);
        },
      };

      const resultDataUrl = await enhance(currentImage, options);

      console.timeEnd("[RealESRGANApp] 处理时间");

      setProcessedResult(resultDataUrl);
      setSliderValue(50);
      setProcessingProgress(1);
      setProcessingStatus("处理完成");

      toast.success("✅ 增强完成！拖动滑块对比效果");
    } catch (error) {
      if (error instanceof Error && error.message.includes("cancelled")) {
        toast.info("已取消处理");
      } else {
        toast.error(
          `处理失败: ${error instanceof Error ? error.message : "未知错误"}`,
        );
        console.error("[RealESRGANApp] 处理错误:", error);
      }
    } finally {
      setIsProcessing(false);
      setAbortController(null);
    }
  };

  // 使用结果再次处理
  const useResultAsInput = () => {
    if (!processedResult || !currentImage) return;

    const img = new Image();
    img.onload = () => {
      setCurrentImage(img);
      setProcessedResult(null);
      setSliderValue(100);
      setProcessingProgress(0);

      const size = calculateImageSize(img.width, img.height);
      if (size) {
        setImageSize(size);
      }
    };
    img.src = processedResult;
  };

  const downloadResult = () => {
    if (!processedResult) return;

    const link = document.createElement("a");
    link.download = `realesrgan_enhanced_${Date.now()}.png`;
    link.href = processedResult;
    link.click();
  };

  const resetAll = () => {
    if (isProcessing && abortController) {
      cancelProcessing();
    }
    setCurrentImage(null);
    setProcessedResult(null);
    setSliderValue(100);
    setImageSize(null);
    setProcessingProgress(0);
    setProcessingStatus("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="rmbg-container">
      <AppHeader
        title="图像增强(4x)"
        icon="🔍"
        onBack={onBack}
        actions={
          <>
            {currentImage && !processedResult && !isProcessing && (
              <button
                className="app-header-btn app-header-btn-primary"
                onClick={processImage}
                disabled={!isInitialized}
              >
                🔍 4x 增强
              </button>
            )}
            {isProcessing && (
              <button
                className="app-header-btn app-header-btn-secondary"
                onClick={cancelProcessing}
              >
                ❌ 取消
              </button>
            )}
            {processedResult && (
              <button
                className="app-header-btn app-header-btn-primary"
                onClick={useResultAsInput}
              >
                🔄 再次增强
              </button>
            )}
            {currentImage && (
              <button
                className="app-header-btn app-header-btn-secondary"
                onClick={resetAll}
              >
                🗑️ 重新开始
              </button>
            )}
            {processedResult && (
              <button
                className="app-header-btn app-header-btn-primary"
                onClick={downloadResult}
              >
                💾 下载结果
              </button>
            )}
          </>
        }
      />

      <div className="rmbg-content">
        {!currentImage && (
          <div className="rmbg-upload-section">
            <div
              className="upload-notice"
              style={{
                padding: "2px",
                borderRadius: "5px",
                marginBottom: "5px",
                textAlign: "center",
                fontSize: "12px",
              }}
            >
              🔍 <strong>本地运行，支持任意尺寸图片</strong>
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
              <div className="rmbg-upload-subtext">
                支持 4x 超分辨率增强 • 自动切片处理大图
              </div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileInputChange}
                accept="image/*"
                style={{ display: "none" }}
              />
            </div>
            <div
              style={{
                marginTop: "20px",
                padding: "15px",
                background: "rgba(59, 130, 246, 0.1)",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#9ca3af",
              }}
            >
              <h3 style={{ margin: "0 0 10px 0", color: "#60a5fa" }}>
                💡 使用提示
              </h3>
              <ul style={{ margin: 0, paddingLeft: "20px" }}>
                <li>✅ 支持任意尺寸的图片（自动切片处理）</li>
                <li>✅ 大图片会分块处理，显示实时进度</li>
                <li>✅ 处理过程中可随时取消</li>
                <li>模型大小：5.05 MB（FP16）</li>
                <li>首次加载需要下载模型，请耐心等待</li>
              </ul>
            </div>
          </div>
        )}

        {currentImage && (
          <div className="rmbg-result-section" ref={containerRef}>
            {/* 进度显示 */}
            {isProcessing && (
              <div
                style={{
                  position: "absolute",
                  top: "10px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "rgba(0, 0, 0, 0.8)",
                  color: "white",
                  padding: "10px 20px",
                  borderRadius: "8px",
                  zIndex: 100,
                  minWidth: "300px",
                  textAlign: "center",
                }}
              >
                <div style={{ marginBottom: "8px", fontSize: "14px" }}>
                  {processingStatus}
                </div>
                <div
                  style={{
                    width: "100%",
                    height: "6px",
                    background: "rgba(255, 255, 255, 0.2)",
                    borderRadius: "3px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${processingProgress * 100}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <div
                  style={{
                    marginTop: "8px",
                    fontSize: "12px",
                    color: "#9ca3af",
                  }}
                >
                  {Math.round(processingProgress * 100)}%
                </div>
              </div>
            )}

            <div
              className="rmbg-slider-container"
              style={{
                ...(imageSize
                  ? { width: imageSize.width, height: imageSize.height }
                  : {}),
                background: "#1a1a1a",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <ImgComparisonSlider
                className="img-slider"
                value={sliderValue}
                style={
                  imageSize
                    ? { width: imageSize.width, height: imageSize.height }
                    : { height: "100%", width: "100%" }
                }
                {...(processedResult && {
                  onSlide: (event: any) =>
                    setSliderValue(Number(event.target.value)),
                })}
              >
                <img
                  slot="first"
                  src={currentImage.src}
                  alt="原始图片"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    objectPosition: "center",
                  }}
                />
                <img
                  slot="second"
                  src={processedResult || currentImage.src}
                  alt="增强后图片"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    objectPosition: "center",
                  }}
                />
              </ImgComparisonSlider>

              {/* 显示尺寸信息 */}
              {processedResult && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "10px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "rgba(0, 0, 0, 0.7)",
                    color: "white",
                    padding: "5px 15px",
                    borderRadius: "5px",
                    fontSize: "12px",
                    pointerEvents: "none",
                  }}
                >
                  {currentImage.width} × {currentImage.height} →{" "}
                  {currentImage.width * 4} × {currentImage.height * 4}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ToastContainer rtl autoClose={2000} position="bottom-right" />
    </div>
  );
};

export default RealESRGANApp;
