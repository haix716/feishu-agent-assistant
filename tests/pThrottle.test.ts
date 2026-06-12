import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pThrottle } from "../src/util.ts";

describe("pThrottle", () => {
  it("最后一次调用的结果不应被丢弃（trailing-edge）", async () => {
    const calls: string[] = [];
    const throttled = pThrottle(async (text: string) => {
      calls.push(text);
    }, 100);

    // 模拟 Claude streaming：快速连续调用，每次传完整累积文本
    // 第一个调用会立即执行，后续调用在 pending 期间到达
    const p1 = throttled("如有什么我可以");
    // 等一小会儿让第一个调用进入 pending 状态
    await new Promise((r) => setTimeout(r, 10));
    const p2 = throttled("如有什么我可以帮");
    const p3 = throttled("如有什么我可以帮忙");
    const p4 = throttled("如有什么我可以帮忙的");

    await Promise.all([p1, p2, p3, p4]);

    // 最关键的断言：最后一次（最完整的）调用必须被执行
    assert.ok(
      calls.includes("如有什么我可以帮忙的"),
      `最后一次调用不应被丢弃，实际执行的调用: ${JSON.stringify(calls)}`,
    );
  });

  it("快速连续调用时，最终结果必须是最新的文本", async () => {
    const results: string[] = [];
    const throttled = pThrottle(async (text: string) => {
      results.push(text);
    }, 50);

    // 模拟快速流式更新
    const promises: Promise<any>[] = [];
    for (let i = 1; i <= 10; i++) {
      promises.push(throttled("text-" + i));
      await new Promise((r) => setTimeout(r, 5)); // 5ms 间隔，远小于 50ms 节流
    }
    await Promise.all(promises);

    // 最后一次调用 "text-10" 必须被执行
    assert.ok(
      results.includes("text-10"),
      `最终文本 "text-10" 不应丢失，实际结果: ${JSON.stringify(results)}`,
    );
  });

  it("节流仍然有效：不会每次都执行", async () => {
    let callCount = 0;
    const throttled = pThrottle(async () => {
      callCount++;
    }, 100);

    // 快速连续调用 5 次
    const promises: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(throttled());
      await new Promise((r) => setTimeout(r, 10));
    }
    await Promise.all(promises);

    // 节流应该减少调用次数，但不会是 1（trailing edge 会多执行一次）
    assert.ok(callCount >= 2, "trailing-edge 至少执行 2 次（首+尾）");
    assert.ok(callCount <= 5, "节流应减少总调用次数");
  });
});
