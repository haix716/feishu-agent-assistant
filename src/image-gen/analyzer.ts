/**
 * 图片分析器
 *
 * 用 MiMo 多模态模型分析图片内容，提取关键信息，生成英文提示词
 */

import OpenAI from 'openai';
import { config } from '../config';
import type { ImageAnalysis, ContentType, GenerateMode } from './providers/provider';

const openai = new OpenAI({
  apiKey: config.ai.apiKey,
  baseURL: config.ai.baseURL,
});

/**
 * 分析图片内容，返回结构化信息 + 英文提示词
 */
export async function analyzeImageForGeneration(base64Image: string): Promise<ImageAnalysis> {
  const response = await openai.chat.completions.create({
    model: config.mimoImageModel,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `请分析这张图片，返回 JSON 格式的结果。不要输出其他内容，只输出 JSON。

返回格式：
{
  "contentType": "clothing 或 product 或 accessory 或 other",
  "category": "具体品类，如 T恤、保温杯、项链、手机壳",
  "color": "主要颜色",
  "material": "材质，如 棉、不锈钢、皮革、塑料",
  "style": "风格，如 简约、复古、可爱、运动、商务",
  "brand": "品牌名（如果能识别，否则为空字符串）",
  "suggestedMode": "tryon 或 product 或 cover（根据图片内容推荐最合适的生成模式）",
  "englishPrompt": "用英文写一个详细的图片描述，用于 AI 生图。描述要具体，包含颜色、材质、风格、构图等细节"
}

规则：
- contentType：衣服、裤子、裙子、外套等穿在身上的东西 → clothing；包、手机壳、杯子等商品 → product；项链、戒指、手表等配饰 → accessory；其他 → other
- suggestedMode：clothing 类型默认 tryon；product 类型默认 product；都可以做 cover
- englishPrompt 要详细、具体，适合直接用于 AI 图片生成模型`
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${base64Image}` },
        },
      ],
    }],
    max_completion_tokens: 500,
  });

  const content = response.choices[0]?.message?.content || '';

  try {
    // 尝试从回复中提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('无法从回复中提取 JSON');
    }

    const data = JSON.parse(jsonMatch[0]);

    return {
      contentType: validateContentType(data.contentType),
      category: data.category || '未知',
      attributes: {
        color: data.color || '未知',
        material: data.material || '未知',
        style: data.style || '简约',
        brand: data.brand || undefined,
      },
      suggestedPrompt: data.englishPrompt || `A ${data.color} ${data.category}`,
      suggestedMode: validateGenerateMode(data.suggestedMode),
    };
  } catch (err) {
    console.warn('图片分析 JSON 解析失败，使用默认值:', err);
    console.warn('原始回复:', content);

    // 降级：用原始文本作为提示词
    return {
      contentType: 'other',
      category: '商品',
      attributes: {
        color: '未知',
        material: '未知',
        style: '简约',
      },
      suggestedPrompt: content.substring(0, 200) || 'A product photo',
      suggestedMode: 'product',
    };
  }
}

function validateContentType(value: string): ContentType {
  const valid: ContentType[] = ['clothing', 'product', 'accessory', 'other'];
  return valid.includes(value as ContentType) ? value as ContentType : 'other';
}

function validateGenerateMode(value: string): GenerateMode {
  const valid: GenerateMode[] = ['tryon', 'product', 'cover'];
  return valid.includes(value as GenerateMode) ? value as GenerateMode : 'product';
}
