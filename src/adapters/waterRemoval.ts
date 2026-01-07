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
}

export const DEFAULT_CONFIG: WaterRemovalConfig = {
  keepThreshold: 0.7,
  foldThreshold: 0.4,
  windowSize: 5,
  minParagraphLength: 20,
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

  // 第二遍：归一化评分并分类
  const maxNovelty = Math.max(...novelties);
  const minNovelty = Math.min(...novelties);
  const range = maxNovelty - minNovelty || 1; // 防止除零

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const rawNovelty = novelties[i];
    const embedding = embeddings[i];

    // 归一化到 0-1
    const normalizedNovelty = (rawNovelty - minNovelty) / range;

    // 检测模板化
    const isTemplate = isTemplateParagraph(para.text);

    // 检查长度
    const lengthScore = checkParagraphLength(
      para.text,
      config.minParagraphLength,
    );

    // ========== 修改1: LocalRepeatPenalty（局部重复惩罚）==========
    // 检测与前1-2段的相似度（连续水）
    const localSim1 =
      i > 0 ? cosineSimilarity(embedding, embeddings[i - 1]) : 0;
    const localSim2 =
      i > 1 ? cosineSimilarity(embedding, embeddings[i - 2]) : 0;
    const localRepeat = (localSim1 + localSim2) / 2;

    // ========== 修改2: 全局冗余惩罚 ==========
    // 统计与该段落相似的其他段落数量（重复内容）
    let similarCount = 0;
    for (let j = 0; j < embeddings.length; j++) {
      if (i !== j && cosineSimilarity(embedding, embeddings[j]) > 0.85) {
        similarCount++;
      }
    }
    const redundancyPenalty = similarCount / embeddings.length;

    // 综合评分：归一化novelty（60%）+ 长度分（40%）
    let score = normalizedNovelty * 0.6 + lengthScore * 0.4;

    // 应用惩罚因子
    score *= 1 - localRepeat * 0.5; // 连续重复惩罚
    score *= 1 - redundancyPenalty; // 全局冗余惩罚

    // 模板化段落惩罚
    if (isTemplate) {
      score *= 0.3; // 严重惩罚
    }

    // ========== 修改3: 用 score 决策，而非 rawNovelty ==========
    let category: "keep" | "fold" | "skip";
    let reason: string;

    if (score >= config.keepThreshold) {
      category = "keep";
      reason = `高信息增量 (score: ${score.toFixed(2)})`;
    } else if (score >= config.foldThreshold) {
      category = "fold";
      reason = `中等信息量 (score: ${score.toFixed(2)})`;
    } else {
      category = "fold";
      reason = `低信息增量${localRepeat > 0.7 ? " (连续重复)" : ""}${redundancyPenalty > 0.3 ? " (冗余内容)" : ""} (score: ${score.toFixed(2)})`;
    }

    scores.push({
      id: para.id,
      score,
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
    // 保留 keep 和评分较高的 fold 段落
    const visible = score.category === "keep" || score.score >= 0.4;

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
