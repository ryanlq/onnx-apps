/**
 * 去水算法核心逻辑
 *
 * 基于 embedding 的信息密度检测
 */

import {
  generateEmbedding,
  cosineSimilarity,
} from "../adapters/bge-embedding-adapter";
import type { Paragraph } from "../utils/textProcessing";

export interface ParagraphScore {
  id: number;
  score: number; // 0-1，越高越重要
  category: "keep" | "fold" | "skip";
  reason: string;
}

export interface WaterRemovalConfig {
  keepThreshold: number; // 保留阈值
  foldThreshold: number; // 折叠阈值
  windowSize: number; // 滑动窗口大小
  minParagraphLength: number; // 最小段落长度
  protectDialogue: boolean; // 是否保护对话段落
}

export const DEFAULT_CONFIG: WaterRemovalConfig = {
  keepThreshold: 0.5,    // 降低保留阈值（更激进的去水）
  foldThreshold: 0.25,   // 降低折叠阈值
  windowSize: 5,
  minParagraphLength: 20,
  protectDialogue: false, // 默认不保护对话
};

/**
 * 去水档位预设
 */
export const WaterRemovalLevel = {
  LIGHT: 'light',      // 轻度去水：保守模式
  MEDIUM: 'medium',    // 中度去水：平衡模式
  HEAVY: 'heavy',      // 重度去水：激进模式
  EXTREME: 'extreme',  // 极限去水：最大压缩
} as const;

export type WaterRemovalLevel = keyof typeof WaterRemovalLevel;

export const WATER_REMOVAL_PRESETS: Record<string, WaterRemovalConfig> = {
  [WaterRemovalLevel.LIGHT]: {
    keepThreshold: 0.75,
    foldThreshold: 0.5,
    windowSize: 5,
    minParagraphLength: 20,
    protectDialogue: false,
  },
  [WaterRemovalLevel.MEDIUM]: {
    keepThreshold: 0.5,
    foldThreshold: 0.25,
    windowSize: 5,
    minParagraphLength: 20,
    protectDialogue: false,
  },
  [WaterRemovalLevel.HEAVY]: {
    keepThreshold: 0.35,
    foldThreshold: 0.15,
    windowSize: 5,
    minParagraphLength: 20,
    protectDialogue: false,
  },
  [WaterRemovalLevel.EXTREME]: {
    keepThreshold: 0.25,
    foldThreshold: 0.08,
    windowSize: 5,
    minParagraphLength: 20,
    protectDialogue: false,
  },
};

/**
 * 检测是否为模板化段落
 * 如："众人震惊"、"倒吸一口凉气"
 */
function isTemplateParagraph(text: string): boolean {
  const templatePatterns = [
    /众.{0,5}震惊/,
    /倒吸.{0,3}凉气/,
    /不约而同/,
    /面面相觑/,
    /哑然失笑/,
    /心知肚明/,
  ];

  return templatePatterns.some((pattern) => pattern.test(text));
}

/**
 * 检测是否为对话段落（需要保护）
 */
function isDialogueParagraph(text: string): boolean {
  // 检测直接引语
  if (text.includes('"') || text.includes('"') || text.includes('"')) {
    return true;
  }

  // 检测对话标记
  const dialogueMarkers = ['说道', '道：', '道 "', '说 "', '道：'];
  if (dialogueMarkers.some(marker => text.includes(marker))) {
    return true;
  }

  // 检测问号和感叹号（对话常见）
  const questionCount = (text.match(/\?/g) || []).length;
  const exclamationCount = (text.match(/！/g) || []).length;
  if (questionCount >= 2 || exclamationCount >= 2) {
    return true;
  }

  return false;
}

/**
 * 检测段落长度（过短可能是水）
 */
function checkParagraphLength(text: string, minLength: number): number {
  if (text.length < minLength) return 0.3;
  if (text.length < minLength * 2) return 0.6;
  return 1.0;
}

/**
 * 主算法：为每个段落打分
 */
