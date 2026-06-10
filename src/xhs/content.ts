/**
 * 小红书内容生成器
 *
 * 根据产品分析结果，生成适合小红书的标题、正文和标签
 */

import OpenAI from 'openai';
import { config } from '../config';

const openai = new OpenAI({
  apiKey: config.ai.apiKey,
  baseURL: config.ai.baseURL,
});

/** 生成的小红书内容 */
export interface XhsContent {
  title: string;      // 标题（20字以内）
  content: string;    // 正文（1000字以内）
  tags: string[];     // 话题标签
}

/**
 * 根据产品信息生成小红书内容
 *
 * @param productInfo 产品分析信息（来自 detail-suite analyzer 或通用 analyzer）
 * @param style 内容风格
 */
export async function generateXhsContent(
  productInfo: {
    category: string;
    material: string;
    color: string;
    style: string;
    craftsmanship?: string;
    designElements?: string;
    culturalMeaning?: string;
    description?: string;
  },
  style: '种草' | '测评' | '教程' | '日常' = '种草',
): Promise<XhsContent> {
  // 如果材质是银，强制修正为银材质
  const material = productInfo.material === '银' ? '银' : productInfo.material;

  const response = await openai.chat.completions.create({
    model: config.ai.model,
    messages: [{
      role: 'user',
      content: `你是一个小红书爆款文案写手。根据以下产品信息，生成一篇小红书笔记。

产品信息：
- 品类：${productInfo.category}
- 材质：${material}
- 颜色：${productInfo.color}
- 风格：${productInfo.style}
${productInfo.craftsmanship ? `- 工艺：${productInfo.craftsmanship}` : ''}
${productInfo.designElements ? `- 设计元素：${productInfo.designElements}` : ''}
${productInfo.culturalMeaning ? `- 文化寓意：${productInfo.culturalMeaning}` : ''}
${productInfo.description ? `- 产品描述：${productInfo.description}` : ''}

内容风格：${style}

要求：
1. 标题：20字以内，带emoji，吸引眼球，有"种草感"
2. 正文：150-250字，口语化，像朋友推荐一样自然，带emoji分段
3. 标签：5-8个相关话题标签

重要规则：
- 材质必须写"银"或"925银"，绝对不能写"不锈钢"、"金属"、"合金"
- 如果产品是银饰，强调"纯银"、"925银"、"银饰"等关键词
- 不要使用"不锈钢"、"钢"、"金属"等词

返回 JSON 格式：
{
  "title": "标题内容",
  "content": "正文内容",
  "tags": ["标签1", "标签2", "标签3"]
}

只输出 JSON，不要其他内容。`
    }],
    max_completion_tokens: 2000,
  });

  const text = response.choices[0]?.message?.content || '';
  console.log('[XHS Content] 模型返回:', text.substring(0, 200));

  if (!text) {
    console.error('[XHS Content] 模型返回空内容');
    throw new Error('模型返回空内容');
  }

  try {
    // 提取 JSON（支持 markdown 代码块和裸 JSON）
    let jsonStr = '';
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }

    if (!jsonStr) throw new Error(`无法从回复中提取 JSON: ${text.substring(0, 100)}`);
    const data = JSON.parse(jsonStr);

    return {
      title: (data.title || productInfo.category).substring(0, 20),
      content: (data.content || '').substring(0, 1000),
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 8).map((t: string) => t.replace(/^#+/, '')) : [],
    };
  } catch (err) {
    console.error('[XHS Content] 解析失败:', err);

    // 降级：生成基础内容
    return {
      title: `✨${productInfo.color}${productInfo.category}推荐`,
      content: `今天分享一款超好看的${productInfo.material}${productInfo.category}！\n\n${productInfo.description || `${productInfo.style}风格，质感超棒`}\n\n喜欢的姐妹冲！`,
      tags: [productInfo.category, productInfo.material, productInfo.style, '好物推荐', '种草'],
    };
  }
}

/**
 * 为图片生成适合小红书的封面标题（用于文字叠加）
 */
export async function generateCoverTitle(
  productInfo: { category: string; color: string; style: string },
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: config.ai.model,
    messages: [{
      role: 'user',
      content: `为小红书封面图生成一个简短标题。

产品：${productInfo.color}${productInfo.category}，${productInfo.style}风格

要求：
- 6-10个字
- 带1-2个emoji
- 吸引眼球，有"种草感"
- 适合叠加在产品图上

只输出标题文字，不要其他内容。`
    }],
    max_completion_tokens: 100,
  });

  return response.choices[0]?.message?.content?.trim() || `✨${productInfo.category}推荐`;
}
