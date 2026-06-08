#!/bin/bash
# premortem.sh：代码风险预检
# 在问题发生之前，扫描代码变更中的风险模式
# 用法：premortem.sh [staged|all]
#   staged — 只检查 staged 的变更（默认，用于 commit）
#   all    — 检查整个 src/ 目录

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

MODE="${1:-staged}"
RISKS=()
WARNINGS=()

add_risk() {
  local severity="$1"
  local category="$2"
  local message="$3"
  local file="${4:-}"
  RISKS+=("${severity}|${category}|${message}|${file}")
}

add_warning() {
  WARNINGS+=("$1")
}

# 获取要检查的代码
if [ "$MODE" = "staged" ]; then
  DIFF=$(git diff --cached -- . ':!scripts/' ':!tests/' ':!*.md' 2>/dev/null || true)
  ADDED_LINES=$(echo "$DIFF" | grep "^+" | grep -v "^+++" || true)
  FILES=$(git diff --cached --name-only -- '*.ts' 2>/dev/null || true)
else
  DIFF=""
  ADDED_LINES=""
  FILES=$(find src -name "*.ts" -not -name "*.d.ts" 2>/dev/null || true)
fi

if [ -z "$FILES" ]; then
  echo -e "${GREEN}✅ 没有需要检查的文件${NC}"
  exit 0
fi

echo -e "${BLUE}🔍 Pre-mortem 风险预检（${MODE} 模式）${NC}"
echo ""

# ==================== 1. 安全风险 ====================
echo "  扫描安全风险..."

# 1a. 硬编码密钥
if echo "$ADDED_LINES" | grep -qiE "(api_key|api_secret|token|password|secret)\s*[:=]\s*['\"][^'\"]{8,}" 2>/dev/null; then
  if ! echo "$ADDED_LINES" | grep -qE "(process\.env|config\.|ENV|getenv)" 2>/dev/null; then
    add_risk "HIGH" "SECURITY" "可能硬编码了密钥 — 应使用环境变量"
  fi
fi

# 1b. 用户输入注入
if echo "$ADDED_LINES" | grep -qE "(exec|eval|spawn|child_process)" 2>/dev/null; then
  if ! echo "$ADDED_LINES" | grep -qE "(sanitize|escape|validate)" 2>/dev/null; then
    add_risk "HIGH" "SECURITY" "使用了 exec/eval/spawn — 确保用户输入已消毒"
  fi
fi

# 1c. 日志泄露敏感信息
if echo "$ADDED_LINES" | grep -qE "console\.(log|error|warn).*\b(token|key|secret|password|auth)\b" 2>/dev/null; then
  add_risk "MEDIUM" "SECURITY" "日志中可能包含敏感信息 — 确保不打印密钥/token"
fi

# ==================== 2. 错误处理风险 ====================
echo "  扫描错误处理风险..."

# 2a. async 函数没有 try-catch
for file in $FILES; do
  if [ -f "$file" ]; then
    # 找 export async function
    ASYNC_FUNCS=$(grep -n "export async function\|async function" "$file" 2>/dev/null || true)
    if [ -n "$ASYNC_FUNCS" ]; then
      while IFS= read -r line; do
        LINE_NUM=$(echo "$line" | cut -d: -f1)
        # 检查接下来 30 行有没有 try
        BLOCK=$(sed -n "${LINE_NUM},$((LINE_NUM + 30))p" "$file" 2>/dev/null)
        if ! echo "$BLOCK" | grep -q "try" 2>/dev/null; then
          FUNC_NAME=$(echo "$line" | sed 's/.*function //' | sed 's/(.*//')
          add_risk "MEDIUM" "ERROR_HANDLING" "async function ${FUNC_NAME}() 没有 try-catch — 未捕获的异常会导致静默失败" "$file:$LINE_NUM"
        fi
      done <<< "$ASYNC_FUNCS"
    fi
  fi
