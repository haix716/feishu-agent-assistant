import { Tool, type ToolParameter } from "./tool";
import { searchInsightsViaMCP } from "../mcp-client";

/**
 * 搜索灵犀知识库工具
 *
 * 让 bot 在回答前主动检索灵犀采集过的洞察（而不是只靠通识或被动注入）。
 * 解决"日报有 SpaceX IPO，但 bot 说没上市"这类问题——bot 回答前先搜。
 */
export class SearchInsightsTool extends Tool {
  name = "search_insights";
  description =
    "搜索灵犀知识库的洞察（Claude 通过日报采集学到的东西，跨所有日期和领域）。回答关于新闻、事件、技术、公司、论文的问题前，先用这个搜——灵犀可能已经采集过相关内容。返回带采集时间，回答时引用来源和时效。";
  parameters: Record<string, ToolParameter> = {
    query: {
      type: "string",
      description: "搜索关键词（如 SpaceX、IPO、RA-RFT、公司名、技术名、论文名）",
    },
  };
  required = ["query"];

  async execute(params: Record<string, any>): Promise<string> {
    const { query } = params;
    if (!query || typeof query !== "string") {
      return "请提供搜索关键词";
    }

    const results = await searchInsightsViaMCP(query, 8);
    if (results.length === 0) {
      return `灵犀知识库里没找到"${query}"相关的洞察`;
    }

    const formatted = results
      .map(
        (r, i) =>
          `${i + 1}. [${r.domain}]（${r.score}分，采集于 ${r.extractedAt ?? "未知"}）\n   ${r.insight}`,
      )
      .join("\n");

    return `找到 ${results.length} 条"${query}"相关洞察（按评分排序）：\n${formatted}`;
  }
}
