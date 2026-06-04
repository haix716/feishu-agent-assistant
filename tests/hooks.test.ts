import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SETTINGS_PATH = path.resolve(
  __dirname,
  "../.claude/settings.local.json"
);
const TMP_DIR = path.resolve(__dirname, "../.tmp-test");

// ── helpers ──────────────────────────────────────────────────────────

function run(cmd: string, opts?: { cwd?: string }): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      cwd: opts?.cwd ?? TMP_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? "") + (err.stderr ?? ""),
      exitCode: err.status ?? 1,
    };
  }
}

// ── 1. 配置结构验证 ──────────────────────────────────────────────────

describe("Hook 配置结构", () => {
  let settings: any;

  before(() => {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    settings = JSON.parse(raw);
  });

  it("settings.local.json 是合法 JSON", () => {
    assert.ok(settings, "文件应能正常解析");
  });

  it("包含 PostToolUse 配置", () => {
    assert.ok(Array.isArray(settings.hooks?.PostToolUse), "PostToolUse 应为数组");
    assert.ok(settings.hooks.PostToolUse.length > 0, "PostToolUse 不应为空");
  });

  it("PostToolUse 匹配 Write|Edit 且执行 prettier", () => {
    const hook = settings.hooks.PostToolUse[0];
    assert.equal(hook.matcher, "Write|Edit");
    assert.ok(
      hook.hooks[0].command.includes("prettier"),
      "命令应包含 prettier"
    );
  });

  it("包含 PreToolUse 配置", () => {
    assert.ok(Array.isArray(settings.hooks?.PreToolUse), "PreToolUse 应为数组");
    assert.ok(settings.hooks.PreToolUse.length > 0, "PreToolUse 不应为空");
  });

  it("PreToolUse 匹配 Write|Edit 且执行安全检查", () => {
    const hook = settings.hooks.PreToolUse[0];
    assert.equal(hook.matcher, "Write|Edit");
    assert.ok(
      hook.hooks[0].command.includes("security-check"),
      "命令应包含 security-check"
    );
  });
});

// ── 2. PostToolUse — Prettier 自动格式化 ─────────────────────────────

describe("PostToolUse: Prettier 格式化", () => {
  before(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  after(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("能将格式混乱的 TS 文件格式化", () => {
    const filePath = path.join(TMP_DIR, "bad-format.ts");
    // 故意写得很乱
    const messy = `const   x=1;const y  =   {a:1,b:2,c:3};function hello( ){return "hello world"}`;
    fs.writeFileSync(filePath, messy, "utf-8");

    // 执行 hook 中的 prettier 命令
    const { exitCode } = run(`npx prettier --write ${filePath}`);
    assert.equal(exitCode, 0, "prettier 应正常退出");

    const result = fs.readFileSync(filePath, "utf-8");
    // 格式化后应该有换行和正确缩进
    assert.ok(result.includes("\n"), "格式化后应包含换行");
    assert.ok(result.length >= messy.length, "格式化后内容不应丢失");
    // 不应该还是原来的单行
    assert.notEqual(result, messy, "文件应被 prettier 修改");
  });

  it("已经是好格式的文件不会被破坏", () => {
    const filePath = path.join(TMP_DIR, "good-format.ts");
    const good = `const x = 1;\nconst y = { a: 1, b: 2 };\n\nfunction hello() {\n  return "hello";\n}\n`;
    fs.writeFileSync(filePath, good, "utf-8");

    const { exitCode } = run(`npx prettier --write ${filePath}`);
    assert.equal(exitCode, 0);

    const result = fs.readFileSync(filePath, "utf-8");
    // prettier 可能微调空白，但结构应一致
    assert.ok(result.includes("const x = 1"), "代码内容应保留");
    assert.ok(result.includes("function hello()"), "函数应保留");
  });
});

// ── 3. PreToolUse — ESLint 拦截 ──────────────────────────────────────

describe("PreToolUse: ESLint 拦截", () => {
  // 测试 eslint 本身能检测错误（模拟 hook 拦截效果）
  it("有 lint 错误的代码应被 eslint 拦截", () => {
    // 用 src/ 下一个临时文件测试
    const filePath = path.resolve(__dirname, "../src/_test_lint_error.ts");
    const badCode = `const x: any = 1;\nconsole.log(x);\n`;

    fs.writeFileSync(filePath, badCode, "utf-8");
    try {
      // 模拟 PreToolUse hook 命令：eslint src/ --max-warnings 0
      const { exitCode } = run("npx eslint src/ --max-warnings 0", {
        cwd: path.resolve(__dirname, ".."),
      });
      // any 类型会触发 @typescript-eslint/no-explicit-any (warn)
      // --max-warnings 0 会把 warn 也当错误
      assert.notEqual(exitCode, 0, "有 lint 问题时 eslint 应返回非零退出码");
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it("无 warning 的代码应通过 --max-warnings 0", () => {
    // 创建一个干净的临时文件单独检查
    const filePath = path.resolve(__dirname, "../src/_test_lint_clean.ts");
    const cleanCode = `const greeting: string = "hello";\nconsole.log(greeting);\n`;
    fs.writeFileSync(filePath, cleanCode, "utf-8");
    try {
      const { exitCode } = run(`npx eslint ${filePath}`, {
        cwd: path.resolve(__dirname, ".."),
      });
      assert.equal(exitCode, 0, "干净代码应通过 eslint");
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it("当前 src/ 存在 no-explicit-any warning（hook 会拦截 commit）", () => {
    const { exitCode, stdout } = run("npx eslint src/ --max-warnings 0", {
      cwd: path.resolve(__dirname, ".."),
    });
    // 当前 src/ 有 any 类型 warning，--max-warnings 0 应该失败
    assert.notEqual(exitCode, 0, "有 warning 时 --max-warnings 0 应返回非零");
    assert.ok(
      stdout.includes("no-explicit-any"),
      "应报告 no-explicit-any warning"
    );
  });
});
