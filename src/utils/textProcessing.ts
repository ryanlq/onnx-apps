/**
 * 文本处理工具
 * 用于小说分段和预处理
 */

export interface Paragraph {
  id: number;
  text: string;
  startIndex: number;
  endIndex: number;
}

/**
 * 将小说文本分割成段落
 */
export function splitIntoParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // 按换行符分割（支持单换行符或双换行符）
  // 使用 + 匹配一个或多个换行符
  const rawParagraphs = text.split(/\n+/);

  let currentIndex = 0;

  for (let i = 0; i < rawParagraphs.length; i++) {
    const paraText = rawParagraphs[i].trim();

    // 跳过空段落
    if (paraText.length === 0) continue;

    const startIndex = currentIndex;
    const endIndex = currentIndex + paraText.length;

    paragraphs.push({
      id: i,
      text: paraText,
      startIndex,
      endIndex,
    });

    currentIndex = endIndex + 1; // +1 for \n
  }

  return paragraphs;
}

/**
 * 清理文本（移除多余空白）
 */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n") // 最多保留双换行
    .trim();
}

/**
 * 按章节分割
 * 识别常见的中文小说章节格式
 */
export function splitIntoChapters(
  text: string,
): { title: string; content: string; index: number }[] {
  const chapters: { title: string; content: string; index: number }[] = [];

  // 章节标题正则 - 匹配完整标题（包括副标题），直到换行符
  const chapterPatterns = [
    // 中文章节：第X章 标题内容
    /第[零一二三四五六七八九十百千万0-9]+章[\s\:：、．\.\-]*[^\n]*/g,
    // 中文章节：第X节 标题内容
    /第[零一二三四五六七八九十百千万0-9]+节[\s\:：、．\.\-]*[^\n]*/g,
    // 英文章节：Chapter X 标题内容
    /Chapter\s*[0-9]+[\s\:：、．\.\-]*[^\n]*/gi,
    // 卷：卷X 标题内容
    /卷[零一二三四五六七八九十百千万0-9]+[\s\:：、．\.\-]*[^\n]*/g,
    // 数字开头：X. 标题内容 或 X 标题内容
    /^[\s\u3000]*[0-9]+[\.\s\:：、\-]+[^\n]*/gm,
  ];

  // 收集所有章节位置
  const chapterMatches: Array<{ index: number; title: string }> = [];

  for (const pattern of chapterPatterns) {
    let match;
    // 重置正则的lastIndex
    pattern.lastIndex = 0;

    while ((match = pattern.exec(text)) !== null) {
      chapterMatches.push({
        index: match.index,
        title: match[0].trim(),
      });
    }
  }

  // 按位置排序
  chapterMatches.sort((a, b) => a.index - b.index);

  // 去重：如果同一个位置有多个匹配，保留最长的一个
  const uniqueMatches: Array<{ index: number; title: string }> = [];
  for (let i = 0; i < chapterMatches.length; i++) {
    const current = chapterMatches[i];
    const prev = uniqueMatches[uniqueMatches.length - 1];

    // 如果位置相同或非常接近（5个字符内），认为是同一个标题
    if (prev && Math.abs(current.index - prev.index) <= 5) {
      // 保留更长的标题
      if (current.title.length > prev.title.length) {
        uniqueMatches[uniqueMatches.length - 1] = current;
      }
    } else {
      uniqueMatches.push(current);
    }
  }

  // 如果没有找到章节，整个文本作为一章
  if (uniqueMatches.length === 0) {
    return [
      {
        title: "全文",
        content: text.trim(),
        index: 0,
      },
    ];
  }

  // 提取章节内容
  for (let i = 0; i < uniqueMatches.length; i++) {
    const current = uniqueMatches[i];
    const next = uniqueMatches[i + 1];

    const startIndex = current.index + current.title.length;
    const endIndex = next ? next.index : text.length;

    const content = text.slice(startIndex, endIndex).trim();

    // 过滤太短的章节
    if (content.length > 50) {
      chapters.push({
        title: current.title,
        content,
        index: i,
      });
    }
  }

  return chapters;
}

export interface Chapter {
  id: number;
  title: string;
  content: string;
  paragraphs: Paragraph[];
}
