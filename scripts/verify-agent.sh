#!/bin/bash
# SubagentStop hook：验证 agent 产出
# 委托给 quality-gate.sh agent 模式

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$PROJECT_ROOT/scripts/quality-gate.sh" agent
