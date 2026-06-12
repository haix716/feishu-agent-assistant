#!/bin/bash
# 检查后台 Agent 是否使用了 worktree 隔离
# 防止后台 Agent 因缺少 Write/Bash 权限而失败
#
# 规则：run_in_background=true 时必须设置 isolation="worktree"

# 从 stdin 读取工具输入 JSON
INPUT=$(cat)

# 检查是否是后台运行
IS_BG=$(echo "$INPUT" | grep -o '"run_background"[[:space:]]*:[[:space:]]*true\|"run_in_background"[[:space:]]*:[[:space:]]*true' 2>/dev/null || true)

# 检查是否有 worktree 隔离
IS_WORKTREE=$(echo "$INPUT" | grep -o '"isolation"[[:space:]]*:[[:space:]]*"worktree"' 2>/dev/null || true)

if [ -n "$IS_BG" ] && [ -z "$IS_WORKTREE" ]; then
  echo "⚠️  后台 Agent 必须使用 worktree 隔离，否则会因权限问题失败。"
  echo "   修复：在 Agent 调用中添加参数 isolation: \"worktree\""
  exit 2
fi

exit 0