export async function scoreParagraphs(
  paragraphs: Paragraph[],
  config: WaterRemovalConfig = DEFAULT_CONFIG,
  onProgress?: (current: number, total: number) => void,
): Promise<ScoringResult> {
  if (paragraphs.length === 0) return { scores: [], embeddings: [] };

  const scores: ParagraphScore[] = [];
  const embeddings: Float32Array[] = [];
  const novelties: number[] = [];

  // 第一遍：计算所有段落的 novelty 和 embedding
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];

    // 生成 embedding（只生成一次）
    const embedding = await generateEmbedding(para.text);
    embeddings.push(embedding);

    // 计算信息增量
    let novelty: number;

    if (i === 0) {
      // 第一个段落给予中等分数，而非满分
      novelty = 0.5;
    } else {
      // 使用滑动窗口：只与前N个段落比较
      const windowStart = Math.max(
        0,
        embeddings.length - 1 - config.windowSize,
      );
      const windowEmbeddings = embeddings.slice(
        windowStart,
        embeddings.length - 1,
      );

      // 计算与窗口内段落的最大相似度
      let maxSimilarity = 0;
      for (const prevEmbedding of windowEmbeddings) {
        const similarity = cosineSimilarity(embedding, prevEmbedding);
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }

      // 信息增量 = 1 - 最大相似度
      novelty = 1 - maxSimilarity;
    }

    novelties.push(novelty);

    if (onProgress) {
      onProgress(i + 1, paragraphs.length);
    }
  }

  // ========== 修复: 基于分位数的动态阈值系统 ==========
  // 步骤1: 计算所有段落的原始分数
  const rawScores: number[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const rawNovelty = novelties[i];
    const embedding = embeddings[i];

    // 检测模板化
    const isTemplate = isTemplateParagraph(para.text);

    // 检查长度
    const lengthScore = checkParagraphLength(
      para.text,
      config.minParagraphLength,
    );

    // ========== LocalRepeatPenalty（局部重复惩罚）==========
    const localSim1 =
      i > 0 ? cosineSimilarity(embedding, embeddings[i - 1]) : 0;
    const localSim2 =
      i > 1 ? cosineSimilarity(embedding, embeddings[i - 2]) : 0;
    const localRepeat = (localSim1 + localSim2) / 2;

    // ========== 全局冗余惩罚 ==========
    let similarCount = 0;
    for (let j = 0; j < embeddings.length; j++) {
      if (i !== j && cosineSimilarity(embedding, embeddings[j]) > 0.85) {
        similarCount++;
      }
    }
    const redundancyPenalty = Math.min(similarCount / embeddings.length, 0.5);

    // ========== 惩罚机制 ==========
    const penalties = [
      localRepeat * 0.3,
      redundancyPenalty,
      isTemplate ? 0.5 : 0
    ];
    const maxPenalty = Math.max(...penalties);

    // 综合评分
    let score = rawNovelty * 0.6 + lengthScore * 0.4;
    score *= 1 - maxPenalty;

    rawScores.push(score);
  }

  // ========== 步骤2: 根据分数分布计算动态阈值 ==========
  // 对分数进行排序,计算分位数
  const sortedScores = [...rawScores].sort((a, b) => a - b);

  // 根据配置的keepThreshold计算实际分位数
  // keepThreshold: 0.75 → 保留前75%的段落(高分)
  // keepThreshold: 0.50 → 保留前50%的段落
  // keepThreshold: 0.35 → 保留前35%的段落
  // keepThreshold: 0.25 → 保留前25%的段落
  const percentile = 1 - config.keepThreshold; // 0.75 → 0.25分位数
  const index = Math.floor(sortedScores.length * percentile);
  const dynamicThreshold = sortedScores[Math.max(0, index)];

  // 步骤3: 使用动态阈值进行分类
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const score = rawScores[i];

    // 对话保护机制（可选）
    let finalScore = score;
    if (config.protectDialogue && isDialogueParagraph(para.text)) {
      finalScore = Math.max(score, dynamicThreshold + 0.1);
    }

    // ========== 步骤4: 使用动态阈值进行分类 ==========
    let category: "keep" | "fold" | "skip";
    let reason: string;

    // 使用动态阈值而非固定阈值
    const foldThreshold = dynamicThreshold * 0.6; // fold阈值 = keep阈值的60%

    if (finalScore >= dynamicThreshold) {
      category = "keep";
      reason = `高信息增量 (score: ${finalScore.toFixed(2)}, 动态阈值: ${dynamicThreshold.toFixed(2)})`;
    } else if (finalScore >= foldThreshold) {
      category = "fold";
      reason = `中等信息量 (score: ${finalScore.toFixed(2)})`;
    } else {
      category = "fold";
      reason = `低信息增量 (score: ${finalScore.toFixed(2)})`;
    }

    scores.push({
      id: para.id,
      score: finalScore,
      category,
      reason,
    });
  }

  return { scores, embeddings };
}

/**
 * 应用去水模式
 */
export function applyWaterRemovalMode(
  paragraphs: Paragraph[],
  scoringResult: ScoringResult,
  mode: "normal" | "original",
): { id: number; visible: boolean }[] {
  const result: { id: number; visible: boolean }[] = [];

  // original 模式：全部显示
  if (mode === "original") {
    for (const para of paragraphs) {
      result.push({
        id: para.id,
        visible: true,
      });
    }
    return result;
  }

  // normal 模式：去水模式 - 保留高评分段落
  for (const score of scoringResult.scores) {
    // 使用 category 决定可见性
    const visible = score.category === "keep";

    result.push({
      id: score.id,
      visible,
    });
  }

  return result;
}

export interface ScoringResult {
  scores: ParagraphScore[];
  embeddings: Float32Array[];
}
