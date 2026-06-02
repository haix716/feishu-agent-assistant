import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractFeishuDocLinks, parseWikiToken } from "../src/util.ts";

describe("extractFeishuDocLinks", () => {
  it("提取 docx 类型链接", () => {
    const text = "请看这个文档 https://sample.feishu.cn/docx/ABC123def";
    const links = extractFeishuDocLinks(text);
    assert.equal(links.length, 1);
    assert.equal(links[0].type, "docx");
    assert.equal(links[0].token, "ABC123def");
  });

  it("提取 doc 类型链接", () => {
    const text = "参考 https://sample.feishu.cn/doc/XYZ789";
    const links = extractFeishuDocLinks(text);
    assert.equal(links.length, 1);
    assert.equal(links[0].type, "doc");
    assert.equal(links[0].token, "XYZ789");
  });

  it("提取 wiki 类型链接", () => {
    const text = "知识库在这里 https://sample.feishu.cn/wiki/WikiToken123";
    const links = extractFeishuDocLinks(text);
    assert.equal(links.length, 1);
    assert.equal(links[0].type, "wiki");
    assert.equal(links[0].token, "WikiToken123");
  });

  it("提取 sheets 类型链接", () => {
    const text = "表格数据 https://sample.feishu.cn/sheets/SHEET456";
    const links = extractFeishuDocLinks(text);
    assert.equal(links.length, 1);
    assert.equal(links[0].type, "sheets");
    assert.equal(links[0].token, "SHEET456");
  });

  it("一条消息中提取多个链接", () => {
    const text =
      "文档1: https://sample.feishu.cn/docx/AAA 文档2: https://sample.feishu.cn/wiki/BBB";
    const links = extractFeishuDocLinks(text);
    assert.equal(links.length, 2);
    assert.equal(links[0].type, "docx");
    assert.equal(links[0].token, "AAA");
    assert.equal(links[1].type, "wiki");
    assert.equal(links[1].token, "BBB");
  });

  it("消息中没有链接时返回空数组", () => {
    const text = "这是一条普通消息，没有链接";
    const links = extractFeishuDocLinks(text);
    assert.equal(links.length, 0);
  });

  it("处理带查询参数的链接", () => {
    const text = "https://sample.feishu.cn/docx/ABC123?query=1";
    const links = extractFeishuDocLinks(text);
    assert.equal(links.length, 1);
    assert.equal(links[0].type, "docx");
    assert.equal(links[0].token, "ABC123");
  });

  it("处理带 fragment 的链接", () => {
    const text = "https://sample.feishu.cn/wiki/TOKEN999#heading";
    const links = extractFeishuDocLinks(text);
    assert.equal(links.length, 1);
    assert.equal(links[0].type, "wiki");
    assert.equal(links[0].token, "TOKEN999");
  });

  it("支持不同子域名", () => {
    const text = "https://bytedance.feishu.cn/docx/TEST123";
    const links = extractFeishuDocLinks(text);
    assert.equal(links.length, 1);
    assert.equal(links[0].type, "docx");
    assert.equal(links[0].token, "TEST123");
  });

  it("不匹配非飞书域名的类似链接", () => {
    const text = "https://example.com/docx/FAKE123";
    const links = extractFeishuDocLinks(text);
    assert.equal(links.length, 0);
  });
});

describe("parseWikiToken", () => {
  it("从 wiki URL 中解析 token", () => {
    const url = "https://sample.feishu.cn/wiki/MyWikiToken";
    const result = parseWikiToken(url);
    assert.ok(result !== null);
    assert.equal(result!.token, "MyWikiToken");
    assert.equal(result!.type, "wiki");
  });

  it("从 docx URL 中解析 token", () => {
    const url = "https://sample.feishu.cn/docx/DocToken123";
    const result = parseWikiToken(url);
    assert.ok(result !== null);
    assert.equal(result!.token, "DocToken123");
    assert.equal(result!.type, "docx");
  });

  it("非飞书 URL 返回 null", () => {
    const url = "https://example.com/something";
    const result = parseWikiToken(url);
    assert.equal(result, null);
  });

  it("处理带查询参数的 URL", () => {
    const url = "https://sample.feishu.cn/wiki/TOKEN?foo=bar";
    const result = parseWikiToken(url);
    assert.ok(result !== null);
    assert.equal(result!.token, "TOKEN");
  });
});
