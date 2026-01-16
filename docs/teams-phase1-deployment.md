# Phase 1 部署指南：Teams 單向通知

詳細的 Teams 單向通知部署步驟。

> **快速參考**：如果你已熟悉流程，請參考 [teams-integration.md](./teams-integration.md) 的精簡版本。

---

## 前置檢查

- [x] 已完成 lights-out 基礎專案部署
- [x] 有 Microsoft Teams 存取權限
- [x] AWS CLI 已設定 SSO credentials
- [x] Node.js 20.x 已安裝

```bash
# 驗證環境
aws sts get-caller-identity
node --version  # v20.x.x
```

---

## Step 1：設定 Teams Workflow Webhook

### 1.1 建立 Workflow

1. 開啟 Microsoft Teams
2. 選擇專案 channel（例如：`#airsync-dev`）
3. 點擊 channel 名稱旁的 `...` → **Workflows**
4. 搜尋：**"Post to a channel when a webhook request is received"**
5. 點擊 **Add workflow**
6. 配置：
   - **Who can trigger**: `Anyone`
   - **Post as**: `Flow bot`
   - **Team/Channel**: 選擇當前 channel
7. 儲存後，複製 **HTTP POST URL**

### 1.2 測試 Webhook（可選）

```bash
WEBHOOK_URL="https://prod-XX.logic.azure.com/..."

curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "message",
    "attachments": [{
      "contentType": "application/vnd.microsoft.card.adaptive",
      "content": {
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [{"type": "TextBlock", "text": "Test message"}]
      }
    }]
  }'
```

---

## Step 2：更新 YAML 配置

### 2.1 編輯專案配置檔案

```bash
# 編輯對應專案的配置檔案
# config/{account}/{project}.yml
```

加入 Teams 通知設定：

```yaml
notifications:
  teams:
    enabled: true
    webhook_url: 'https://prod-XX.logic.azure.com/...'
    description: 'Lights Out notifications'
```

### 2.2 上傳配置到 SSM

```bash
pnpm config
# 選擇目標環境 → Upload

✅ Configuration uploaded to SSM!
```

---

## Step 3：部署 Lambda

```bash
pnpm deploy
# 選擇目標環境 → All
```

部署完成後應該看到：

```
functions:
  handler: lights-out-{stage}
  teamsNotifier: lights-out-{stage}-teams-notifier
```

---

## Step 4：測試通知

### 確認資源 Tags

```bash
aws ecs describe-services \
  --cluster <cluster> \
  --services <service> \
  --query 'services[0].tags'

# 必須包含：
# - lights-out:managed = true
# - lights-out:group = airsync-dev
```

### 觸發狀態變更

```bash
# 停止 service
aws ecs update-service \
  --cluster <cluster> \
  --service <service> \
  --desired-count 0

# 等待 30-60 秒，Teams 應收到通知

# 恢復 service
aws ecs update-service \
  --cluster <cluster> \
  --service <service> \
  --desired-count 1
```

---

## 問題排查

### 沒有收到通知

```bash
# 檢查 Lambda logs
aws logs tail /aws/lambda/lights-out-{stage}-teams-notifier \
  --follow \
  --region <region>
```

常見錯誤：

- `No Teams config found for project` → 檢查 SSM 配置中的 `notifications.teams` 設定
- `Resource missing lights-out:group tag` → 檢查資源 tags
- `Teams webhook request failed` → 檢查 webhook URL

### SSM 配置錯誤

確認配置已正確上傳：

```bash
pnpm config
# 選擇目標環境 → Retrieve（下載檢視）
```

重新上傳配置：

```bash
pnpm config
# 選擇目標環境 → Upload
```

---

## 擴展到其他專案

1. 在新專案的 Teams channel 建立 Workflow webhook
2. 在 `config/{account}/{project}.yml` 中加入 `notifications.teams` 設定
3. 執行 `pnpm config` → Upload 上傳配置
4. 為新專案的資源加上 `lights-out:group=<project-name>` tag
5. 測試通知

---

## 相關文件

- [teams-integration.md](./teams-integration.md) - 架構概覽
- [deployment-guide.md](./deployment-guide.md) - 基礎部署指南
