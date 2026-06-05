/**
 * 提示词模板库
 *
 * 根据不同场景和商品类型，生成高质量的英文提示词
 */

import type { GenerateMode, GenerateParams, ImageAnalysis } from './providers/provider';

/** 模特类型映射 */
const MODEL_TYPE_MAP: Record<string, string> = {
  asian_female: 'young Asian female model',
  asian_male: 'young Asian male model',
  western_female: 'Western female model',
  western_male: 'Western male model',
};

/**
 * 构建穿戴效果图提示词
 */
export function buildTryOnPrompt(analysis: ImageAnalysis, options?: { modelType?: string }): string {
  const modelDesc = MODEL_TYPE_MAP[options?.modelType || 'asian_female'] || MODEL_TYPE_MAP.asian_female;
  const { color, material, style } = analysis.attributes;

  const parts = [
    `A ${modelDesc} wearing a ${color} ${material} ${analysis.category}`,
    `${style} style`,
    'natural body posture, realistic fit',
    'professional fashion photography',
    'natural lighting, full body shot',
    'high quality, 4K, detailed fabric texture',
  ];

  return parts.join(', ');
}

/**
 * 构建商品主图提示词（白底）
 */
export function buildProductWhiteBgPrompt(analysis: ImageAnalysis): string {
  const { color, material } = analysis.attributes;

  const parts = [
    `Product photography of a ${color} ${material} ${analysis.category}`,
    'clean white background',
    'professional studio lighting, soft shadows',
    'commercial product photo, centered composition',
    'high resolution, sharp details, 4K',
  ];

  return parts.join(', ');
}

/**
 * 构建商品场景图提示词
 */
export function buildProductScenePrompt(analysis: ImageAnalysis, options?: { style?: string }): string {
  const { color, material, style } = analysis.attributes;
  const sceneStyle = options?.style || 'lifestyle';

  const sceneMap: Record<string, string> = {
    lifestyle: 'on a wooden table in a modern kitchen, warm natural lighting',
    outdoor: 'in an outdoor setting with nature background, golden hour lighting',
    minimalist: 'on a clean marble surface, minimalist aesthetic, soft diffused light',
    luxury: 'on a premium display stand, dramatic lighting, luxury brand aesthetic',
  };

  const scene = sceneMap[sceneStyle] || sceneMap.lifestyle;

  const parts = [
    `A ${color} ${material} ${analysis.category} ${scene}`,
    `${style} style`,
    'lifestyle product photography',
    'shallow depth of field, bokeh background',
    'high quality, 4K, visually appealing',
  ];

  return parts.join(', ');
}

/**
 * 构建小红书封面提示词
 */
export function buildCoverPrompt(analysis: ImageAnalysis, options?: { style?: string }): string {
  const { color, material } = analysis.attributes;
  const coverStyle = options?.style || 'aesthetic';

  const styleMap: Record<string, string> = {
    aesthetic: 'aesthetic, Instagram-worthy, trendy, visually appealing',
    cute: 'cute, kawaii style, pastel colors, soft and dreamy',
    minimal: 'minimalist, clean composition, modern aesthetic',
    vibrant: 'vibrant colors, dynamic composition, eye-catching',
  };

  const styleDesc = styleMap[coverStyle] || styleMap.aesthetic;

  const parts = [
    `Beautiful product photography of a ${color} ${material} ${analysis.category}`,
    styleDesc,
    'soft natural lighting, well-balanced composition',
    'social media cover image style',
    'high quality, 4K, Pinterest-worthy',
  ];

  return parts.join(', ');
}

/**
 * 根据模式自动构建提示词
 */
export function buildPrompt(
  analysis: ImageAnalysis,
  mode: GenerateMode,
  options?: GenerateParams['options']
): string {
  switch (mode) {
    case 'tryon':
      return buildTryOnPrompt(analysis, { modelType: options?.modelType });
    case 'product':
      if (options?.style === 'white_bg') {
        return buildProductWhiteBgPrompt(analysis);
      }
      return buildProductScenePrompt(analysis, { style: options?.style });
    case 'cover':
      return buildCoverPrompt(analysis, { style: options?.style });
    default:
      return analysis.suggestedPrompt;
  }
}

/** 默认反向提示词 */
export const DEFAULT_NEGATIVE_PROMPT =
  'blurry, low quality, distorted, deformed, ugly, bad anatomy, ' +
  'bad proportions, extra limbs, mutated, watermark, text, logo, signature';
