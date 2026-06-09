#!/bin/bash
# update-memory.sh：自动更新 memory 文件
# 用法：update-memory.sh
#
# 功能：
#   1. 从 git log 生成 project.md（最近 7 天的 feat/fix）
#   2. 更新 MEMORY.md 索引
#   3. 清理过时的引用
#
# 设计原则：
#   - Memory 只存不能从 git 自动获取的信息
#   - 项目状态从 git log 自动生成
#   - 减少手动维护负担

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

MEMORY_DIR="$HOME/.claude/projects/-Users-hxy-Documents-------claude-bot/memory"
PROJECT_FILE="$MEMORY_DIR/project.md"
MEMORY_INDEX="$MEMORY_DIR/MEMORY.md"

# 颜色
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}更新 memory 文件...${NC}"

# ==================== 1. 生成 project.md ====================
echo -e "${BLUE}生成 project.md...${NC}"

# 读当前版本
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

# 读最近 7 天的 feat/fix/refactor commit
RECENT_CHANGES=$(git log --since="7 days ago" --pretty=format:"%ad %s" --date=short 2>/dev/null | grep -E "^(20[0-9]{2}-[0-9]{2}-[0-9]{2}) (feat|fix|refactor)" || echo "")

# 按日期分组
if [ -n "$RECENT_CHANGES" ]; then
  # 按日期分组并格式化
  FORMATTED_CHANGES=$(echo "$RECENT_CHANGES" | awk '
  {
    date = $1
    msg = substr($0, index($0, " ") + 1)
    if (date != prev_date) {
      if (prev_date != "") print ""
      print "### " date
      prev_date = date
    }
    print "- " msg
  }')
else
  FORMATTED_CHANGES="- 最近 7 天没有 feat/fix/refactor 改动"
fi

# 写入 project.md
cat > "$PROJECT_FILE" << EOF
---
name: project
description: 项目当前状态（自动从 git log 生成）
metadata:
  type: project
  auto-generated: true
---

## 当前版本

${VERSION}

## 最近 7 天改动

${FORMATTED_CHANGES}

## 关键功能

- 图片生成（ComfyUI、Replicate、即梦、LibTV）
- 详情图套件（8 张图）
- RAG 搜索
- 文件处理
- 质量门禁（pre-commit + pre-push）

**Why:** 项目状态从 git log 自动生成，不需要手动维护
**How to apply:** 查询项目状态时看这个文件，不要猜
EOF

echo -e "${GREEN}✅ project.md 已更新${NC}"

# ==================== 2. 更新 MEMORY.md 索引 ====================
echo -e "${BLUE}更新 MEMORY.md 索引...${NC}"

# 扫描 memory 目录，生成索引
INDEX_CONTENT=""
for file in "$MEMORY_DIR"/*.md; do
  if [ "$(basename "$file")" = "MEMORY.md" ]; then
    continue
  fi

  filename=$(basename "$file" .md)

  # 读取 description
  description=$(grep "^description:" "$file" 2>/dev/null | head -1 | sed 's/^description: *//' || echo "")

  if [ -n "$description" ]; then
    INDEX_CONTENT="${INDEX_CONTENT}- [${filename}](${filename}.md) — ${description}\n"
  fi
done

# 写入 MEMORY.md
cat > "$MEMORY_INDEX" << EOF
$(echo -e "$INDEX_CONTENT")
EOF

echo -e "${GREEN}✅ MEMORY.md 索引已更新${NC}"

# ==================== 3. 检查过时引用 ====================
echo -e "${BLUE}检查过时引用...${NC}"

# 检查 memory 文件中引用的文件路径是否还存在
for file in "$MEMORY_DIR"/*.md; do
  if [ "$(basename "$file")" = "MEMORY.md" ] || [ "$(basename "$file")" = "project.md" ]; then
    continue
  fi

  # 提取文件路径引用（简单检查）
  grep -oE '`[^`]+\.(ts|js|sh|json|md)`' "$file" 2>/dev/null | tr -d '`' | while read -r ref; do
    if [ ! -f "$PROJECT_ROOT/$ref" ]; then
      echo "⚠️  $(basename "$file") 引用了不存在的文件: $ref"
    fi
  done
done

echo -e "${GREEN}✅ 引用检查完成${NC}"

echo ""
echo -e "${GREEN}🎉 Memory 更新完成${NC}"
