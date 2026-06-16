import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatRetrieved, retrieveAndAugment } from "../src/metacognition";
import type { InsightHit } from "../src/mcp-client";

describe("formatRetrieved 拼接检索结果（纯函数，不依赖 MCP）", () => {
  test("有命中时返回 augmentedQuery + sourcePrefix", () => {
    const hits: InsightHit[] = [
      {
        domain: "科技商业与投资",
        insight: "SpaceX IPO 代表太空科技进入资本市场",
        score: 9,
        extractedAt: "2026-06-13T08:00:00Z",
      },
    ];
    const { augmentedQuery, sourcePrefix } = formatRetrieved("SpaceX IPO 怎么看", hits);
    assert.ok(augmentedQuery.includes("SpaceX IPO 怎么看"), "保留原 query");
    assert.ok(augmentedQuery.includes("SpaceX IPO 代表"), "含检索 insight");
    assert.ok(sourcePrefix.includes("采集于2026-06-13"), "含时效标注");
    assert.ok(sourcePrefix.includes("检索到 1 条"), "含检索条数");
  });

  test("无命中时返回空 sourcePrefix", () => {
    const { augmentedQuery, sourcePrefix } = formatRetrieved("随便问问", []);
    assert.strictEqual(augmentedQuery, "随便问问");
    assert.strictEqual(sourcePrefix, "");
  });
});

describe("retrieveAndAugment 通过 MCP 检索并改写 query", () => {
  test("SpaceX 问题应注入灵犀检索结果（含时效）", async () => {
    const { augmentedQuery, sourcePrefix } = await retrieveAndAugment("SpaceX IPO 怎么看", 5);
    assert.ok(augmentedQuery.length > "SpaceX IPO 怎么看".length, "query 应被改写");
    assert.ok(augmentedQuery.includes("SpaceX"), "应含 SpaceX 检索结果");
    assert.ok(sourcePrefix.includes("采集于"), "应含时效标注");
  });

  test("无命中时返回空 sourcePrefix", async () => {
    const q = "量子纠缠永动机xyz";
    const { augmentedQuery, sourcePrefix } = await retrieveAndAugment(q, 5);
    assert.strictEqual(augmentedQuery, q);
    assert.strictEqual(sourcePrefix, "");
  });
});
