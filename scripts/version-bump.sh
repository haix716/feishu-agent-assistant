#!/bin/bash
# version-bump.sh：版本管理脚本
# 用法：version-bump.sh [major|minor|patch] [描述]
#
# 功能：
#   1. 更新 package.json 版本号
#   2. 更新 CHANGELOG.md（插入新版本条目）
#   3. git commit + tag
#   4. 提醒更新飞书开发者后台版本号
#
# 设计原则：
#   - package.json 是唯一真相源
#   - 其他地方的版本号从 package.json 派生
#   - 发版流程标准化，减少手动操作

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

# ==================== 参数校验 ====================
BUMP_TYPE="${1:-}"
DESCRIPTION="${2:-}"

if [ -z "$BUMP_TYPE" ] || ! echo "$BUMP_TYPE" | grep -qE "^(major|minor|patch)$"; then
  echo -e "${RED}用法: version-bump.sh [major|minor|patch] [描述]${NC}"
  echo ""
  echo "  major - 主版本号（破坏性变更）"
  echo "  minor - 次版本号（新功能）"
  echo "  patch - 补丁号（bug 修复）"
  echo ""
  echo "示例:"
  echo "  version-bump.sh minor '添加 ComfyUI 集成'"
  echo "  version-bump.sh patch '修复图片生成超时'"
  exit 1
fi

if [ -z "$DESCRIPTION" ]; then
  echo -e "${YELLOW}⚠️  未提供描述，将使用默认描述${NC}"
  DESCRIPTION="版本更新"
fi

# ==================== 读取当前版本 ====================
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${BLUE}当前版本: ${CURRENT_VERSION}${NC}"

# 解析版本号
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# 计算新版本
case "$BUMP_TYPE" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TODAY=$(date +%Y-%m-%d)

echo -e "${GREEN}新版本: ${NEW_VERSION}${NC}"
echo ""

# ==================== 确认 ====================
echo -e "${YELLOW}将执行以下操作:${NC}"
echo "  1. 更新 package.json: ${CURRENT_VERSION} → ${NEW_VERSION}"
echo "  2. 更新 CHANGELOG.md: 插入 [${NEW_VERSION}] 条目"
echo "  3. git commit + tag v${NEW_VERSION}"
echo "  4. 提醒更新飞书开发者后台"
echo ""
read -p "确认继续? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "已取消"
  exit 0
fi

# ==================== 更新 package.json ====================
echo ""
echo -e "${BLUE}更新 package.json...${NC}"
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
pkg.version = '${NEW_VERSION}';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo -e "${GREEN}✅ package.json 已更新${NC}"

# ==================== 更新 CHANGELOG.md ====================
echo ""
echo -e "${BLUE}更新 CHANGELOG.md...${NC}"

CHANGELOG_FILE="CHANGELOG.md"
if [ ! -f "$CHANGELOG_FILE" ]; then
  echo -e "${RED}❌ CHANGELOG.md 不存在${NC}"
  exit 1
fi

# 检查是否已有 Unreleased 部分
if head -20 "$CHANGELOG_FILE" | grep -q "## \[Unreleased\]"; then
  # 在 Unreleased 后面插入新版本
  sed -i '' "/## \[Unreleased\]/a\\
\\
## [${NEW_VERSION}] - ${TODAY}\\
\\
### ✨ Added\\
\\
- ${DESCRIPTION}\\
" "$CHANGELOG_FILE"
else
  # 在文件开头插入
  TEMP_FILE=$(mktemp)
  cat > "$TEMP_FILE" << EOF
# Changelog

## [Unreleased]

_无_

## [${NEW_VERSION}] - ${TODAY}

### ✨ Added

- ${DESCRIPTION}

EOF
  # 跳过原文件的开头，追加剩余内容
  tail -n +2 "$CHANGELOG_FILE" >> "$TEMP_FILE"
  mv "$TEMP_FILE" "$CHANGELOG_FILE"
fi

echo -e "${GREEN}✅ CHANGELOG.md 已更新${NC}"

# ==================== 版本一致性校验 ====================
echo ""
echo -e "${BLUE}校验版本一致性...${NC}"
CHANGELOG_VERSION=$(grep -oE '^\#\# \[([0-9]+\.[0-9]+\.[0-9]+)\]' "$CHANGELOG_FILE" | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')

if [ "$CHANGELOG_VERSION" != "$NEW_VERSION" ]; then
  echo -e "${RED}❌ 版本不一致: package.json=${NEW_VERSION}, CHANGELOG.md=${CHANGELOG_VERSION}${NC}"
  exit 1
fi
echo -e "${GREEN}✅ 版本一致: ${NEW_VERSION}${NC}"

# ==================== Git 操作 ====================
echo ""
echo -e "${BLUE}Git commit + tag...${NC}"
git add package.json package-lock.json CHANGELOG.md
git commit -m "release: v${NEW_VERSION} - ${DESCRIPTION}"
git tag "v${NEW_VERSION}"

echo -e "${GREEN}✅ Git commit 和 tag 已创建${NC}"

# ==================== 提醒 ====================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}🎉 版本 ${NEW_VERSION} 发布完成！${NC}"
echo ""
echo -e "${YELLOW}📋 请手动完成以下操作:${NC}"
echo "  1. 更新飞书开发者后台的智能体应用版本号为 ${NEW_VERSION}"
echo "  2. 同步 Obsidian 版本记录（如果需要）"
echo ""
echo -e "${BLUE}推送命令:${NC}"
echo "  git push && git push --tags"
echo ""
