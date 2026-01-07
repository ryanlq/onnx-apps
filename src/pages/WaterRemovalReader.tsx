import React, { useState, useRef, useEffect } from "react";
import AppHeader from "../components/AppHeader";
import { initializeBGEModel } from "../adapters/bge-embedding-adapter";
import {
  splitIntoParagraphs,
  cleanText,
  splitIntoChapters,
  type Chapter,
} from "../utils/textProcessing";
import {
  scoreParagraphs,
  applyWaterRemovalMode,
  type WaterRemovalConfig,
} from "../adapters/waterRemoval";
import { parseEpub } from "../utils/epubParser";
import "./WaterRemovalReader.css";
import { ToastContainer, toast } from "react-toastify";

interface WaterRemovalReaderProps {
  onBack: () => void;
}

const WaterRemovalReader: React.FC<WaterRemovalReaderProps> = ({ onBack }) => {
  // 文本和段落
  const [rawText, setRawText] = useState<string>("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<number>(0);
  const [paragraphs, setParagraphs] = useState<any[]>([]);

  // 处理状态
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [progress, setProgress] = useState(0);

  // 阅读模式
  const [readMode, setReadMode] = useState<"normal" | "original">("normal"); // 默认为去水模式
  const [visibleParagraphs, setVisibleParagraphs] = useState<Set<number>>(
    new Set(),
  );

  // 侧边栏状态
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 配置
  const [keepThreshold, setKeepThreshold] = useState(0.7);
  const [foldThreshold, setFoldThreshold] = useState(0.4);
  const [autoWaterRemoval, setAutoWaterRemoval] = useState(true); // 自动去水开关，默认开启

  // 去水统计
  const [removalStats, setRemovalStats] = useState<{
    originalParagraphs: number;
    keptParagraphs: number;
    removedParagraphs: number;
    originalWords: number;
    keptWords: number;
    removedWords: number;
    removalRate: number;
  } | null>(null);

  // 批量处理状态
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({
    total: 0,
    processed: 0,
    currentChapter: "",
  });
  const [batchPaused, setBatchPaused] = useState(false);

  // 新手引导是否展开
  const [guideExpanded, setGuideExpanded] = useState(false);

  // 连续被折叠的段落计数
  const countConsecutiveFolded = (index: number) => {
    let count = 0;
    for (let i = index; i < paragraphs.length; i++) {
      if (!visibleParagraphs.has(paragraphs[i].id)) {
        count++;
      } else {
        break;
      }
    }
    return count;
  };

  // 跟踪哪些占位符是展开状态（显示原文内容）
  const [expandedPlaceholders, setExpandedPlaceholders] = useState<Set<number>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoProcessTriggeredRef = useRef(false); // 跟踪是否已经触发过自动处理

  // 初始化模型
  useEffect(() => {
    const init = async () => {
      try {
        const loadingToast = toast.info("⏳ 正在加载 BGE 模型...", {
          autoClose: false,
          closeButton: false,
          closeOnClick: false,
          draggable: false,
        });

        await initializeBGEModel();

        setIsInitialized(true);
        toast.dismiss(loadingToast);
        toast.success("✅ 模型加载完成");

        // 模型加载完成后，如果开启了自动去水且有章节，自动处理当前章节
        if (autoWaterRemoval && chapters.length > 0 && !autoProcessTriggeredRef.current) {
          autoProcessTriggeredRef.current = true;
          await processChapter(currentChapter);
        }
      } catch (error) {
        toast.error(
          `模型加载失败: ${error instanceof Error ? error.message : "未知错误"}`,
        );
      }
    };

    init();
  }, []);

  // ESC 键关闭设置弹窗
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && settingsOpen) {
        setSettingsOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [settingsOpen]);

  // 文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setProgress(0);

    // 重置自动处理触发器，确保新文件上传时会自动处理
    autoProcessTriggeredRef.current = false;

    try {
      let cleanedText = "";
      let chapterData: Array<{
        title: string;
        content: string;
        index: number;
      }> = [];

      // 判断文件类型
      if (file.name.endsWith(".epub")) {
        // EPUB 文件
        const _toast_epub_parse = toast.info("📖 正在解析 EPUB 文件...", {
          autoClose: false,
          closeButton: false,
        });

        const epubChapters = await parseEpub(file);

        // 转换为章节数据
        chapterData = epubChapters.map((chap, idx) => ({
          title: chap.title,
          content: chap.content,
          index: idx,
        }));

        cleanedText = chapterData.map((ch) => ch.content).join("\n\n");

        // 清除加载提示
        toast.dismiss(_toast_epub_parse);

        if (chapterData.length === 0) {
          toast.error(
            `⚠️ EPUB 解析完成，但未找到有效章节（文件可能损坏或格式不兼容）`,
            { autoClose: 5000 },
          );
        } else {
          toast.success(`✅ EPUB 解析成功，共 ${chapterData.length} 章`, {
            autoClose: 2000,
          });
        }
      } else {
        // TXT 文件
        const text = await file.text();
        cleanedText = cleanText(text);

        // 分割章节
        // toast.info("📚 正在识别章节...");
        chapterData = splitIntoChapters(cleanedText);
        // toast.success(`✅ TXT 文件加载成功，共 ${chapterData.length} 章`);
      }

      setRawText(cleanedText);

      // 为每个章节添加ID和空段落数组
      const chaptersWithParagraphs: Chapter[] = chapterData.map(
        (chap, idx) => ({
          id: idx,
          title: chap.title,
          content: chap.content,
          paragraphs: [],
        }),
      );

      setChapters(chaptersWithParagraphs);
      setCurrentChapter(0);

      // 初始化第一章的段落显示（使用本地数据，不依赖状态更新）
      if (chaptersWithParagraphs.length > 0) {
        const firstChapter = chaptersWithParagraphs[0];
        const paragraphs = splitIntoParagraphs(firstChapter.content);
        const paragraphsWithVisible = paragraphs.map((p) => ({
          ...p,
          visible: true,
        }));
        setParagraphs(paragraphsWithVisible);
        const visibleSet = new Set(paragraphs.map((p) => p.id));
        setVisibleParagraphs(visibleSet);

        // 如果模型已初始化且自动去水开启，立即处理第一章
        if (isInitialized && autoWaterRemoval) {
          // 稍微延迟，等待状态更新完成
          setTimeout(() => {
            processChapter(0);
          }, 100);
        }
      }
    } catch (error) {
      console.error("File parsing error:", error);
      toast.error(
        `文件解析失败: ${error instanceof Error ? error.message : "未知错误"}`,
      );
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  // 处理单个章节
  const processChapter = async (chapterIndex: number) => {
    console.log("[debug] chapterIndex: ",chapterIndex)
    if (chapters.length === 0) return;

    const chapter = chapters[chapterIndex];
    
    console.log("[debug] chapter: ",chapter)
    if (!chapter) return;

    // 检查模型是否准备好
    if (!isInitialized) {
      toast.warn("⏳ 模型正在加载中，请稍候...", {
        autoClose: 3000,
      });
      return;
    }

    setIsProcessing(true);
    setProgress(0);

    // 保存处理前的字数统计
    const originalParagraphs = splitIntoParagraphs(chapter.content);
    const originalWordCount = originalParagraphs.reduce(
      (sum, p) => sum + p.text.length,
      0,
    );

    try {
      // 1. 分段
      const paras = splitIntoParagraphs(chapter.content);

      // 2. 生成 embeddings 并评分
      const config: WaterRemovalConfig = {
        keepThreshold,
        foldThreshold,
        windowSize: 5,
        minParagraphLength: 20,
      };

      const scores = await scoreParagraphs(paras, config, (current, total) => {
        const prog = Math.round((current / total) * 100);
        setProgress(prog);
      });

      // 3. 应用当前模式
      const visibility = applyWaterRemovalMode(paras, scores, readMode);
      const visibleSet = new Set(
        visibility.filter((v) => v.visible).map((v) => v.id),
      );

      // 更新章节段落数据
      const updatedChapters = [...chapters];
      updatedChapters[chapterIndex] = {
        ...chapter,
        paragraphs: paras.map((para, idx) => ({
          ...para,
          score: scores.scores[idx],
          visible: visibleSet.has(para.id),
        })),
      };

      
      console.log("[debug] updatedChapters: ",updatedChapters)
      setChapters(updatedChapters);
      setParagraphs(updatedChapters[chapterIndex].paragraphs);
      setVisibleParagraphs(visibleSet);

      // 计算去水后的字数
      const keptWordCount = paras
        .filter((p) => visibleSet.has(p.id))
        .reduce((sum, p) => sum + p.text.length, 0);

      const removedWordCount = originalWordCount - keptWordCount;
      const removalRate = Math.round((removedWordCount / originalWordCount) * 100);

      // 更新统计信息
      setRemovalStats({
        originalParagraphs: paras.length,
        keptParagraphs: visibleSet.size,
        removedParagraphs: paras.length - visibleSet.size,
        originalWords: originalWordCount,
        keptWords: keptWordCount,
        removedWords: removedWordCount,
        removalRate,
      });

      toast.success(
        `✅ 处理完成！\n保留 ${visibleSet.size}/${paras.length} 段（${Math.round((visibleSet.size / paras.length) * 100)}%）\n字数：${keptWordCount}/${originalWordCount} 字（减少 ${removalRate}%）`,
        {
          autoClose: 5000,
        },
      );
    } catch (error) {
      toast.error(
        `处理失败: ${error instanceof Error ? error.message : "未知错误"}`,
      );
      console.error(error);
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  // 处理当前章节
  const handleProcess = async () => {
    if (chapters.length === 0) {
      toast.error("请先上传文件");
      return;
    }

    await processChapter(currentChapter);
  };

  // 初始化章节显示（不进行去水处理）
  const initializeChapterDisplay = async (chapterIndex: number) => {
    if (chapters.length === 0) return;

    const chapter = chapters[chapterIndex];
    if (!chapter) return;

    // 分割文本为段落
    const paragraphs = splitIntoParagraphs(chapter.content);

    // 标记所有段落为可见
    const paragraphsWithVisible = paragraphs.map((p) => ({
      ...p,
      visible: true,
    }));

    // 更新状态
    setParagraphs(paragraphsWithVisible);

    // 更新可见段落集合
    const visibleSet = new Set(paragraphs.map((p) => p.id));
    setVisibleParagraphs(visibleSet);
  };

  // 切换章节
  const handleChapterChange = async (index: number) => {
    setCurrentChapter(index);
    const chapter = chapters[index];

    // 重置统计信息
    setRemovalStats(null);

    if (chapter.paragraphs && chapter.paragraphs.length > 0) {
      // 章节已处理，显示已有数据
      setParagraphs(chapter.paragraphs);
      const visibleSet = new Set(
        chapter.paragraphs.filter((p: any) => p.visible).map((p: any) => p.id),
      );
      setVisibleParagraphs(visibleSet);

      // 计算统计信息
      const totalWords = chapter.paragraphs.reduce((sum: number, p: any) => sum + p.text.length, 0);
      const visibleParagraphsCount = visibleSet.size;
      const visibleWords = chapter.paragraphs
        .filter((p: any) => visibleSet.has(p.id))
        .reduce((sum: number, p: any) => sum + p.text.length, 0);

      setRemovalStats({
        originalParagraphs: chapter.paragraphs.length,
        keptParagraphs: visibleParagraphsCount,
        removedParagraphs: chapter.paragraphs.length - visibleParagraphsCount,
        originalWords: totalWords,
        keptWords: visibleWords,
        removedWords: totalWords - visibleWords,
        removalRate: Math.round(((totalWords - visibleWords) / totalWords) * 100),
      });
    } else {
      // 章节未处理，清空显示
      setParagraphs([]);
      setVisibleParagraphs(new Set());

      // 如果开启了自动去水，自动处理
      if (autoWaterRemoval && isInitialized) {
        await processChapter(index);
      } else {
        // 否则初始化章节显示（不进行去水）
        await initializeChapterDisplay(index);
      }
    }

    setSidebarOpen(false); // 关闭侧边栏
  };

  // 切换模式
  const handleModeChange = async (mode: "normal" | "original") => {
    setReadMode(mode);

    // 切换到原文模式时，显示所有段落
    if (mode === "original" && paragraphs.length > 0) {
      const allVisible = new Set(paragraphs.map((p) => p.id));
      setVisibleParagraphs(allVisible);
      // toast.info("已切换到原文模式，显示所有内容");
    } else if (mode === "normal") {
      // 切换到去水模式时
      if (paragraphs.length === 0) {
        // 章节未处理，初始化显示
        await initializeChapterDisplay(currentChapter);
        // toast.info("已切换到去水模式，点击'处理'开始去水");
      } else {
        // 章节已初始化，提示处理
        // toast.info('已切换到去水模式，请点击"处理"开始去水');
      }
    }
  };

  // 批量处理所有章节
  const handleBatchProcess = async () => {
    if (chapters.length === 0) {
      toast.warn("请先上传书籍文件");
      return;
    }

    if (!isInitialized) {
      toast.warn("模型正在加载中，请稍候...");
      return;
    }

    if (batchProcessing) {
      return;
    }

    setBatchProcessing(true);
    setBatchProgress({
      total: chapters.length,
      processed: 0,
      currentChapter: "",
    });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < chapters.length; i++) {
      // 检查是否暂停
      if (batchPaused) {
        await new Promise((resolve) => {
          const checkPaused = setInterval(() => {
            if (!batchPaused) {
              clearInterval(checkPaused);
              resolve(undefined);
            }
          }, 100);
        });
      }

      // 检查是否已处理
      if (!chapters[i].paragraphs || chapters[i].paragraphs.length === 0) {
        setBatchProgress({
          total: chapters.length,
          processed: i,
          currentChapter: chapters[i].title,
        });

        try {
          setCurrentChapter(i);
          await processChapter(i);
          successCount++;
        } catch (error) {
          console.error(`章节 ${i + 1} 处理失败:`, error);
          failCount++;
        }
      } else {
        successCount++;
      }

      setBatchProgress({
        total: chapters.length,
        processed: i + 1,
        currentChapter: chapters[i].title,
      });
    }

    setBatchProcessing(false);
    setBatchProgress({
      total: 0,
      processed: 0,
      currentChapter: "",
    });

    if (failCount === 0) {
      toast.success(`✅ 批量处理完成！共处理 ${successCount} 章`);
    } else {
      toast.warn(`⚠️ 批量处理完成！成功 ${successCount} 章，失败 ${failCount} 章`);
    }
  };

  // 导出去水结果
  const handleExport = () => {
    if (chapters.length === 0) {
      toast.warn("没有可导出的内容");
      return;
    }

    // 检查是否有已处理的章节
    const processedChapters = chapters.filter(
      (ch) => ch.paragraphs && ch.paragraphs.length > 0
    );

    if (processedChapters.length === 0) {
      toast.warn("请先处理章节后再导出");
      return;
    }

    let content = "";

    chapters.forEach((chapter, index) => {
      const paragraphs = chapter.paragraphs || [];

      // 只导出有段落数据的章节
      if (paragraphs.length === 0) return;

      // 只保留可见的段落
      const visibleParagraphs = paragraphs.filter((p: any) => p.visible);

      // 如果没有可见段落，跳过该章节
      if (visibleParagraphs.length === 0) return;

      // 章节标题
      content += `第${index + 1}章 ${chapter.title}\n`;
      content += "=".repeat(50) + "\n\n";

      // 段落内容（只导出可见段落）
      visibleParagraphs.forEach((para: any) => {
        content += `${para.text}\n\n`;
      });

      content += "-".repeat(50) + "\n\n";
    });

    // 生成文件名（使用书名或第一章节标题）
    const bookTitle =
      rawText.substring(0, rawText.indexOf("\n")) || "去水阅读";
    const fileName = `${bookTitle}_去水版.txt`;

    // 触发下载
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);

    toast.success("✅ 导出成功！");
  };

  return (
    <div className="water-removal-reader">
      <AppHeader
        title="去水阅读"
        icon="📖"
        onBack={onBack}
        style={{
          position:"fixed",
          width:"100%",
          top:"0px",
          left:"0px"

       }}
        actions={
          <>
            {chapters.length > 0 && (
              <>
                {/* 章节导航 */}
                <div className="chapter-nav-header">
                  <button
                    className="app-header-btn app-header-btn-secondary"
                    onClick={() =>
                      currentChapter > 0 &&
                      handleChapterChange(currentChapter - 1)
                    }
                    disabled={currentChapter === 0}
                    title="上一章"
                  >
                    ←
                  </button>
                  <span className="chapter-nav-current">
                    第{currentChapter + 1}章
                  </span>
                  <button
                    className="app-header-btn app-header-btn-secondary"
                    onClick={() =>
                      currentChapter < chapters.length - 1 &&
                      handleChapterChange(currentChapter + 1)
                    }
                    disabled={currentChapter === chapters.length - 1}
                    title="下一章"
                  >
                    →
                  </button>
                </div>

                {/* 分隔线 */}
                <div className="header-divider"></div>

                {/* 目录按钮 */}
                <button
                  className="app-header-btn app-header-btn-secondary"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  title="目录"
                >
                  📑目录({chapters.length})
                </button>

                {/* 处理按钮 */}
                {!isProcessing && (
                  <button
                    className="app-header-btn app-header-btn-primary"
                    onClick={handleProcess}
                    disabled={!isInitialized}
                    title="AI 去水处理"
                  >
                    🧠 处理
                  </button>
                )}

                {/* 模式切换 */}
                {paragraphs.length > 0 && (
                  <button
                    className={`app-header-btn app-header-btn-secondary`}
                    onClick={() => handleModeChange(readMode === "normal" ? "original" : "normal")}
                    title={readMode === "normal" ? "切换到原文模式" : "切换到去水模式"}
                  >
                    {readMode === "normal" ? "📖" : "📄"}
                  </button>
                )}

                {/* 设置按钮 */}
                <button
                  className={`app-header-btn ${settingsOpen ? "app-header-btn-primary" : "app-header-btn-secondary"}`}
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  title="高级设置"
                >
                  ⚙️
                </button>

                {/* 字数统计（紧凑显示） */}
                {removalStats && (
                  <div className="stats-compact">
                    <span className="stats-compact-value">
                      {removalStats.keptWords}
                    </span>
                    <span className="stats-compact-slash">/</span>
                    <span className="stats-compact-total">
                      {removalStats.originalWords}
                    </span>
                    <span className="stats-compact-unit">字</span>
                    <span className="stats-compact-reduction">
                      -{removalStats.removalRate}%
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        }
      />

      <div className="water-removal-content">
        {/* 上传区域 */}
        {chapters.length === 0 && !rawText && (
          <div className="upload-section">
            <div className="upload-notice">
              📖 <strong>支持 txt 格式小说，自动识别章节，本地处理</strong>
            </div>
            <div
              className="upload-area"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="upload-icon">📄</div>
              <div className="upload-text">点击上传 TXT 文件</div>
              <div className="upload-subtext">自动识别章节并分割</div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                accept=".txt,.epub"
                style={{ display: "none" }}
              />
            </div>
          </div>
        )}

        {/* 章节导航侧边栏 */}
        {sidebarOpen && (
          <div
            className="sidebar-overlay"
            onClick={() => setSidebarOpen(false)}
          >
            <div
              className="chapter-sidebar"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sidebar-header">
                <h3>📑 章节目录</h3>
                <button
                  className="sidebar-close"
                  onClick={() => setSidebarOpen(false)}
                >
                  ✕
                </button>
              </div>
              <div className="sidebar-content">
                {chapters.map((chapter, index) => {
                  const isProcessed =
                    chapter.paragraphs && chapter.paragraphs.length > 0;
                  return (
                    <div
                      key={chapter.id}
                      className={`chapter-item ${currentChapter === index ? "active" : ""} ${isProcessed ? "processed" : ""}`}
                      onClick={() => handleChapterChange(index)}
                    >
                      <span className="chapter-index">{index + 1}.</span>
                      <span className="chapter-title">{chapter.title}</span>
                      {isProcessed && <span className="chapter-status">✓</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 主内容区域 */}
        {chapters.length > 0 && (
          <div className="text-editor-section">
            {/* 章节标题 */}
            {/* <h2 className="chapter-title">{chapters[currentChapter].title}</h2> */}

            {/* 设置面板弹窗 */}
            {settingsOpen && (
              <div
                className="settings-modal-overlay"
                onClick={() => setSettingsOpen(false)}
              >
                <div
                  className="settings-modal"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="settings-modal-header">
                    <h3>⚙️ 高级设置</h3>
                    <button
                      className="settings-close-btn"
                      onClick={() => setSettingsOpen(false)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="settings-modal-body">

                    {/* 新手引导 */}
                    <div className="setting-item setting-item-full">
                      <div className="guide-section">
                        <div
                          className={`guide-title ${guideExpanded ? "expanded" : ""}`}
                          onClick={() => setGuideExpanded(!guideExpanded)}
                        >
                          <span className="guide-icon">💡</span>
                          <span>什么是"去水"阅读？</span>
                          <span className="guide-toggle">
                            {guideExpanded ? "▼" : "▶"}
                          </span>
                        </div>
                        {guideExpanded && (
                          <div className="guide-content">
                            <p className="guide-description">
                              AI 自动识别并折叠小说中的"水"内容，如：
                            </p>
                            <ul className="guide-list">
                              <li>重复的描述和对话</li>
                              <li>过长的环境描写</li>
                              <li>不必要的细节铺垫</li>
                              <li>水字数较多的章节</li>
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 阈值预设 */}
                    <div className="setting-item setting-item-full">
                      <label className="setting-label">
                        <span>去水强度预设</span>
                      </label>
                      <div className="threshold-presets">
                        <button
                          className={`preset-btn ${
                            keepThreshold >= 0.8 ? "active" : ""
                          }`}
                          onClick={() => {
                            setKeepThreshold(0.8);
                            setFoldThreshold(0.5);
                            toast.info("已切换为轻度去水");
                          }}
                        >
                          轻度
                        </button>
                        <button
                          className={`preset-btn ${
                            keepThreshold >= 0.6 && keepThreshold < 0.8 ? "active" : ""
                          }`}
                          onClick={() => {
                            setKeepThreshold(0.7);
                            setFoldThreshold(0.4);
                            toast.info("已切换为中度去水");
                          }}
                        >
                          中度
                        </button>
                        <button
                          className={`preset-btn ${
                            keepThreshold < 0.6 ? "active" : ""
                          }`}
                          onClick={() => {
                            setKeepThreshold(0.5);
                            setFoldThreshold(0.3);
                            toast.info("已切换为重度去水");
                          }}
                        >
                          重度
                        </button>
                      </div>
                    </div>

                    <div className="setting-item">
                      <label className="setting-label">
                        <input
                          type="checkbox"
                          checked={autoWaterRemoval}
                          onChange={(e) => setAutoWaterRemoval(e.target.checked)}
                        />
                        <span>自动去水（切换章节时自动处理）</span>
                      </label>
                    </div>
                    <div className="setting-item">
                      <label>
                        保留阈值: {keepThreshold.toFixed(1)}
                        <input
                          type="range"
                          min="0.1"
                          max="0.9"
                          step="0.1"
                          value={keepThreshold}
                          onChange={(e) =>
                            setKeepThreshold(parseFloat(e.target.value))
                          }
                        />
                      </label>
                    </div>
                    <div className="setting-item">
                      <label>
                        折叠阈值: {foldThreshold.toFixed(1)}
                        <input
                          type="range"
                          min="0.1"
                          max="0.7"
                          step="0.1"
                          value={foldThreshold}
                          onChange={(e) =>
                            setFoldThreshold(parseFloat(e.target.value))
                          }
                        />
                      </label>
                    </div>

                    {/* 批量处理和导出 */}
                    <div className="setting-item setting-item-full">
                      <div className="batch-actions">
                        <button
                          className="setting-btn setting-btn-primary"
                          onClick={handleBatchProcess}
                          disabled={batchProcessing || chapters.length === 0}
                        >
                          {batchProcessing ? "🔄 处理中..." : "📥 批量处理"}
                        </button>
                        <button
                          className="setting-btn setting-btn-secondary"
                          onClick={handleExport}
                          disabled={chapters.length === 0}
                        >
                          📤 导出结果
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 批量处理进度弹窗 */}
            {batchProcessing && (
              <div className="batch-progress-overlay">
                <div className="batch-progress-modal">
                  <div className="batch-progress-header">
                    <h3>📥 批量处理中...</h3>
                  </div>
                  <div className="batch-progress-body">
                    <div className="progress-bar-container">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${(batchProgress.processed / batchProgress.total) * 100}%`,
                          }}
                        />
                      </div>
                      <div className="progress-text">
                        {batchProgress.processed} / {batchProgress.total} 章
                        ({Math.round((batchProgress.processed / batchProgress.total) * 100)}%)
                      </div>
                    </div>

                    {batchProgress.currentChapter && (
                      <div className="current-chapter">
                        当前章节：{batchProgress.currentChapter}
                      </div>
                    )}

                    <div className="batch-progress-actions">
                      <button
                        className="progress-btn"
                        onClick={() => setBatchPaused(!batchPaused)}
                      >
                        {batchPaused ? "▶ 继续" : "⏸ 暂停"}
                      </button>
                      <button
                        className="progress-btn progress-btn-cancel"
                        onClick={() => {
                          if (window.confirm("确定要取消批量处理吗？")) {
                            setBatchProcessing(false);
                            setBatchPaused(false);
                            toast.info("已取消批量处理");
                          }
                        }}
                      >
                        ✕ 取消
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {paragraphs.length === 0 ? (
              <div className="empty-chapter-hint">
                <p>📖 正在加载章节内容...</p>
              </div>
            ) : (
              <div className="paragraphs-container">
                {paragraphs.map((para, index) => {
                  const isVisible = visibleParagraphs.has(para.id);

                  // 如果是第一个被折叠的段落，显示占位符
                  if (!isVisible && (index === 0 || visibleParagraphs.has(paragraphs[index - 1].id))) {
                    const foldedCount = countConsecutiveFolded(index);
                    const isExpanded = expandedPlaceholders.has(para.id);

                    return (
                      <div
                        key={`placeholder-${para.id}`}
                        className={`folded-placeholder ${isExpanded ? "expanded" : ""}`}
                        onClick={() => {
                          if (isExpanded) {
                            // 恢复折叠
                            setExpandedPlaceholders(
                              new Set([...expandedPlaceholders].filter(id => id !== para.id))
                            );
                            // toast.info(`已折叠 ${foldedCount} 段内容`);
                          } else {
                            // 展开这些段落（在占位符中显示原文）
                            setExpandedPlaceholders(new Set([...expandedPlaceholders, para.id]));
                            // toast.info(`已展开 ${foldedCount} 段内容`);
                          }
                        }}
                      >
                        {isExpanded ? (
                          <div className="placeholder-content">
                            <div className="placeholder-header">
                              <span className="placeholder-icon">🔽</span>
                              <span className="placeholder-text">
                                点击折叠
                              </span>
                            </div>
                            <div className="placeholder-texts">
                              {paragraphs.slice(index, index + foldedCount).map((p) => (
                                <p key={p.id} className="placeholder-paragraph">
                                  {p.text}
                                </p>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="placeholder-icon">•••</span>
                            <span className="placeholder-text">
                              已折叠 {foldedCount} 段
                            </span>
                          </>
                        )}
                      </div>
                    );
                  }

                  // 如果是被折叠的段落，跳过（不渲染）
                  if (!isVisible) {
                    return null;
                  }

                  // 显示可见段落
                  return (
                    <p
                      key={para.id}
                      className="paragraph visible"
                    >
                      {para.text}
                    </p>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 进度显示 */}
        {isProcessing && (
          <div className="processing-overlay">
            <div className="processing-content">
              <div className="spinner"></div>
              <h3>正在处理...</h3>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p>{progress}%</p>
            </div>
          </div>
        )}
      </div>

      <ToastContainer autoClose={2000} position="bottom-right" />
    </div>
  );
};

export default WaterRemovalReader;
