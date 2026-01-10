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
  WATER_REMOVAL_PRESETS,
  WaterRemovalLevel,
} from "../adapters/waterRemoval";
import { parseEpub } from "../utils/epubParser";
import "./WaterRemovalReader.css";
import { ToastContainer, toast } from "react-toastify";
import {
  saveBookData as saveBookDataToIndexedDB,
  loadBookData as loadBookDataFromIndexedDB,
  deleteBookData as deleteBookDataFromIndexedDB,
  saveBatchProgress as saveBatchProgressToIndexedDB,
  loadBatchProgress as loadBatchProgressFromIndexedDB,
  deleteBatchProgress as deleteBatchProgressFromIndexedDB,
} from "../utils/indexedDBStorage";

interface WaterRemovalReaderProps {
  onBack: () => void;
}

const WaterRemovalReader: React.FC<WaterRemovalReaderProps> = ({ onBack }) => {
  // 文本和段落
  const [rawText, setRawText] = useState<string>("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<number>(0);
  const [paragraphs, setParagraphs] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string>(""); // ✅ 存储上传的文件名

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
  const [waterRemovalLevel, setWaterRemovalLevel] = useState<keyof typeof WaterRemovalLevel>('MEDIUM'); // 档位选择
  const [keepThreshold, setKeepThreshold] = useState(0.5);  // 降低默认值
  const [foldThreshold, setFoldThreshold] = useState(0.25); // 降低默认值
  const [autoWaterRemoval, setAutoWaterRemoval] = useState(true); // 自动去水开关，默认开启
  const [protectDialogue, setProtectDialogue] = useState(false); // 对话保护开关，默认关闭

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
  const autoProcessTriggeredRef = useRef(false);
  const modelInitToastShownRef = useRef(false); // 跟踪是否已经触发过自动处理
  const modelInitializingRef = useRef(false); // ✅ 跟踪模型是否正在初始化，避免重复初始化
  const batchCancelledRef = useRef(false); // 跟踪批量处理是否被取消
  const batchPausedRef = useRef(false); // 跟踪批量处理暂停状态（使用 ref 避免 stale closure）
  const chaptersRef = useRef<Chapter[]>([]); // ✅ 修复: 使用 ref 避免 processChapter 中的 stale closure

  // ✅ 同步 chaptersRef 与 chapters 状态
  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);

  // 初始化模型
  useEffect(() => {
    // ✅ 避免重复初始化：如果已经初始化或正在初始化，跳过
    if (isInitialized || modelInitializingRef.current) {
      return;
    }

    const init = async () => {
      // 标记正在初始化
      modelInitializingRef.current = true;

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
        // 只在第一次初始化时显示成功 toast
        if (!modelInitToastShownRef.current) {
          toast.success("✅ 模型加载完成");
          modelInitToastShownRef.current = true;
        }
      } catch (error) {
        toast.error(
          `模型加载失败: ${error instanceof Error ? error.message : "未知错误"}`,
        );
      } finally {
        // 标记初始化完成
        modelInitializingRef.current = false;
      }
    };

    init();
  }, [isInitialized]); // ✅ 只依赖 isInitialized，避免其他状态变化触发重复初始化

  // ✅ 模型加载完成后，如果开启了自动去水且有章节，自动处理第一章
  useEffect(() => {
    if (isInitialized && autoWaterRemoval && chapters.length > 0 && !autoProcessTriggeredRef.current) {
      autoProcessTriggeredRef.current = true;
      handleChapterChange(0);
    }
  }, [isInitialized, autoWaterRemoval, chapters.length]); // 只依赖这些值的变化

  // ✅ 检查是否有未完成的批量处理进度
  useEffect(() => {
    const checkBatchProgress = async () => {
      const savedProgress = await loadBatchProgressFromIndexedDB();
      if (savedProgress && savedProgress.processedCount > 0 && savedProgress.processedCount < savedProgress.totalChapters) {
        // 显示恢复进度的提示
        const restoreToast = toast.info(
          `📦 发现有未完成的批量处理进度：${savedProgress.processedCount}/${savedProgress.totalChapters} 章已处理\n点击按钮恢复`,
          {
            autoClose: false,
            closeButton: true,
            closeOnClick: false,
            draggable: false,
            onClick: () => {
              // 恢复进度
              setChapters(savedProgress.chapters);
              chaptersRef.current = savedProgress.chapters;
              toast.dismiss(restoreToast);
              toast.success(`✅ 已恢复 ${savedProgress.processedCount} 章的处理进度`);
            },
          }
        );

        // 30秒后自动关闭提示
        setTimeout(() => {
          toast.dismiss(restoreToast);
        }, 30000);
      }
    };

    checkBatchProgress();
  }, []); // 只在组件挂载时检查一次

  // ✅ 自动恢复上次打开的书籍数据
  useEffect(() => {
    // 只在模型初始化后才恢复书籍，避免状态冲突
    if (!isInitialized) return;

    const restoreBook = async () => {
      const savedBook = await loadBookDataFromIndexedDB();
      if (savedBook && chapters.length === 0) {
        // 只有当前没有加载书籍时才自动恢复
        console.log('[自动恢复] 正在恢复书籍：' + savedBook.bookTitle);

        // 恢复书籍数据
        setRawText(savedBook.rawText);
        setChapters(savedBook.chapters);
        setCurrentChapter(savedBook.currentChapter);
        setReadMode(savedBook.readMode);
        setWaterRemovalLevel(savedBook.waterRemovalLevel as any);
        setKeepThreshold(savedBook.keepThreshold);
        setFoldThreshold(savedBook.foldThreshold);
        setProtectDialogue(savedBook.protectDialogue);
        setFileName(savedBook.fileName); // ✅ 恢复文件名

        // 更新 ref
        chaptersRef.current = savedBook.chapters;

        // 恢复当前章节的显示
        if (savedBook.chapters.length > 0 && savedBook.chapters[savedBook.currentChapter]) {
          const currentChapterData = savedBook.chapters[savedBook.currentChapter];
          if (currentChapterData.paragraphs && currentChapterData.paragraphs.length > 0) {
            setParagraphs(currentChapterData.paragraphs);
            const visibleSet = new Set<number>(
              currentChapterData.paragraphs
                .filter((p: any) => p.visible)
                .map((p: any) => p.id as number)
            );
            setVisibleParagraphs(visibleSet);
          } else {
            // 如果当前章节没有处理过，初始化显示
            const paragraphs = splitIntoParagraphs(currentChapterData.content);
            const paragraphsWithVisible = paragraphs.map((p) => ({
              ...p,
              visible: true,
            }));
            setParagraphs(paragraphsWithVisible);
            setVisibleParagraphs(new Set<number>(paragraphs.map((p) => p.id)));
          }
        }

        // 显示成功提示
        const processedCount = savedBook.chapters.filter(ch => ch.paragraphs && ch.paragraphs.length > 0).length;
        toast.success(
          `✅ 已自动恢复：${savedBook.bookTitle}\n` +
          `📚 共 ${savedBook.chapters.length} 章，已处理 ${processedCount} 章\n` +
          `📍 当前位置：第 ${savedBook.currentChapter + 1} 章`,
          { autoClose: 5000 }
        );
      }
    };

    restoreBook();
  }, [isInitialized, chapters.length]); // 依赖模型初始化状态和当前章节数

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

    // ✅ 保存文件名（去除扩展名）
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
    setFileName(nameWithoutExt);

    setIsProcessing(true);
    setProgress(0);

    // ✅ 上传新文件时，清除旧的书籍数据
    if (chapters.length > 0) {
      await deleteBookDataFromIndexedDB();
      await deleteBatchProgressFromIndexedDB();
      console.log('[文件上传] 已清除旧的书籍数据');
    }

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

      // ✅ 修复4: 移除handleChapterChange，直接使用初始化显示逻辑
      // if (isInitialized && autoWaterRemoval) {
      //   setTimeout(() => {
      //     processChapter(0);
      //   }, 100);
      // }

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

        // ✅ 保存书籍数据到 IndexedDB
        setTimeout(async () => {
          const saved = await saveBookDataToIndexedDB({
            id: 'current',
            rawText: cleanedText,
            chapters: chaptersWithParagraphs,
            currentChapter: 0,
            timestamp: Date.now(),
            bookTitle: nameWithoutExt,
            fileName: nameWithoutExt,
            readMode,
            waterRemovalLevel,
            keepThreshold,
            foldThreshold,
            protectDialogue,
          });
          if (saved) {
            console.log('[文件上传] 书籍数据已自动保存');
          }
        }, 500);
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

  // 处理单个章节，返回是否成功、段落数量和更新后的章节
  const processChapter = async (chapterIndex: number, skipOverlay: boolean = false ): Promise<{ success: boolean, paragraphCount: number, updatedChapter?: Chapter }> => {
    // ✅ 修复: 使用 ref 而不是状态，避免批量处理时的 stale closure
    const currentChapters = chaptersRef.current;
    if (currentChapters.length === 0) return { success: false, paragraphCount: 0 };

    const chapter = currentChapters[chapterIndex];
    if (!chapter) return { success: false, paragraphCount: 0 };

    // 检查模型是否准备好
    if (!isInitialized) {
      toast.warn("⏳ 模型正在加载中，请稍候...", {
        autoClose: 3000,
      });
      return { success: false, paragraphCount: 0 };
    }
    
    if (!skipOverlay) {
      setIsProcessing(true);
    }

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
        protectDialogue, // 添加对话保护选项
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
      // ✅ 修复: 使用 currentChapters 而不是 chapters，确保批量处理时使用最新数据
      const updatedChapters = [...currentChapters];
      updatedChapters[chapterIndex] = {
        ...chapter,
        paragraphs: paras.map((para, idx) => ({
          ...para,
          score: scores.scores[idx],
          visible: visibleSet.has(para.id),
        })),
      };

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

      // ✅ 修复2: 批量处理时跳过toast
      // if (!skipToast) {
      //   toast.success(
      //     `✅ 处理完成！\n保留 ${visibleSet.size}/${paras.length} 段（${Math.round((visibleSet.size / paras.length) * 100)}%）\n字数：${keptWordCount}/${originalWordCount} 字（减少 ${removalRate}%）`,
      //     {
      //       autoClose: 5000,
      //     },
      //   );
      // }

      return { success: true, paragraphCount: visibleSet.size, updatedChapter: updatedChapters[chapterIndex] };
    } catch (error) {
      toast.error(
        `处理失败: ${error instanceof Error ? error.message : "未知错误"}`,
      );
      console.error(error);
      return { success: false, paragraphCount: 0 };
    } finally {
        if (!skipOverlay) {
          setIsProcessing(false);
        }
        setProgress(0);
    }
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

  // 重新处理当前章节（用于档位切换后）
  const reprocessCurrentChapter = async (newKeepThreshold: number, newFoldThreshold: number) => {
    if (currentChapter === null) return;

    setIsProcessing(true);
    setProgress(0);
    setRemovalStats(null);

    try {
      const chapter = chapters[currentChapter];
      if (!chapter || !chapter.content) return;

      // 1. 分段
      const paras = splitIntoParagraphs(chapter.content);

      // 2. 使用传入的新阈值配置重新评分（而非依赖状态）
      const config: WaterRemovalConfig = {
        keepThreshold: newKeepThreshold,
        foldThreshold: newFoldThreshold,
        windowSize: 5,
        minParagraphLength: 20,
        protectDialogue,
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
      updatedChapters[currentChapter] = {
        ...chapter,
        paragraphs: paras.map((para, idx) => ({
          ...para,
          score: scores.scores[idx],
          visible: visibleSet.has(para.id),
        })),
      };
      setChapters(updatedChapters);
      setParagraphs(updatedChapters[currentChapter].paragraphs);
      setVisibleParagraphs(visibleSet);

      // 计算去水后的字数
      const originalWordCount = paras.reduce((sum, p) => sum + p.text.length, 0);
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
        `✅ 档位应用完成！\n保留 ${visibleSet.size}/${paras.length} 段（${Math.round((visibleSet.size / paras.length) * 100)}%）\n字数：${keptWordCount}/${originalWordCount} 字（减少 ${removalRate}%）`,
        {
          autoClose: 5000,
        },
      );
    } catch (error) {
      toast.error(
        `重新处理失败: ${error instanceof Error ? error.message : "未知错误"}`,
      );
      console.error(error);
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  };

  // 切换章节
  const handleChapterChange = async (index: number) => {
    setCurrentChapter(index);
    const chapter = chapters[index];

    // 重置统计信息
    setRemovalStats(null);

    // ✅ 修复3：检查章节是否已处理（必须有去水评分数据）
    if(!chapter) return ;
    const hasProcessedData =
      chapter.paragraphs &&
      chapter.paragraphs.length > 0 &&
      chapter.paragraphs.some((p: any) => p.score !== undefined);

    if (hasProcessedData) {
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

      // ✅ 修复5: 首次显示时，如果自动去水开启且章节未处理，则自动去水
      if (autoWaterRemoval && isInitialized && !hasProcessedData) {
        await processChapter(index);
      } else {
        // 否则初始化章节显示（不进行去水）
        await initializeChapterDisplay(index);
      }
    }

    setSidebarOpen(false); // 关闭侧边栏

    // ✅ 切换章节时保存阅读位置
    await saveBookDataToIndexedDB({
      id: 'current',
      rawText,
      chapters,
      currentChapter: index,
      timestamp: Date.now(),
      bookTitle: fileName || rawText.split('\n')[0].substring(0, 50),
      fileName,
      readMode,
      waterRemovalLevel,
      keepThreshold,
      foldThreshold,
      protectDialogue,
    });
  };

  // 切换模式（暂时注释，因为UI中移除了模式切换按钮）
  // const handleModeChange = async (mode: "normal" | "original") => {
  //   setReadMode(mode);
  //
  //   // 切换到原文模式时，显示所有段落
  //   if (mode === "original" && paragraphs.length > 0) {
  //     const allVisible = new Set(paragraphs.map((p) => p.id));
  //     setVisibleParagraphs(allVisible);
  //     // toast.info("已切换到原文模式，显示所有内容");
  //   } else if (mode === "normal") {
  //     // 切换到去水模式时
  //     if (paragraphs.length === 0) {
  //       // 章节未处理，初始化显示
  //       await initializeChapterDisplay(currentChapter);
  //       // toast.info("已切换到去水模式，点击'处理'开始去水");
  //     } else {
  //       // 章节已初始化，提示处理
  //       // toast.info('已切换到去水模式，请点击"处理"开始去水');
  //     }
  //   }
  // };

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

    // 初始化取消标志
    batchCancelledRef.current = false;
    batchPausedRef.current = false;

    setBatchProcessing(true);
    setBatchPaused(false);
    setBatchProgress({
      total: chapters.length,
      processed: 0,
      currentChapter: "",
    });

    let successCount = 0;
    let failCount = 0;

    // 保存原始章节索引，避免批量处理时 UI 跳动
    const originalChapter = currentChapter;

    // ✅ 修复: 创建本地副本用于累积更新，避免异步状态更新导致的数据丢失
    const batchChapters = [...chaptersRef.current];

    // ✅ 分批处理配置：每批处理的章节数
    const BATCH_SIZE = 10; // 每批处理 10 章，可根据实际情况调整

    for (let i = 0; i < chapters.length; i++) {
      // ✅ 修复1: 检查是否取消
      if (batchCancelledRef.current) {
        toast.info("⚠️ 批量处理已取消");
        break;
      }

      // ✅ 修复2: 使用 ref 检查暂停，避免 stale closure
      while (batchPausedRef.current && !batchCancelledRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 再次检查取消（可能暂停期间被取消）
      if (batchCancelledRef.current) {
        toast.info("⚠️ 批量处理已取消");
        break;
      }

      // 检查是否已处理（使用本地副本 batchChapters）
      if (!batchChapters[i].paragraphs || batchChapters[i].paragraphs.length === 0) {
        setBatchProgress({
          total: chapters.length,
          processed: i,
          currentChapter: batchChapters[i].title,
        });

        console.log('[批量处理] 开始处理第 ' + (i+1) + ' 章: ' + batchChapters[i].title);

        // ✅ 修复: 使用返回的对象，包含 success, paragraphCount 和 updatedChapter
        const result = await processChapter(i, true);
        console.log('[批量处理] 第 ' + (i+1) + ' 章处理' + (result.success ? '成功' : '失败'));

        if (result.success) {
          successCount++;
          console.log('[批量处理] 第 ' + (i+1) + ' 章段落数据: ' + result.paragraphCount + ' 个');
          // ✅ 修复: 使用返回的 updatedChapter 更新本地副本
          if (result.updatedChapter) {
            batchChapters[i] = result.updatedChapter;
          }
        } else {
          failCount++;
          console.log('[批量处理] 第 ' + (i+1) + ' 章处理失败');
        }
      } else {
        successCount++;
      }

      setBatchProgress({
        total: chapters.length,
        processed: i + 1,
        currentChapter: batchChapters[i].title,
      });

      // ✅ 分批保存：每处理 BATCH_SIZE 章保存一次进度
      if ((i + 1) % BATCH_SIZE === 0 || i === chapters.length - 1) {
        // 更新状态和 ref
        setChapters([...batchChapters]);
        chaptersRef.current = [...batchChapters];

        // 保存到 IndexedDB
        await saveBatchProgressToIndexedDB(batchChapters);
        console.log('[分批保存] 已保存 ' + (i + 1) + '/' + chapters.length + ' 章的处理进度');

        // ✅ 同时保存书籍数据（包括处理结果）
        await saveBookDataToIndexedDB({
          id: 'current',
          rawText,
          chapters: [...batchChapters],
          currentChapter,
          timestamp: Date.now(),
          bookTitle: fileName || rawText.split('\n')[0].substring(0, 50),
          fileName,
          readMode,
          waterRemovalLevel,
          keepThreshold,
          foldThreshold,
          protectDialogue,
        });
      }
    }

    // ✅ 批量处理完成，一次性更新所有章节状态
    setChapters(batchChapters);
    chaptersRef.current = batchChapters;

    // 恢复原始章节
    setCurrentChapter(originalChapter);

    setBatchProcessing(false);
    setBatchPaused(false);
    setBatchProgress({
      total: 0,
      processed: 0,
      currentChapter: "",
    });

    // 批量处理结束，记录统计
    console.log('[批量处理结束] 共处理 ' + successCount + ' 章，失败 ' + failCount + ' 章');
    console.log('[批量处理结束] 各章节数据:');
    for (let j = 0; j < batchChapters.length; j++) {
      const ch = batchChapters[j];
      console.log('  ' + (j+1) + '. ' + ch.title + ', 段落数: ' + (ch.paragraphs ? ch.paragraphs.length : 0) + ' 个');
    }

    // ✅ 批量处理完成，清除 IndexedDB 中的进度
    if (!batchCancelledRef.current && failCount === 0) {
      await deleteBatchProgressFromIndexedDB();
      console.log('[批量处理完成] 已清除保存的进度');
      toast.success(`✅ 批量处理完成！共处理 ${successCount} 章`);
    } else if (!batchCancelledRef.current) {
      // 有失败的章节，保存当前进度
      await saveBatchProgressToIndexedDB(batchChapters);
      toast.warn(`⚠️ 批量处理完成！成功 ${successCount} 章，失败 ${failCount} 章\n进度已保存，可继续处理失败的章节`);
    } else {
      // 被取消，保存当前进度
      await saveBatchProgressToIndexedDB(batchChapters);
      toast.info(`⏸️ 批量处理已取消，已处理 ${successCount} 章的进度已保存`);
    }
  };

  // ✅ 清空书籍：清除所有书籍数据，回到初始上传状态
  const handleClearBook = async () => {
    // 确认对话框
    const confirmed = window.confirm(
      "开始新任务，会清空当前书籍书籍，请确保结果导出！\n\n这将：\n• 清除所有书籍数据\n• 清除所有处理进度\n• 清除 IndexedDB 缓存"
    );

    if (!confirmed) return;

    // 如果正在批量处理，不允许清空
    if (batchProcessing) {
      toast.warn("批量处理中，无法清空书籍");
      return;
    }

    try {
      // 清除 IndexedDB 中的所有数据
      await deleteBookDataFromIndexedDB();
      await deleteBatchProgressFromIndexedDB();
      console.log('[清空书籍] 已清除 IndexedDB 数据');

      // 清空所有状态
      setRawText("");
      setChapters([]);
      chaptersRef.current = [];
      setCurrentChapter(0);
      setFileName("");
      setParagraphs([]);
      setVisibleParagraphs(new Set());
      setRemovalStats(null);

      // 重置自动处理触发器
      autoProcessTriggeredRef.current = false;

      toast.success(
        "✅ 已清空所有数据！\n可以上传新书籍了",
        { autoClose: 3000 }
      );
    } catch (error) {
      console.error("[清空书籍] 失败:", error);
      toast.error("清空书籍失败，请重试");
    }
  };

  // 导出去水结果
  const handleExport = () => {
    console.log('[导出开始] ==========');
    console.log('[导出] 当前模式: ' + readMode);
    console.log('[导出] 总章节数: ' + chapters.length);

    const processedChapters = chapters.filter(
      (ch) => ch.paragraphs && ch.paragraphs.length > 0
    );

    console.log('[导出] 已处理的章节数: ' + processedChapters.length);
    console.log('[导出] 已处理的章节列表:');
    processedChapters.forEach((ch, idx) => {
      console.log('  ' + (idx+1) + '. ' + ch.title + ' (段落数: ' + ch.paragraphs.length + ')');
    });
    if (chapters.length === 0) {
      toast.warn("没有可导出的内容");
      return;
    }

    if (processedChapters.length === 0) {
      toast.warn("请先处理章节后再导出");
      return;
    }

    let content = "";
    let exportedChapterCount = 0;

    console.log('[导出遍历] 开始遍历所有章节...');
    chapters.forEach((chapter, index) => {
      const paragraphs = chapter.paragraphs || [];
      console.log('[导出遍历] 第 ' + (index+1) + ' 章: ' + chapter.title + ', 段落总数: ' + paragraphs.length);

      // 只导出有段落数据的章节
      if (paragraphs.length === 0) {
        console.log('[导出遍历] 第 ' + (index+1) + ' 章: 无段落数据，跳过');
        return;
      }

      // 只保留可见的段落
      const visibleParagraphs = paragraphs.filter((p: any) => p.visible);
      console.log('[导出遍历] 第 ' + (index+1) + ' 章: 可见段落 ' + visibleParagraphs.length + ' 个');

      // 如果没有可见段落，跳过该章节
      if (visibleParagraphs.length === 0) {
        console.log('[导出遍历] 第 ' + (index+1) + ' 章: 无可见段落，跳过');
        return;
      }

      exportedChapterCount++;
      console.log('[导出遍历] 第 ' + (index+1) + ' 章: 开始添加到导出内容');

      // ✅ 章节标题（直接使用原章节名）
      content += `${chapter.title}\n\n`;

      // 段落内容（只导出可见段落）
      visibleParagraphs.forEach((para: any) => {
        content += `${para.text}\n\n`;
      });

      // ✅ 章节之间用两个换行符分隔
      content += "\n";
      console.log('[导出遍历] 第 ' + (index+1) + ' 章: 已添加，当前内容长度: ' + content.length);
    });

    console.log('[导出完成] 共导出 ' + exportedChapterCount + ' 章，内容总长度: ' + content.length);

    // ✅ 生成文件名（使用上传的文件名）
    const exportFileName = fileName ? `${fileName}_去水版.txt` : "去水阅读_去水版.txt";

    // 触发下载
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName; // ✅ 使用修改后的文件名
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

                {/* ✅ 修复1: 批量处理和导出按钮 */}
                <button
                  className="app-header-btn app-header-btn-secondary"
                  onClick={handleBatchProcess}
                  disabled={batchProcessing || chapters.length === 0}
                  title="批量处理所有章节"
                  style={{ marginLeft: '8px' }}
                >
                  {batchProcessing ? "🔄 处理中..." : "📥 批量处理"}
                </button>

                <button
                  className="app-header-btn app-header-btn-secondary"
                  onClick={handleExport}
                  disabled={chapters.length === 0}
                  title="导出去水后的文本"
                  style={{ marginLeft: '4px' }}
                >
                  📤 导出
                </button>

                {/* 目录按钮 */}
                <button
                  className="app-header-btn app-header-btn-secondary"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  title="目录"
                >
                  📑目录({chapters.length})
                </button>

                {/* ✅ 修复2: 移除冗余的"处理"按钮 (自动去水是核心功能) */}
                {/* {!isProcessing && (
                  <button
                    className="app-header-btn app-header-btn-primary"
                    onClick={handleProcess}
                    disabled={!isInitialized}
                    title="AI 去水处理"
                  >
                    🧠 处理
                  </button>
                )} */}

                {/* 模式切换 */}
                {/* {paragraphs.length > 0 && (
                  <button
                    className={`app-header-btn app-header-btn-secondary`}
                    onClick={() => handleModeChange(readMode === "normal" ? "original" : "normal")}
                    title={readMode === "normal" ? "切换到原文模式" : "切换到去水模式"}
                  >
                    {readMode === "normal" ? "📖" : "📄"}
                  </button>
                )} */}
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
                
                <button
                  className="setting-btn setting-btn-warning"
                  onClick={handleClearBook}
                  disabled={chapters.length === 0 || batchProcessing}
                >
                    🗑️ 新任务
                </button>
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

                    {/* 去水强度档位选择 */}
                    <div className="setting-item setting-item-full">
                      <label className="setting-label">
                        <span>去水强度档位</span>
                      </label>
                      <div className="level-selector">
                        <button
                          className={`level-btn ${waterRemovalLevel === 'LIGHT' ? 'active' : ''}`}
                          onClick={async () => {
                            // ✅ 修复：使用正确的key访问preset（bracket notation）
                            const preset = WATER_REMOVAL_PRESETS[WaterRemovalLevel.LIGHT];
                            setWaterRemovalLevel('LIGHT');
                            setKeepThreshold(preset.keepThreshold);
                            setFoldThreshold(preset.foldThreshold);
                            toast.info('已切换为轻度去水');

                            // ✅ 关键修复：传递新阈值参数给重新处理函数
                            if (currentChapter !== null && chapters[currentChapter]?.paragraphs?.length > 0) {
                              await reprocessCurrentChapter(preset.keepThreshold, preset.foldThreshold);
                            }
                          }}
                        >
                          🍃 轻度
                          <span className="level-desc">保守模式</span>
                        </button>
                        <button
                          className={`level-btn ${waterRemovalLevel === 'MEDIUM' ? 'active' : ''}`}
                          onClick={async () => {
                            // ✅ 修复：使用正确的key访问preset（bracket notation）
                            const preset = WATER_REMOVAL_PRESETS[WaterRemovalLevel.MEDIUM];
                            setWaterRemovalLevel('MEDIUM');
                            setKeepThreshold(preset.keepThreshold);
                            setFoldThreshold(preset.foldThreshold);
                            toast.info('已切换为中度去水');

                            // ✅ 关键修复：传递新阈值参数给重新处理函数
                            if (currentChapter !== null && chapters[currentChapter]?.paragraphs?.length > 0) {
                              await reprocessCurrentChapter(preset.keepThreshold, preset.foldThreshold);
                            }
                          }}
                        >
                          ⚖️ 中度
                          <span className="level-desc">平衡模式</span>
                        </button>
                        <button
                          className={`level-btn ${waterRemovalLevel === 'HEAVY' ? 'active' : ''}`}
                          onClick={async () => {
                            // ✅ 修复：使用正确的key访问preset（bracket notation）
                            const preset = WATER_REMOVAL_PRESETS[WaterRemovalLevel.HEAVY];
                            setWaterRemovalLevel('HEAVY');
                            setKeepThreshold(preset.keepThreshold);
                            setFoldThreshold(preset.foldThreshold);
                            toast.info('已切换为重度去水');

                            // ✅ 关键修复：传递新阈值参数给重新处理函数
                            if (currentChapter !== null && chapters[currentChapter]?.paragraphs?.length > 0) {
                              await reprocessCurrentChapter(preset.keepThreshold, preset.foldThreshold);
                            }
                          }}
                        >
                          🔥 重度
                          <span className="level-desc">激进模式</span>
                        </button>
                        <button
                          className={`level-btn ${waterRemovalLevel === 'EXTREME' ? 'active' : ''}`}
                          onClick={async () => {
                            // ✅ 修复：使用正确的key访问preset（bracket notation）
                            const preset = WATER_REMOVAL_PRESETS[WaterRemovalLevel.EXTREME];
                            setWaterRemovalLevel('EXTREME');
                            setKeepThreshold(preset.keepThreshold);
                            setFoldThreshold(preset.foldThreshold);
                            toast.info('已切换为极限去水');

                            // ✅ 关键修复：传递新阈值参数给重新处理函数
                            if (currentChapter !== null && chapters[currentChapter]?.paragraphs?.length > 0) {
                              await reprocessCurrentChapter(preset.keepThreshold, preset.foldThreshold);
                            }
                          }}
                        >
                          💥 极限
                          <span className="level-desc">最大压缩</span>
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
                      <label className="setting-label">
                        <input
                          type="checkbox"
                          checked={protectDialogue}
                          onChange={(e) => setProtectDialogue(e.target.checked)}
                        />
                        <span>保护对话段落（保留对话内容）</span>
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

                    {/* ✅ 清空书籍按钮 */}
                    <div className="setting-item setting-item-full">
                      <button
                        className="setting-btn setting-btn-warning"
                        onClick={handleClearBook}
                        disabled={chapters.length === 0 || batchProcessing}
                        style={{ width: '100%', padding: '12px' }}
                      >
                        🗑️ 新任务
                      </button>
                      <p className="setting-hint">
                        清除所有书籍数据和缓存，回到初始上传状态
                      </p>
                    </div>

                    {/* ✅ 修复1: 批量处理和导出按钮已移到主界面AppHeader */}
                    {/* <div className="setting-item setting-item-full">
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
                    </div> */}
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
                        onClick={() => {
                          const newPausedState = !batchPaused;
                          batchPausedRef.current = newPausedState;
                          setBatchPaused(newPausedState);
                        }}
                      >
                        {batchPaused ? "▶ 继续" : "⏸ 暂停"}
                      </button>
                      <button
                        className="progress-btn progress-btn-cancel"
                        onClick={() => {
                          if (window.confirm("确定要取消批量处理吗？")) {
                            batchCancelledRef.current = true;  // ✅ 设置取消标志
                            batchPausedRef.current = false;
                            setBatchProcessing(false);
                            setBatchPaused(false);
                            toast.info("正在取消批量处理...");
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

      <ToastContainer autoClose={5000} position="bottom-right" limit={3} newestOnTop={true} />
    </div>
  );
};

export default WaterRemovalReader;
