import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { searchInsights, retrieveAndAugment } from "../src/metacognition";

describe("searchInsights 检索灵犀知识库", () => {
  test("搜 SpaceX 应命中 SpaceX IPO 那条（insight 字段含 SpaceX IPO）", () => {
    const hits = searchInsights("SpaceX", 10);
    console.log("SpaceX 命中数:", hits.length);
    for (const h of hits) {
      console.log(`  [${h.domain}] ${h.score}分 ${h.extractedAt} | ${h.insight.slice(0, 50)}`);
    }
    assert.ok(hits.length > 0, "SpaceX 应该有命中（知识库有 SpaceX IPO）");
    const hasIPO = hits.some((h) => h.insight.includes("SpaceX IPO") || h.insight.includes("IPO"));
    assert.ok(hasIPO, "命中里应有 SpaceX IPO 那条");
  });

  test("搜 'SpaceX IPO'（带空格，分词匹配）应命中", () => {
    const hits = searchInsights("SpaceX IPO", 10);
    console.log("SpaceX IPO 命中数:", hits.length);
    assert.ok(hits.length > 0, "分词后 spacex 应命中");
  });

  test("搜不存在的词应返回空", () => {
    const hits = searchInsights("量子纠缠永动机xyz", 10);
    assert.strictEqual(hits.length, 0);
  });
});

describe("retrieveAndAugment 检索并改写 query", () => {
  test("SpaceX 问题应注入灵犀检索结果（含时效）", () => {
    const augmented = retrieveAndAugment("SpaceX IPO 怎么看", 5);
    assert.ok(augmented.length > "SpaceX IPO 怎么看".length, "query 应被改写");
    assert.ok(augmented.includes("SpaceX"), "应含 SpaceX 检索结果");
    assert.ok(augmented.includes("采集于"), "应含时效标注");
  });
  test("无命中时原样返回 query", () => {
    const q = "量子纠缠永动机xyz";
    assert.strictEqual(retrieveAndAugment(q, 5), q);
  });
});
