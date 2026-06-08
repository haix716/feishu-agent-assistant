#!/bin/bash
# quality-gate.sh：统一质量门禁脚本
# 用法：quality-gate.sh [commit|push|agent]
#
# 设计原则：
#   - 强约束用代码，不用 CLAUDE.md 文字规则
#   - 客观问题（安全漏洞、lint 错误、格式错误）→ 阻塞
#   - 主观判断（任务大小、是否需要讨论）→ 不阻塞，留给 CLAUDE.md 指导
#   - commit 阶段快速（<5s），push 阶段完整

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

fail() { echo -e "${RED}❌ $1${NC}"; ERRORS=$((ERRORS + 1)); }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; WARNINGS=$((WARNINGS + 1)); }
pass() { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

# ==================== 模式解析 ====================
MODE="${1:-commit}"
case "$MODE" in
  commit) info "模式：commit（快速检查）" ;;
  push)   info "模式：push（完整检查）" ;;
  agent)  info "模式：agent（产出验证）" ;;
  *)      echo "用法：quality-gate.sh [commit|push|agent]"; exit 1 ;;
esac

echo ""

# ==================== 1. 安全检查（所有模式） ====================
echo "🔒 安全检查..."

STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || true)

if [ -z "$STAGED_FILES" ]; then
  pass "没有 staged 文件，跳过安全检查"
else
  # 1a. 禁止提交的文件
  BLOCKED_PATTERNS=(
    "\.claude/"
    "\.env$"
    "\.env\."
    "\.pem$"
    "\.key$"
    "\.p12$"
    "\.pfx$"
    "node_modules/"
    "images/"
    "\.user-tokens\.json"
    "settings\.json"
  )

  for pattern in "${BLOCKED_PATTERNS[@]}"; do
    if echo "$STAGED_FILES" | grep -E "$pattern" 2>/dev/null; then
      fail "禁止提交的文件: $pattern"
    fi
  done

  # 1b. API Key 模式检测
  STAGED_DIFF=$(git diff --cached -- . ':!scripts/security-check.sh' ':!scripts/quality-gate.sh' 2>/dev/null || true)

  KEY_PATTERNS=(
    "r8_[a-zA-Z0-9]{20,}"
    "tp-[a-zA-Z0-9]{20,}"
    "sk-[a-zA-Z0-9]{20,}"
    "ghp_[a-zA-Z0-9]{36}"
    "app_secret.*[a-zA-Z0-9]{20,}"
    "ANTHROPIC_API_KEY="
    "Authorization: Bearer"
    "Bearer [a-zA-Z0-9_-]{20,}"
  )

  for pattern in "${KEY_PATTERNS[@]}"; do
    if echo "$STAGED_DIFF" | grep -iE "$pattern" 2>/dev/null; then
      fail "发现敏感信息: $pattern"
    fi
  done

  # 1c. 媒体文件
  if echo "$STAGED_FILES" | grep -iE "\.(jpg|jpeg|png|gif|mp4|mp3|mov|avi|webp)$" 2>/dev/null; then
    fail "发现媒体文件泄露"
  fi

  if [ $ERRORS -eq 0 ]; then
    pass "安全检查通过"
  fi
fi

# ==================== 2. Pre-mortem 风险预检（commit） ====================
if [ "$MODE" = "commit" ]; then
  echo ""
  echo "🔮 Pre-mortem 风险预检..."
  PREMORTEM_OUTPUT=$("$PROJECT_ROOT/scripts/premortem.sh" staged 2>&1) || true
  PREMORTEM_EXIT=$?

  if [ $PREMORTEM_EXIT -ne 0 ]; then
    fail "Pre-mortem 发现高风险项"
    echo "$PREMORTEM_OUTPUT" | grep -E "🔴|🟡|🟢|⚠️" | head -10
  elif echo "$PREMORTEM_OUTPUT" | grep -qE "🟡|⚠️"; then
    warn "Pre-mortem 有风险提示（不阻塞）"
    echo "$PREMORTEM_OUTPUT" | grep -E "🟡|⚠️" | head -5
  else
    pass "Pre-mortem 未发现风险"
  fi
fi

# ==================== 3. Lint 检查（commit/push） ====================
if [ "$MODE" = "commit" ] || [ "$MODE" = "push" ]; then
  echo ""
  echo "📏 Lint 检查..."
  LINT_RESULT=$(npx eslint src/ 2>&1) || true

  # 检查是否有真正的 error（不是 "0 errors" 这种汇总行）
  # ESLint 输出格式："✖ N problems (X errors, Y warnings)" 或具体的 error 行
  if echo "$LINT_RESULT" | grep -qE "problems \([1-9][0-9]* errors"; then
    fail "ESLint 有 error（必须修复）"
    echo "$LINT_RESULT" | tail -5
  else
    pass "Lint 通过（0 error）"
  fi
