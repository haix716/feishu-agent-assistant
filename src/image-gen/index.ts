/**
 * 图片生成模块（v2.4.0）
 *
 * 用户上传商品图/服装图 → AI 分析 → 生成穿戴效果图/商品图/封面图
 */

// 接口和类型
export type {
  ImageProvider,
  ImageAnalysis,
  GenerateParams,
  GenerateResult,
  ContentType,
  GenerateMode,
} from './providers/provider';

// 图片分析
export { analyzeImageForGeneration } from './analyzer';

// 提示词构建
export {
  buildPrompt,
  buildTryOnPrompt,
  buildProductWhiteBgPrompt,
  buildProductScenePrompt,
  buildCoverPrompt,
  DEFAULT_NEGATIVE_PROMPT,
} from './prompt-builder';

// 路由和生成
export {
  generateImage,
  parseImageGenIntent,
  buildGenerateParams,
} from './router';
export type { ImageGenIntent } from './router';
