# Phase 1 部署指南：Teams 單向通知

本指南將帶你完成 **Phase 1: AWS → Teams 單向通知** 的完整部署流程。

---

## 📋 前置檢查

### 必要條件

- ✅ 已完成 lights-out 基礎專案部署（有可運作的 `lights-out-poc` Lambda）
- ✅ 有 Microsoft Teams 存取權限（能建立 channel 和新增 connector）
- ✅ AWS CLI 已設定 SSO credentials
- ✅ Node.js 20.x 已安裝

### 驗證環境

```bash
# 檢查 AWS credentials
aws sts get-caller-identity

# 檢查 Node.js 版本
node --version  # 應該是 v20.x.x

# 檢查專案依賴
cd /path/to/aws-lights-out-plan
npm install
```

---

## 步驟 1：設定 Teams Incoming Webhook（10 分鐘）

### 1.1 建立或選擇 Teams Channel

1. 開啟 Microsoft Teams
2. 選擇現有的專案 channel（例如：`#airsync-dev`）
   - 或建立新的 channel：點擊團隊名稱 → `...` → `Add channel`

### 1.2 建立 Workflow Webhook（2026 新方法）

⚠️ **重要**：Microsoft 已於 2025-01-31 廢棄 Office 365 Connectors。請使用 Workflows 取代。

**步驟**：

1. 點擊 channel 名稱旁的 `...` → 選擇 **`Workflows`**
2. 搜尋模板：**"Post to a channel when a webhook request is received"**
3. 點擊 **"Add workflow"**
4. 配置 Workflow：
   - **Who can trigger**: 選擇 `Anyone`（允許 AWS Lambda 調用）
   - **Post as**: `Flow bot`
   - **Post in**: `Channel`
   - **Team**: 選擇你的團隊
   - **Channel**: 選擇當前 channel
5. 點擊 **"Save"**
6. **重要**：回到 "When a Teams webhook request is received" 區塊，複製 **HTTP POST URL**

**Webhook URL 格式範例**：

```
https://prod-XX.westus.logic.azure.com:443/workflows/abc123.../triggers/manual/paths/invoke?...
```

**與舊版 Connectors 的差異**：

- ✅ 功能完全相同（支援 Adaptive Cards）
- ✅ 程式碼無需修改，僅需替換 URL
- ✅ 更好的安全性和可擴展性

⚠️ **安全提示**：此 URL 相當於 API key，請妥善保管，不要 commit 到 Git。

### 1.3 測試 Webhook（可選）

使用 curl 測試 workflow webhook 是否正常：

```bash
# 替換成你的 workflow webhook URL
WEBHOOK_URL="https://prod-XX.westus.logic.azure.com:443/workflows/..."

curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "message",
    "attachments": [{
      "contentType": "application/vnd.microsoft.card.adaptive",
      "content": {
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [{
          "type": "TextBlock",
          "text": "🧪 Testing webhook connection..."
        }]
      }
    }]
  }'
```

**預期結果**：Teams channel 應該會收到測試訊息。

---

## 步驟 2：建立 DynamoDB Table 與專案配置（3 分鐘）

⭐ **新功能**：現在可以使用自動化腳本，不需手動執行 AWS CLI 指令！

### 2.1 建立 DynamoDB Table

使用統一的互動式介面：

```bash
npm run teams
```

**互動流程**：

1. 選擇 AWS profile (通過 `scripts/arguments/<project>.json` 自動配置)
2. 選擇操作：**Setup Database**
3. 確認配置
4. 自動建立 table 並等待 ACTIVE 狀態

**預期輸出**：

```
? Select target › airsync-dev (us-east-1)
? Teams Integration Management for airsync-dev › 🔧 Setup Database

🔑 Using AWS profile: pg-development
✅ SSO credentials exported successfully

🔧 Teams Integration - DynamoDB Setup

📋 Configuration:
   Table Name: lights-out-teams-config
   Region: us-east-1

? Proceed with DynamoDB table creation? › Yes

🚀 Creating DynamoDB table...

✅ Table created successfully!
   ARN: arn:aws:dynamodb:us-east-1:123456789012:table/lights-out-teams-config
   Status: CREATING

⏳ Waiting for table to become ACTIVE...
.....
✅ Table is now ACTIVE!
```

**重要**：DynamoDB table 名稱固定為 `lights-out-teams-config`（無 stage 後綴），每個 AWS account 只需一個 table。

### 2.2 新增專案配置

使用同樣的指令，選擇不同操作：

```bash
npm run teams
```

選擇操作：**Add Project**

**互動流程**：

