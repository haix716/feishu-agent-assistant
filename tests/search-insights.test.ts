import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatRetrieved, retrieveAndAugment } from "../src/metacognition";
import type { InsightHit } from "../src/mcp-client";

describe("formatRetrieved 拼接检索结果（纯函数，不依赖 MCP）", () => {
  test("有命中时把结果（含时效）拼进 query", () => {
    const hits: InsightHit[] = [
      {
        domain: "科技商业与投资",
        insight: "SpaceX IPO 代表太空科技进入资本市场",
        score: 9,
        extractedAt: "2026-06-13T08:00:00Z",
      },
    ];
    const out = formatRetrieved("SpaceX IPO 怎么看", hits);
    assert.ok(out.includes("SpaceX IPO 怎么看"), "保留原 query");
    assert.ok(out.includes("SpaceX IPO 代表"), "含检索 insight");
    assert.ok(out.includes("采集于2026-06-13"), "含时效标注");
  });

  test("无命中时原样返回 query", () => {
    assert.strictEqual(formatRetrieved("随便问问", []), "随便问问");
  });
});

describe("retrieveAndAugment 通过 MCP 检索并改写 query", () => {
  test("SpaceX 问题应注入灵犀检索结果（含时效）", async () => {
    const augmented = await retrieveAndAugment("SpaceX IPO 怎么看", 5);
    assert.ok(augmented.length > "SpaceX IPO 怎么看".length, "query 应被改写");
    assert.ok(augmented.includes("SpaceX"), "应含 SpaceX 检索结果");
    assert.ok(augmented.includes("采集于"), "应含时效标注");
  });

  test("无命中时原样返回 query", async () => {
    const q = "量子纠缠永动机xyz";
    assert.strictEqual(await retrieveAndAugment(q, 5), q);
  });
});
