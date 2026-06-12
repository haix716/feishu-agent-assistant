#!/bin/bash
# 通过飞书 API 发送通知消息给晓燕
# 用法: bash scripts/notify-feishu.sh "消息内容"

set -euo pipefail

MSG="${1:?用法: bash scripts/notify-feishu.sh \"消息内容\"}"

# 加载环境变量
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env 文件不存在: $ENV_FILE" >&2
  exit 1
fi

# 读取 .env 变量
APP_ID=$(grep "^APP_ID=" "$ENV_FILE" | cut -d= -f2)
APP_SECRET=$(grep "^APP_SECRET=" "$ENV_FILE" | cut -d= -f2)
LARK_DOMAIN=$(grep "^LARK_DOMAIN=" "$ENV_FILE" | cut -d= -f2)
USER_ID=$(grep "^DAILY_PUSH_USER_ID=" "$ENV_FILE" | cut -d= -f2)

if [ -z "$USER_ID" ]; then
  echo "❌ 未配置 DAILY_PUSH_USER_ID" >&2
  exit 1
fi

LARK_DOMAIN="${LARK_DOMAIN:-https://open.feishu.cn}"

# 用 python3 完成整个发送流程（避免 shell JSON 转义地狱）
python3 -c "
import json, urllib.request, urllib.error, sys

app_id = '$APP_ID'
app_secret = '$APP_SECRET'
domain = '$LARK_DOMAIN'
user_id = '$USER_ID'
msg = '''$MSG'''

# 1. 获取 token
token_req = urllib.request.Request(
    f'{domain}/open-apis/auth/v3/tenant_access_token/internal',
    data=json.dumps({'app_id': app_id, 'app_secret': app_secret}).encode(),
    headers={'Content-Type': 'application/json'},
)
token_resp = json.loads(urllib.request.urlopen(token_req).read())
token = token_resp['tenant_access_token']

# 2. 发送消息
body = json.dumps({
    'receive_id': user_id,
    'msg_type': 'text',
    'content': json.dumps({'text': msg}),
}).encode()

msg_req = urllib.request.Request(
    f'{domain}/open-apis/im/v1/messages?receive_id_type=open_id',
    data=body,
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
)
msg_resp = json.loads(urllib.request.urlopen(msg_req).read())

if msg_resp.get('code') == 0:
    print('✅ 消息已发送')
else:
    print(f\"❌ 发送失败: {json.dumps(msg_resp, ensure_ascii=False)}\", file=sys.stderr)
    sys.exit(1)
"