1. 選擇 AWS profile
2. 輸入專案名稱（例如：`airsync-dev`）
3. 輸入 Teams Workflow webhook URL
4. 選擇是否測試 webhook（推薦）
5. 輸入描述（可選）
6. 確認並儲存

**預期輸出**：

```
? Select target › airsync-dev (us-east-1)
? Teams Integration Management for airsync-dev › ➕ Add Project

🔑 Using AWS profile: pg-development
✅ SSO credentials exported successfully

➕ Teams Integration - Add Project Configuration

🔍 Checking if table exists...
✅ Table found: lights-out-teams-config

📝 Project Configuration
? Enter project name: › airsync-dev
? Enter Teams Workflow webhook URL: › https://prod-XX.westus.logic.azure.com:443/workflows/...
? Test webhook URL before saving? › Yes

🧪 Testing webhook...
✅ Webhook test succeeded! Check your Teams channel for the test message.

? Enter optional description: › Airsync development environment notifications

📋 Configuration Summary:
   Table Name: lights-out-teams-config
   Project: airsync-dev
   Webhook: https://prod-XX.westus.logic.azure.com:443/workf...
   Description: Airsync development environment notifications
   Region: us-east-1

? Save this configuration to DynamoDB? › Yes

💾 Saving configuration...

✅ Configuration saved successfully!
```

### 2.3 驗證配置（可選）

列出所有已配置的專案：

```bash
npm run teams
```

選擇操作：**List Projects**

**預期輸出**：

```
? Select target › airsync-dev (us-east-1)
? Teams Integration Management for airsync-dev › 📋 List Projects

🔑 Using AWS profile: pg-development
✅ SSO credentials exported successfully

📋 Teams Integration - List Project Configurations

🔍 Fetching configurations from: lights-out-teams-config
   Region: us-east-1

✅ Found 1 project configuration(s):

1. airsync-dev
   Webhook: https://prod-XX.westus.logic.azure.com:443/workflows/abc123...
   Description: Airsync development environment notifications
   Created: 2026-01-05 10:30:00
```

---

<details>
<summary>🔧 進階：手動使用 AWS CLI（不建議）</summary>

如果需要手動操作，可以使用以下指令：

```bash
# 設定環境變數
export REGION="us-east-1"
export TABLE_NAME="lights-out-teams-config"

# 建立 table（固定名稱，無 stage 後綴）
aws dynamodb create-table \
  --table-name "${TABLE_NAME}" \
  --attribute-definitions AttributeName=project,AttributeType=S \
  --key-schema AttributeName=project,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --sse-specification Enabled=true,SSEType=KMS \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
  --region "$REGION" \
  --tags Key=project,Value=lights-out Key=managed-by,Value=script Key=component,Value=teams-integration

# 新增專案配置
PROJECT="airsync-dev"
WEBHOOK_URL="https://prod-XX.westus.logic.azure.com:443/workflows/..."

aws dynamodb put-item \
  --table-name "${TABLE_NAME}" \
  --item "{
    \"project\": {\"S\": \"${PROJECT}\"},
    \"webhook_url\": {\"S\": \"${WEBHOOK_URL}\"},
    \"description\": {\"S\": \"${PROJECT} project Teams notifications\"},
    \"created_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"},
    \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
  }" \
  --region "$REGION"
```

**注意**：每個 AWS account 只需要一個 DynamoDB table，不區分 stage。

</details>

---

## 步驟 3：安裝依賴與部署（10 分鐘）

### 3.1 安裝新的依賴

```bash
cd /path/to/aws-lights-out-plan

# 安裝依賴
npm install

# 驗證新依賴已安裝
npm list node-fetch @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

### 3.2 檢查程式碼

確認以下檔案已存在：

```bash
# 檢查 Teams 整合程式碼
ls -la src/teams/
# 應該看到：
# - adaptiveCard.ts
# - config.ts
# - notifier.ts

# 檢查 serverless.yml 已更新
grep -A 20 "teamsNotifier:" serverless.yml
```

### 3.3 型別檢查

```bash
# 執行 TypeScript 型別檢查
npm run type:check

# 如果有錯誤，請先修正再繼續
```

### 3.4 部署到 AWS

使用互動式 CLI 部署：

```bash
# 方式 1：使用互動式 CLI（推薦）
npm run deploy

# 選擇：
# 1. Environment: poc（或你的環境）
# 2. Deployment mode: Deploy all（完整部署）

# 方式 2：直接指定參數
STAGE=poc npm run deploy
```

**部署過程**：

```
Deploying lights-out to stage poc (us-east-1)

✔ Service deployed to stack lights-out-poc (142s)

functions:
  handler: lights-out-poc
  teamsNotifier: lights-out-poc-teams-notifier (new)

