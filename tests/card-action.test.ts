import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

// Mock channel
function createMockChannel() {
  return {
    send: mock.fn(async () => {}),
  };
}

// Mock event
function createMockEvent(
  actionValue: string | object,
  chatId = "oc_test",
  userId = "ou_test",
) {
  return {
    messageId: "om_test",
    chatId,
    operator: { openId: userId },
    action: { value: actionValue, tag: "button" },
  };
}

describe("handleCardAction", () => {
  it("处理 copy_title 按钮", async () => {
    const { handleCardAction } = await import("../src/handler/card-action");
    const channel = createMockChannel();
    const evt = createMockEvent({ action: "copy_title", text: "测试标题" });

    await handleCardAction(channel as any, evt as any);

    assert.equal(channel.send.mock.callCount(), 1);
    const args = channel.send.mock.calls[0].arguments;
    assert.ok(args[1].text.includes("测试标题"));
  });

  it("处理 copy_content 按钮", async () => {
    const { handleCardAction } = await import("../src/handler/card-action");
    const channel = createMockChannel();
    const evt = createMockEvent({ action: "copy_content", text: "测试正文" });

    await handleCardAction(channel as any, evt as any);

    assert.equal(channel.send.mock.callCount(), 1);
    const args = channel.send.mock.calls[0].arguments;
    assert.ok(args[1].text.includes("测试正文"));
  });

  it("处理 regenerate 按钮", async () => {
    const { handleCardAction } = await import("../src/handler/card-action");
    const channel = createMockChannel();
    const evt = createMockEvent("regenerate");

    await handleCardAction(channel as any, evt as any);

    assert.equal(channel.send.mock.callCount(), 1);
    const args = channel.send.mock.calls[0].arguments;
    assert.ok(args[1].text.includes("重新生成"));
  });

  it("处理字符串类型的 action value", async () => {
    const { handleCardAction } = await import("../src/handler/card-action");
    const channel = createMockChannel();
    const evt = createMockEvent("regenerate");

    await handleCardAction(channel as any, evt as any);

    assert.equal(channel.send.mock.callCount(), 1);
  });

  it("未知 action 不发送消息", async () => {
    const { handleCardAction } = await import("../src/handler/card-action");
    const channel = createMockChannel();
    const evt = createMockEvent("unknown_action");

    await handleCardAction(channel as any, evt as any);

    assert.equal(channel.send.mock.callCount(), 0);
  });
});