done

# 2b. catch 块为空
if echo "$ADDED_LINES" | grep -qE "catch\s*\{?\s*\}" 2>/dev/null; then
  add_risk "MEDIUM" "ERROR_HANDLING" "空 catch 块 — 错误被静默吞掉，调试时无信息"
fi

# 2c. catch 块只有注释
if echo "$ADDED_LINES" | grep -qE "catch\s*\{?\s*//.*\}" 2>/dev/null; then
  add_risk "LOW" "ERROR_HANDLING" "catch 块只有注释 — 考虑至少 log 错误"
fi

# ==================== 3. 并发/状态风险 ====================
echo "  扫描并发风险..."

# 3a. Map/共享状态无锁保护
if echo "$ADDED_LINES" | grep -qE "new Map|\.set\(|\.get\(" 2>/dev/null; then
  if echo "$ADDED_LINES" | grep -qE "async" 2>/dev/null; then
    if ! echo "$ADDED_LINES" | grep -qE "mutex|lock|semaphore|running" 2>/dev/null; then
      add_risk "MEDIUM" "CONCURRENCY" "在 async 函数中操作共享 Map — 可能有竞态条件"
    fi
  fi
fi

# 3b. 无 await 的 Promise
if echo "$ADDED_LINES" | grep -qE "new Promise" 2>/dev/null; then
  if ! echo "$ADDED_LINES" | grep -qE "await|\.then|\.catch" 2>/dev/null; then
    add_risk "MEDIUM" "CONCURRENCY" "创建了 Promise 但没有 await — 可能是 fire-and-forget"
  fi
fi

# ==================== 4. 资源泄漏风险 ====================
echo "  扫描资源泄漏风险..."

# 4a. 文件操作无关闭
if echo "$ADDED_LINES" | grep -qE "\.open\(|\.createReadStream|\.createWriteStream" 2>/dev/null; then
  if ! echo "$ADDED_LINES" | grep -qE "\.close\(|\.end\(|with |finally" 2>/dev/null; then
    add_risk "MEDIUM" "RESOURCE_LEAK" "文件操作没有关闭 — 可能泄漏文件描述符"
  fi
fi

# 4b. 定时器无清理
if echo "$ADDED_LINES" | grep -qE "setInterval|setTimeout" 2>/dev/null; then
  if ! echo "$ADDED_LINES" | grep -qE "clearInterval|clearTimeout" 2>/dev/null; then
    add_risk "LOW" "RESOURCE_LEAK" "创建了定时器但没有清理机制"
  fi
fi

# ==================== 5. API 调用风险 ====================
echo "  扫描 API 调用风险..."

# 5a. 网络请求无超时
if echo "$ADDED_LINES" | grep -qE "fetch\(|axios\.|\.request\(" 2>/dev/null; then
  if ! echo "$ADDED_LINES" | grep -qE "timeout|AbortController|signal" 2>/dev/null; then
    add_risk "MEDIUM" "API_CALL" "网络请求没有设置超时 — 可能无限等待"
  fi
fi

# 5b. 无限重试
if echo "$ADDED_LINES" | grep -qE "while.*true|for\s*\(\s*;\s*;\s*\)" 2>/dev/null; then
  if echo "$ADDED_LINES" | grep -qE "retry|重试" 2>/dev/null; then
    add_risk "HIGH" "API_CALL" "可能有无限重试循环 — 确保有退出条件"
  fi
fi

# 5c. 无速率限制的循环 API 调用
if echo "$ADDED_LINES" | grep -qE "for.*await|while.*await" 2>/dev/null; then
  if echo "$ADDED_LINES" | grep -qE "larkService|fetch\(|axios" 2>/dev/null; then
    if ! echo "$ADDED_LINES" | grep -qE "delay|sleep|throttle|rate" 2>/dev/null; then
      add_risk "MEDIUM" "API_CALL" "循环中调用 API 无延迟 — 可能触发频率限制"
    fi
  fi