endpoints:
  None

Logs:
  handler: /aws/lambda/lights-out-poc
  teamsNotifier: /aws/lambda/lights-out-poc-teams-notifier (new)
```

### 3.5 驗證部署成功

```bash
# 檢查 Lambda functions
aws lambda list-functions \
  --query "Functions[?starts_with(FunctionName, 'lights-out-${STAGE}')].FunctionName" \
  --region "$REGION"

# 應該看到：
# - lights-out-poc
# - lights-out-poc-teams-notifier (新增)

# 檢查 EventBridge rules
aws events list-rules \
  --name-prefix "lights-out-${STAGE}" \
  --region "$REGION"
```

---

## 步驟 4：測試通知功能（15 分鐘）

### 4.1 確認 AWS 資源有正確的 tags

你的 ECS Service 或 RDS Instance 必須有以下 tags：

```bash
# 檢查 ECS Service tags
aws ecs describe-services \
  --cluster <cluster-name> \
  --services <service-name> \
  --query 'services[0].tags' \
  --region "$REGION"

# 必須包含：
# - lights-out:managed = true
# - lights-out:group = airsync-dev（或你的專案名稱）
```

如果缺少 tags，請新增：

```bash
# 為 ECS Service 加 tags
SERVICE_ARN="arn:aws:ecs:us-east-1:123456789012:service/cluster/service-name"

aws ecs tag-resource \
  --resource-arn "$SERVICE_ARN" \
  --tags \
    key=lights-out:managed,value=true \
    key=lights-out:group,value=airsync-dev \
    key=lights-out:priority,value=100 \
  --region "$REGION"

# 為 RDS Instance 加 tags
aws rds add-tags-to-resource \
  --resource-name "arn:aws:rds:us-east-1:123456789012:db:instance-name" \
  --tags \
    Key=lights-out:managed,Value=true \
    Key=lights-out:group,Value=airsync-dev \
    Key=lights-out:priority,Value=100 \
  --region "$REGION"
```

### 4.2 觸發資源狀態變更（測試通知）

#### 測試 ECS Service 通知

```bash
# 記錄目前的 desired count
aws ecs describe-services \
  --cluster <cluster-name> \
  --services <service-name> \
  --query 'services[0].desiredCount' \
  --region "$REGION"

# 停止 service
aws ecs update-service \
  --cluster <cluster-name> \
  --service <service-name> \
  --desired-count 0 \
  --region "$REGION"

# 等待 30-60 秒，檢查 Teams channel
# 應該會收到：🔴 airsync-dev Status Update (STOPPED)

# 恢復 service
aws ecs update-service \
  --cluster <cluster-name> \
  --service <service-name> \
  --desired-count 1 \
  --region "$REGION"

# 等待 30-60 秒，檢查 Teams channel
# 應該會收到：🟢 airsync-dev Status Update (RUNNING)
```

#### 測試 RDS Instance 通知

```bash
# 停止 RDS instance
aws rds stop-db-instance \
  --db-instance-identifier <instance-name> \
  --region "$REGION"

# 等待 2-3 分鐘，檢查 Teams channel
# 應該會收到：🔴 airsync-dev Status Update (stopped)

# 啟動 RDS instance
aws rds start-db-instance \
  --db-instance-identifier <instance-name> \
  --region "$REGION"

# 等待 2-3 分鐘，檢查 Teams channel
# 應該會收到：🟢 airsync-dev Status Update (available)
```

### 4.3 檢查 CloudWatch Logs

如果沒有收到通知，檢查 Lambda logs：

```bash
# 查看 teams-notifier 的最新 logs
aws logs tail /aws/lambda/lights-out-${STAGE}-teams-notifier \
  --follow \
  --region "$REGION"

# 常見問題檢查：
# ❌ "No Teams config found for project"
#    → 檢查 DynamoDB 配置是否正確
# ❌ "Resource missing lights-out:group tag"
#    → 檢查資源 tags
# ❌ "Teams webhook request failed"
#    → 檢查 webhook URL 是否正確
```

---

## 步驟 5：驗證與監控（10 分鐘）

### 5.1 設定 CloudWatch Alarms（建議）

```bash
# 建立 Lambda 錯誤告警
aws cloudwatch put-metric-alarm \
  --alarm-name "lights-out-${STAGE}-teams-notifier-errors" \
  --alarm-description "Teams notifier Lambda errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=lights-out-${STAGE}-teams-notifier \
  --region "$REGION"
```

### 5.2 驗證成本

部署後幾天，檢查實際成本：

```bash
# 查看 Lambda invocations（過去 7 天）
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=lights-out-${STAGE}-teams-notifier \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Sum \
  --region "$REGION"

