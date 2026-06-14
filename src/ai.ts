import OpenAI from "openai";
import { config } from "./config";
import { ToolManager, ToolDefinition } from "./tools";
import { generateMetacognitionContext, retrieveAndAugment } from "./metacognition";

export const openai = new OpenAI({
  apiKey: config.ai.apiKey,
  baseURL: config.ai.baseURL,
});

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  userName?: string;
  chatName?: string;
  chatType?: string;
}

function getCurrentDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function buildSystemPrompt(ctx?: ChatContext): string {
  const systemParts = [config.systemPrompt, `当前日期：${getCurrentDate()}`];
  if (ctx?.userName) systemParts.push(`用户名称：${ctx.userName}`);
  if (ctx?.chatName) systemParts.push(`群聊名称：${ctx.chatName}`);
  if (ctx?.chatType === "group") systemParts.push("当前在群聊中，请简洁回复。");

  // 添加元认知上下文
  const metacognitionContext = generateMetacognitionContext();
  if (metacognitionContext) {
    systemParts.push(metacognitionContext);
    systemParts.push(
      "注意：如果用户发送纯数字（如 1、2），可能是在追问今日灵犀日报中的某条洞察，请根据日报内容展开回答，不要当作新话题处理。",
    );
  }

  // 灵犀知识库的相关内容会在用户消息里附带（系统已主动检索注入）。
  systemParts.push(
    "回答规则：优先基于用户消息里附带的【灵犀知识库检索结果】回答，并引用采集时间。检索没覆盖用户问的，明确说\"灵犀没采集过这个话题\"，补充通识时必须标注\"以下是基于通识的推测，可能不准\"——绝不假装采集过、绝不编造细节或来源、绝不假装调用了工具。",
  );
  return systemParts.join("\n");
}

export async function streamAI(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  ctx?: ChatContext,
): Promise<string> {
  const systemPrompt = buildSystemPrompt(ctx);

  const openaiMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const stream = await openai.chat.completions.create({
    model: config.ai.model,
    messages: openaiMessages,
    stream: true,
    max_tokens: 4096,
  });

  let fullText = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      onChunk(fullText);
    }
  }
  return fullText;
}

/**
 * 支持工具调用的 AI 生成（最多 2 轮工具调用）
 *
 * 流程：
 * 1. 第一次调用，带工具定义
 * 2. 如果模型要调工具 → 执行工具 → 第二次调用，带工具结果
 * 3. 如果不需要工具 → 走流式输出
 */
export async function streamAIWithTools(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  ctx?: ChatContext,
  toolManager?: ToolManager,
): Promise<string> {
  if (!toolManager || toolManager.size === 0) {
    // 没有工具，走普通流程
    return streamAI(messages, onChunk, ctx);
  }

  const systemPrompt = buildSystemPrompt(ctx);
  const tools = toolManager.getDefinitions();

  const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  // 主动检索灵犀知识库：把最后一条 user message 用检索结果增强。
  // 不靠 AI 工具调用——MiMo 用 <tool_call> 文本格式，不兼容 openai tool_calls，调了等于没调。
  const lastMsg = openaiMessages[openaiMessages.length - 1];
  if (lastMsg && lastMsg.role === "user" && typeof lastMsg.content === "string") {
    lastMsg.content = retrieveAndAugment(lastMsg.content, 5);
  }

  // 最多 2 轮工具调用
  for (let round = 0; round < 2; round++) {
    const response = await openai.chat.completions.create({
      model: config.ai.model,
      messages: openaiMessages,
      tools: tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      max_tokens: 4096,
    });

    const choice = response.choices[0];

    // 如果模型要调工具
    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      // 添加模型的回复到消息历史
      openaiMessages.push(choice.message);

      // 执行所有工具调用
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== "function") continue;
        const params = JSON.parse(toolCall.function.arguments);
        const result = await toolManager.execute(
          toolCall.function.name,
          params,
        );

        // 添加工具结果到消息历史
        openaiMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
      // 继续下一轮
      continue;
    }

    // 不需要工具，返回结果
    const content = choice.message.content || "";
    onChunk(content);
    return content;
  }

  // 2 轮工具调用后，强制生成最终回复（不带工具）
  const finalResponse = await openai.chat.completions.create({
    model: config.ai.model,
    messages: openaiMessages,
    max_tokens: 4096,
  });

  const finalContent = finalResponse.choices[0]?.message?.content || "";
  onChunk(finalContent);
  return finalContent;
}

export async function analyzeImage(
  base64Image: string,
): Promise<{ description: string; fileName: string }> {
  const response = await openai.chat.completions.create({
    model: config.mimoImageModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `请分析这张图片，返回两行内容：
1. 描述：用中文描述图片内容，100字以内
2. 文件名：用中文生成一个简短的文件名，12个字以内，不要包含特殊字符和空格

示例格式：
描述：这是一张风景照，展示了山间的日出美景
文件名：山间日出风景照`,
          },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${base64Image}` },
          },
        ],
      },
    ],
    max_completion_tokens: 300,
  });

  const content = response.choices[0]?.message?.content || "";
  const lines = content.split("\n").filter((line) => line.trim());

  let description = "";
  let fileName = "";

  for (const line of lines) {
    if (line.startsWith("描述：") || line.startsWith("描述:")) {
      description = line.replace(/^描述[：:]\s*/, "").trim();
    } else if (line.startsWith("文件名：") || line.startsWith("文件名:")) {
      fileName = line.replace(/^文件名[：:]\s*/, "").trim();
    }
  }

  // 如果解析失败，使用默认值
  if (!description) description = content.substring(0, 100);
  if (!fileName) fileName = "图片";

  return { description, fileName };
}