fi

# ==================== 6. 数据处理风险 ====================
echo "  扫描数据处理风险..."

# 6a. JSON.parse 无 try-catch
if echo "$ADDED_LINES" | grep -qE "JSON\.parse" 2>/dev/null; then
  # 检查附近的行是否有 try
  PARSE_LINES=$(echo "$ADDED_LINES" | grep -n "JSON\.parse" | cut -d: -f1 || true)
  if [ -n "$PARSE_LINES" ]; then
    add_risk "LOW" "DATA_HANDLING" "JSON.parse 没有在 try-catch 中 — 非法 JSON 会导致崩溃"
  fi
fi

# 6b. 数组越界无检查
if echo "$ADDED_LINES" | grep -qE "\[0\]|\[1\]|\[2\]" 2>/dev/null; then
  if ! echo "$ADDED_LINES" | grep -qE "\.length|\.find|\.filter|\?" 2>/dev/null; then
    add_risk "LOW" "DATA_HANDLING" "直接访问数组固定索引 — 可能越界"
  fi
fi

# ==================== 7. 飞书项目特有风险 ====================
echo "  扫描项目特有风险..."

# 7a. 飞书 API 调用无频率限制处理
if echo "$ADDED_LINES" | grep -qE "larkService\.|lark\." 2>/dev/null; then
  if ! echo "$ADDED_LINES" | grep -qE "230020|rate.limit|throttle|pThrottle" 2>/dev/null; then
    add_warning "飞书 API 调用 — 确保有频率限制处理（错误码 230020）"
  fi
fi

# 7b. 图片处理无大小限制
if echo "$ADDED_LINES" | grep -qE "getResource|download|buffer" 2>/dev/null; then
  if echo "$ADDED_LINES" | grep -qE "image|图片" 2>/dev/null; then
    if ! echo "$ADDED_LINES" | grep -qE "size|length|limit|max|validateFileSize" 2>/dev/null; then
      add_warning "下载文件/图片 — 确保有大小限制，防止 OOM"
    fi
  fi
fi

# ==================== 输出结果 ====================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HIGH_COUNT=0
MEDIUM_COUNT=0
LOW_COUNT=0

for risk in "${RISKS[@]}"; do
  IFS='|' read -r severity category message file <<< "$risk"
  case "$severity" in
    HIGH)   echo -e "${RED}🔴 [HIGH] ${category}: ${message}${NC}"; HIGH_COUNT=$((HIGH_COUNT + 1)) ;;
    MEDIUM) echo -e "${YELLOW}🟡 [MEDIUM] ${category}: ${message}${NC}"; MEDIUM_COUNT=$((MEDIUM_COUNT + 1)) ;;
    LOW)    echo -e "${GREEN}🟢 [LOW] ${category}: ${message}${NC}"; LOW_COUNT=$((LOW_COUNT + 1)) ;;
  esac
  if [ -n "$file" ]; then
    echo -e "   ${BLUE}→ ${file}${NC}"
  fi
done

for warning in "${WARNINGS[@]}"; do
  echo -e "${YELLOW}⚠️  ${warning}${NC}"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ${#RISKS[@]} -eq 0 ] && [ ${#WARNINGS[@]} -eq 0 ]; then
  echo -e "${GREEN}✅ Pre-mortem 未发现风险${NC}"
  exit 0
fi

echo -e "发现 ${RED}${HIGH_COUNT} 个高风险${NC} / ${YELLOW}${MEDIUM_COUNT} 个中风险${NC} / ${GREEN}${LOW_COUNT} 个低风险${NC}"

if [ $HIGH_COUNT -gt 0 ]; then
  echo ""
  echo -e "${RED}❌ 有高风险项，请修复后再提交${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}⚠️  有风险项但不阻塞提交，建议评估后修复${NC}"
exit 0