# 查看 DynamoDB 讀取次數
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=lights-out-teams-config-${STAGE} \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Sum \
  --region "$REGION"
```

---

## 🎉 完成！

Phase 1 部署完成，你應該能看到：

✅ AWS 資源狀態變更時，Teams channel 自動收到通知
✅ 通知包含詳細資訊（resource type, ID, state transition）
✅ CloudWatch Logs 正常記錄執行過程
✅ 成本控制在 $0.06/月以內

---

## 📚 下一步

### 選項 A：擴展到其他專案

如果想在其他專案（例如 `product-b-dev`）啟用通知：

1. 在該專案的 Teams channel 建立 Workflow webhook
   - Channel → `...` → `Workflows`
   - 選擇 "Post to a channel when a webhook request is received"
   - 配置並儲存，複製 HTTP POST URL

2. 使用自動化腳本新增專案配置：

   ```bash
   npm run teams
   ```

   選擇操作：**Add Project**

   輸入專案名稱 `product-b-dev` 和 webhook URL，腳本會自動：
   - 驗證 webhook URL 格式
   - 測試 webhook 連線（可選）
   - 儲存配置到 DynamoDB
   - 顯示下一步指示

3. 為該專案的資源加上 tag（擇一）：

   ```bash
   # 方式 1: 使用 lights-out:group
   lights-out:group=product-b-dev

   # 方式 2: 使用 lights-out:env
   lights-out:env=product-b-dev

   # 方式 3: 使用 lights-out:project
   lights-out:project=product-b-dev
   ```

4. 測試通知（手動啟動/停止資源）

**查看所有已配置的專案**：

```bash
npm run teams  # 選擇 "List Projects"
```

### 選項 B：實作 Phase 2（雙向指令）

繼續實作 Teams → AWS 的指令功能，請參考 `docs/teams-integration.md` 的 Phase 2 章節。

---

## 🐛 常見問題排查

### 問題 1：沒有收到通知

**檢查清單**：

```bash
# 1. 確認 Lambda 有被觸發
aws logs filter-log-events \
  --log-group-name /aws/lambda/lights-out-${STAGE}-teams-notifier \
  --start-time $(($(date +%s) - 3600))000 \
  --region "$REGION"

# 2. 確認 EventBridge rule 已啟用
aws events describe-rule \
  --name lights-out-${STAGE}-teamsNotifier-rule-1 \
  --region "$REGION" \
  --query 'State'
# 應該是 "ENABLED"

# 3. 確認資源 tags 正確
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=lights-out:group,Values=airsync-dev \
  --region "$REGION"

# 4. 測試 webhook URL
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"text": "Test"}'
```

### 問題 2：Lambda 錯誤 "TEAMS_CONFIG_TABLE environment variable not set"

**原因**：Lambda 環境變數缺失

**解決**：

```bash
# 檢查 Lambda 環境變數
aws lambda get-function-configuration \
  --function-name lights-out-${STAGE}-teams-notifier \
  --query 'Environment.Variables' \
  --region "$REGION"

# 應該包含：
# {
#   "TEAMS_CONFIG_TABLE": "lights-out-teams-config-poc"
# }

# 如果缺失，重新部署
npm run deploy
```

### 問題 3：DynamoDB 權限錯誤

**錯誤訊息**：`AccessDeniedException: User is not authorized to perform: dynamodb:GetItem`

**原因**：Lambda IAM role 缺少 DynamoDB 權限

**解決**：

```bash
# 檢查 serverless.yml 是否包含 DynamoDB 權限
grep -A 5 "dynamodb:GetItem" serverless.yml

# 應該看到：
# - Effect: Allow
#   Action:
#     - dynamodb:GetItem
#     - dynamodb:Query
#   Resource: ...

# 重新部署
npm run deploy
```

### 問題 4：通知延遲過長（> 5 分鐘）

**可能原因**：

- EventBridge → Lambda 的非同步調用有 retry
- RDS 狀態變更事件本身較慢

**診斷**：

```bash
# 檢查 EventBridge 事件時間戳
aws logs filter-log-events \
  --log-group-name /aws/lambda/lights-out-${STAGE}-teams-notifier \
  --filter-pattern "EventBridge event received" \
  --region "$REGION"

# 比較 event.time 和實際資源變更時間
```

---

## 📞 需要協助？

- 技術問題：查看 `docs/teams-integration.md`
- Bug 回報：建立 GitHub Issue
- 成本問題：參考文件中的「成本分析」章節

---

**版本**: 1.0.0 (Phase 1)
**最後更新**: 2026-01-05
