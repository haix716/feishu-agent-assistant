#!/bin/bash
# check-tests.sh：检查改动文件是否有测试，没有则自动派 agent 写

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# 获取本次改动的 src/ 下的 .ts 文件（排除 .d.ts 和 index.ts）
CHANGED_FILES=$(git diff --name-only HEAD~1..HEAD -- 'src/**/*.ts' | grep -v '\.d\.ts$' | grep -v 'index\.ts$' || true)

if [ -z "$CHANGED_FILES" ]; then
  echo "✅ 没有改动的源文件，跳过测试检查"
  exit 0
fi

echo "📋 检查以下文件的测试覆盖："
echo "$CHANGED_FILES"
echo ""

# 检查每个文件是否有对应的测试
MISSING_TESTS=""
for src_file in $CHANGED_FILES; do
  # 提取模块名：src/image-gen/providers/libtv.ts -> libtv
  module_name=$(basename "$src_file" .ts)

  # 检查是否存在对应的测试文件
  test_file="tests/${module_name}.test.ts"
  if [ ! -f "$test_file" ]; then
    MISSING_TESTS="$MISSING_TESTS $src_file"
    echo "  ❌ $src_file -> $test_file（缺失）"
  else
    echo "  ✅ $src_file -> $test_file"
  fi
done

if [ -z "$MISSING_TESTS" ]; then
  echo ""
  echo "✅ 所有改动文件都有测试覆盖"
  exit 0
fi

echo ""
echo "⚠️  以下文件缺少测试："
for f in $MISSING_TESTS; do
  echo "   - $f"
done
echo ""

# 尝试用 Claude Code agent 写测试
if command -v claude &> /dev/null; then
  echo "🤖 派测试 agent 写测试..."
  for src_file in $MISSING_TESTS; do
    module_name=$(basename "$src_file" .ts)
    test_file="tests/${module_name}.test.ts"

    echo "   为 $src_file 写测试..."
    claude -p "@tester 为以下文件写测试：$src_file。测试文件路径：$test_file。只写测试，不要改源代码。写完后运行 npm test 确保通过。" --allowedTools "Read,Write,Edit,Bash" 2>&1 || true
  done

  echo ""
  echo "🧪 重新运行测试..."
  npm test
else
  echo "❌ Claude Code CLI 未安装，无法自动写测试"
  echo "   请手动为以下文件写测试："
  for f in $MISSING_TESTS; do
    module_name=$(basename "$f" .ts)
    echo "   - tests/${module_name}.test.ts"
  done
  echo ""
  echo "   或运行：claude @tester 为 $MISSING_TESTS 写测试"
  exit 1
fi