fi

# ==================== 3. Commit Message 格式（commit） ====================
if [ "$MODE" = "commit" ]; then
  echo ""
  echo "📝 Commit Message 检查..."

  # 从 COMMIT_EDITMSG 读取（如果存在），否则跳过
  COMMIT_MSG_FILE="${PROJECT_ROOT}/.git/COMMIT_EDITMSG"
  if [ -f "$COMMIT_MSG_FILE" ]; then
    COMMIT_MSG=$(head -1 "$COMMIT_MSG_FILE")

    # Conventional Commits 格式：type(scope): description
    # 允许的 type：feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert
    if echo "$COMMIT_MSG" | grep -qE "^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?: .+"; then
      pass "Commit message 格式正确"
    else
      fail "Commit message 格式错误"
      echo "   期望：<type>(<scope>): <description>"
      echo "   type: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert"
      echo "   实际：$COMMIT_MSG"
    fi
  else
    info "无法读取 commit message（跳过格式检查）"
  fi
fi

# ==================== 4. 测试覆盖（push/agent） ====================
if [ "$MODE" = "push" ] || [ "$MODE" = "agent" ]; then
  echo ""
  echo "📝 测试覆盖检查..."

  if [ "$MODE" = "push" ]; then
    CHANGED_FILES=$(git diff --name-only HEAD~1..HEAD -- 'src/**/*.ts' 2>/dev/null | grep -v '\.d\.ts$' | grep -v 'index\.ts$' || true)
  else
    # agent 模式：检查所有未提交的改动
    CHANGED_FILES=$(git diff --name-only -- 'src/**/*.ts' 2>/dev/null | grep -v '\.d\.ts$' | grep -v 'index\.ts$' || true)
  fi

  if [ -z "$CHANGED_FILES" ]; then
    pass "没有改动的源文件，跳过测试覆盖检查"
  else
    MISSING_TESTS=""
    for src_file in $CHANGED_FILES; do
      module_name=$(basename "$src_file" .ts)
      test_file="tests/${module_name}.test.ts"
      if [ ! -f "$test_file" ]; then
        MISSING_TESTS="$MISSING_TESTS $src_file"
      fi
    done

    if [ -z "$MISSING_TESTS" ]; then
      pass "所有改动文件都有测试覆盖"
    else
      warn "以下文件缺少测试（不阻塞，但建议补充）："
      for f in $MISSING_TESTS; do
        module_name=$(basename "$f" .ts)
        echo "   - $f -> tests/${module_name}.test.ts"
      done
    fi
  fi
fi

# ==================== 5. 全量测试（push/agent） ====================
if [ "$MODE" = "push" ] || [ "$MODE" = "agent" ]; then
  echo ""
  echo "🧪 运行全量测试..."
  TEST_OUTPUT=$(npm test 2>&1)
  TEST_EXIT=$?

  if [ $TEST_EXIT -eq 0 ]; then
    TEST_COUNT=$(echo "$TEST_OUTPUT" | sed -n 's/.*ℹ tests \([0-9]*\).*/\1/p' | head -1)
    TEST_COUNT="${TEST_COUNT:-?}"
    pass "全部测试通过（${TEST_COUNT} 个）"
  else
    fail "测试失败"
    echo "$TEST_OUTPUT" | tail -20
  fi
fi

# ==================== 6. Agent 产出验证（agent） ====================
if [ "$MODE" = "agent" ]; then
  echo ""
  echo "🤖 Agent 产出检查..."

  # 检查是否有未提交的改动
  if [ -n "$(git status --porcelain)" ]; then
    fail "agent 有未提交的改动"
    git status --short
  else
    pass "工作区干净"
  fi

  # 显示最近 commit
  LAST_COMMIT=$(git log -1 --pretty=format:"%s" 2>/dev/null || echo "无 commit")
  info "最近 commit: $LAST_COMMIT"
fi

# ==================== 7. 日记检查（push） ====================
if [ "$MODE" = "push" ]; then
  echo ""
  echo "📔 日记检查..."
  DIARY_DIR="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyVault/日记/$(date +%Y)/$(date +%m)"
  TODAY=$(date +%Y-%m-%d)
  DIARY_FILE="$DIARY_DIR/$TODAY.md"

  if [ -f "$DIARY_FILE" ]; then
    pass "日记已写：$DIARY_FILE"
  else
    fail "今天的日记还没写：$DIARY_FILE"
  fi
fi

# ==================== 结果汇总 ====================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}❌ 质量门禁失败（$ERRORS 个错误，$WARNINGS 个警告）${NC}"
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  echo -e "${YELLOW}⚠️  质量门禁通过（$WARNINGS 个警告，不阻塞）${NC}"
  exit 0
else
  echo -e "${GREEN}🎉 质量门禁全部通过${NC}"
  exit 0
fi
