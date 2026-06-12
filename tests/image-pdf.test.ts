import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeFileName, validateFileSize } from "../src/util";
import { larkService } from "../src/lark";

describe("sanitizeFileName", () => {
  it("should remove path traversal sequences", () => {
    assert.equal(sanitizeFileName("../../../etc/passwd"), "etc_passwd");
    assert.equal(
      sanitizeFileName("..\\..\\windows\\system32"),
      "windows_system32",
    );
    assert.equal(sanitizeFileName("foo/../../bar"), "foo_bar");
  });

  it("should replace special characters", () => {
    assert.equal(sanitizeFileName("file name!@#.txt"), "file_name_.txt");
    assert.equal(
      sanitizeFileName("test:file<name>.pdf"),
      "test_file_name_.pdf",
    );
  });

  it("should handle empty or whitespace-only input", () => {
    assert.equal(sanitizeFileName(""), "untitled");
    assert.equal(sanitizeFileName("   "), "untitled");
    assert.equal(sanitizeFileName("\t\n"), "untitled");
  });

  it("should collapse consecutive underscores", () => {
    assert.equal(sanitizeFileName("a___b"), "a_b");
    assert.equal(sanitizeFileName("a///b"), "a_b");
  });

  it("should preserve normal filenames", () => {
    assert.equal(sanitizeFileName("document.pdf"), "document.pdf");
    assert.equal(sanitizeFileName("my_file-2024.txt"), "my_file-2024.txt");
  });
});

describe("validateFileSize", () => {
  it("should accept buffer within limit", () => {
    const buf = Buffer.alloc(1024); // 1KB
    assert.equal(validateFileSize(buf, 1), true);
  });

  it("should reject buffer exceeding limit", () => {
    const buf = Buffer.alloc(2 * 1024 * 1024); // 2MB
    assert.equal(validateFileSize(buf, 1), false);
  });

  it("should accept buffer exactly at limit", () => {
    const buf = Buffer.alloc(1024 * 1024); // exactly 1MB
    assert.equal(validateFileSize(buf, 1), true);
  });
});

describe("larkService.getResource", () => {
  it("should exist as a function", () => {
    assert.equal(typeof larkService.getResource, "function");
  });
});
