import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeFileName } from "../src/util.ts";
import { larkService } from "../src/lark.ts";

describe("sanitizeFileName", () => {
  it("正常文件名保持不变", () => {
    assert.equal(sanitizeFileName("video.mp4"), "video.mp4");
    assert.equal(sanitizeFileName("音频文件.mp3"), "音频文件.mp3");
  });

  it("去除路径穿越", () => {
    assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFileName("../../../secret.txt"), "secret.txt");
    assert.equal(sanitizeFileName("foo/bar/file.mp4"), "file.mp4");
    assert.equal(sanitizeFileName("foo\\bar\\file.mp4"), "file.mp4");
  });

  it("替换特殊字符", () => {
    assert.equal(sanitizeFileName("my file (1).mp4"), "my_file__1_.mp4");
    assert.equal(sanitizeFileName("a@b#c$.mp4"), "a_b_c_.mp4");
  });

  it("空值或空白返回默认名", () => {
    assert.equal(sanitizeFileName(""), "untitled");
    assert.equal(sanitizeFileName("   "), "untitled");
  });

  it("超长文件名被截断", () => {
    const long = "a".repeat(300) + ".mp4";
    const result = sanitizeFileName(long);
    assert.ok(result.length <= 255, `长度应 <= 255，实际 ${result.length}`);
    assert.ok(result.endsWith(".mp4"), "应保留扩展名");
  });
});

describe("uploadFile", () => {
  it("larkService 应有 uploadFile 方法", () => {
    assert.equal(typeof larkService.uploadFile, "function");
  });
});
