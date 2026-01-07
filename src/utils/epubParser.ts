/**
 * EPUB 文件解析工具
 */

import ePub from "epubjs";

export interface EpubChapter {
  id: string;
  title: string;
  content: string;
}

/**
 * 从 HTML 内容中提取纯文本
 */
function extractTextFromHTML(html: string): string {
  // 预处理：将段落标签替换为换行符
  let processedHtml = html;

  // 替换块级元素标签为换行符
  const blockTags = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "li", "td", "tr", "section", "article"];
  blockTags.forEach(tag => {
    // 闭合标签：`<tag>content</tag>` -> `\ncontent\n`
    const regexStart = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "gi");
    const regexEnd = new RegExp(`</${tag}>`, "gi");
    processedHtml = processedHtml.replace(regexStart, "\n");
    processedHtml = processedHtml.replace(regexEnd, "\n");

    // 自闭合标签：`<br />` -> `\n`
    if (tag === "br" || tag === "hr") {
      const regexSelfClosing = new RegExp(`<${tag}\\s*/>`, "gi");
      processedHtml = processedHtml.replace(regexSelfClosing, "\n");
    }
  });

  // 创建临时 DOM 元素来解析 HTML
  const div = document.createElement("div");
  div.innerHTML = processedHtml;

  // 移除 script 和 style 标签
  const scripts = div.querySelectorAll("script, style, noscript");
  scripts.forEach((el) => el.remove());

  // 获取文本内容
  let text = div.textContent || div.innerText || "";

  // 清理空白字符
  text = text.replace(/[ \t]+/g, " "); // 只压缩空格和制表符
  text = text.replace(/\n\s*\n\s*\n+/g, "\n\n"); // 最多保留双换行
  text = text.replace(/^\n+/, ""); // 移除开头的换行
  text = text.replace(/\n+$/, ""); // 移除结尾的换行

  // 移除首尾空白
  text = text.trim();

  return text;
}

/**
 * 删除章节内容开头的标题行
 */
function removeLeadingTitle(content: string, title: string): string {
  if (!content || !title) return content;

  // 按段落分割
  const paragraphs = content.split(/\n\s*\n/);

  if (paragraphs.length === 0) return content;

  // 检查第一段是否包含标题
  const firstParagraph = paragraphs[0].trim();
  const titleToMatch = title.trim();

  // 判断第一段是否是标题的几种情况：
  // 1. 完全匹配
  // 2. 包含标题（考虑标点差异）
  // 3. 章节编号匹配（如 "第一章" vs "第 1 章"）

  let isTitle = false;

  // 完全匹配
  if (firstParagraph === titleToMatch) {
    isTitle = true;
  }
  // 包含匹配（去除空格和标点后比较）
  else {
    const cleanPara = firstParagraph
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9第章回]/g, "")
      .replace(/\s+/g, "");
    const cleanTitle = titleToMatch
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9第章回]/g, "")
      .replace(/\s+/g, "");

    if (cleanPara === cleanTitle || cleanPara.startsWith(cleanTitle)) {
      isTitle = true;
    }
  }

  // 如果是标题，删除第一段
  if (isTitle) {
    return paragraphs.slice(1).join("\n\n");
  }

  return content;
}

/**
 * 解析 EPUB 文件
 */
export async function parseEpub(file: File): Promise<EpubChapter[]> {
  return new Promise((resolve, reject) => {
    const book = ePub();
    const chapters: EpubChapter[] = [];

    // 使用 FileReader 读取文件
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;

        if (!arrayBuffer) {
          reject(new Error("Failed to read file"));
          return;
        }

        // 打开电子书
        await book.open(arrayBuffer);

        // 等待所有资源加载
        await book.ready;

        // 获取目录
        await book.loaded.navigation;
        const toc = book.navigation.toc;

        console.log("EPUB TOC length:", toc.length);
        console.log("EPUB TOC sample:", toc.slice(0, 3));

        // 遍历目录获取章节内容
        for (let i = 0; i < toc.length; i++) {
          try {
            const item = toc[i];
            if (!item.href) continue;

            console.log(
              `Processing chapter ${i}: ${item.label || "Untitled"} (${item.href})`,
            );

            let textContent = "";
            let success = false;

            // 方法 1: 使用 section.render() 获取 HTML 字符串
            try {
              console.log(`Trying method 1 (section.render)...`);
              const section = book.section(item.href);
              if (section) {
                const htmlContent = await section.render(book.load.bind(book));
                console.log(`Method 1 result type: ${typeof htmlContent}, length: ${htmlContent?.length || 0}`);
                console.log(`Method 1 result preview: ${htmlContent?.substring(0, 200)}...`);

                if (htmlContent && htmlContent.length > 20) {
                  textContent = extractTextFromHTML(htmlContent);
                  console.log(`Method 1 extracted text length: ${textContent.length}`);
                  if (textContent.length > 20) {
                    success = true;
                  }
                }
              }
            } catch (renderError) {
              console.warn(`Method 1 failed:`, renderError);
            }

            // 方法 2: 使用 section.load() 获取 Document 对象
            if (!success) {
              try {
                console.log(`Trying method 2 (section.load)...`);
                const section = book.section(item.href);
                if (section) {
                  const doc = await section.load(book.load.bind(book));
                  console.log(`Method 2 result type: ${doc?.constructor.name}`);
                  if (doc && doc.documentElement) {
                    const htmlContent = doc.documentElement.outerHTML || doc.body?.innerHTML || "";
                    textContent = extractTextFromHTML(htmlContent);
                    console.log(`Method 2 extracted text length: ${textContent.length}`);
                    if (textContent.length > 20) {
                      success = true;
                    }
                  }
                }
              } catch (loadError) {
                console.warn(`Method 2 failed:`, loadError);
              }
            }

            // 方法 3: 使用 book.request() 加载文档
            if (!success) {
              try {
                console.log(`Trying method 3 (book.request)...`);
                const doc = await book.request(item.href, "document");
                console.log(`Method 3 result type: ${doc?.constructor.name}`);
                const htmlContent =
                  doc?.body?.innerHTML || doc?.documentElement?.outerHTML || "";
                textContent = extractTextFromHTML(htmlContent);
                console.log(`Method 3 extracted text length: ${textContent.length}`);
                if (textContent.length > 20) {
                  success = true;
                }
              } catch (requestError) {
                console.warn(`Method 3 failed:`, requestError);
              }
            }

            console.log(
              `Chapter ${i} final text length: ${textContent.length}, success: ${success}`,
            );

            // 删除章节内容开头的标题行
            const cleanedContent = removeLeadingTitle(
              textContent,
              item.label || `未命名章节 ${i + 1}`,
            );

            // 降低最小长度要求（从 50 降到 20），因为有些章节可能较短
            if (cleanedContent.length > 20) {
              chapters.push({
                id: item.href,
                title: item.label || `未命名章节 ${i + 1}`,
                content: cleanedContent.trim(),
              });
            }
          } catch (error) {
            console.warn(`Error processing chapter ${i}:`, error);
          }
        }

        console.log(`Parsed ${chapters.length} chapters from EPUB`);

        // 清理资源
        try {
          book.destroy();
        } catch (e) {
          // ignore destroy errors
        }

        resolve(chapters);
      } catch (error) {
        console.error("EPUB parsing error:", error);
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read file"));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * 从 EPUB 提取纯文本
 */
export async function epubToText(file: File): Promise<string> {
  const chapters = await parseEpub(file);
  return chapters
    .map((ch) => ch.title + "\n\n" + ch.content)
    .join("\n\n---\n\n");
}
