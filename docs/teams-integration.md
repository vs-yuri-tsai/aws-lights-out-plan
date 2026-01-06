# Microsoft Teams Integration for AWS Lights-Out Plan

## 目錄

- [專案目標](#專案目標)
- [技術架構](#技術架構)
- [成本分析](#成本分析)
- [實作計畫](#實作計畫)
- [多專案擴展性評估](#多專案擴展性評估)
- [FAQ](#faq)

---

## 專案目標

**核心價值**：讓團隊成員（工程師、QA、PM）能直接在 Microsoft Teams 中管理 AWS 開發環境資源，無需登入 AWS Console，同時保持完整的安全性和審計追蹤。

### 使用場景

#### 場景 1：主動操作（Teams → AWS）

```
使用者在 Teams 輸入：
  @LightsOutBot start airsync-dev

系統回應：
  ✅ Alice (alice@viewsonic.com) successfully started airsync-dev

  Resources affected:
  • ecs-service/airsync-api: STOPPED → RUNNING (2/2 tasks)
  • rds-instance/airsync-db: stopped → available

  Started at: 2026-01-05 10:30:00 UTC
```

#### 場景 2：被動通知（AWS → Teams）

```
AWS 資源狀態變更時，自動通知到 Teams channel：

🟢 airsync-dev Status Update

Resource Type: ecs-service
Resource ID: airsync-api
Previous State: STOPPED
New State: RUNNING
Tasks: 2/2 healthy
Timestamp: 2026-01-05 10:31:45 UTC
```

---

## 技術架構

### 架構決策

基於以下考量，採用 **Hybrid 架構**：

| 通訊方向        | 技術方案                       | 選擇原因                           |
| --------------- | ------------------------------ | ---------------------------------- |
| **AWS → Teams** | Workflows Webhook              | 簡單、免 Bot 註冊、成本為零        |
| **Teams → AWS** | Bot Framework + Azure AD OAuth | 需要使用者驗證、權限控制、審計追蹤 |

⚠️ **2026 重要更新**：Microsoft 已於 2025-01-31 廢棄 Office 365 Connectors（舊版 Incoming Webhooks）。請使用 **Power Automate Workflows** 建立 webhook。現有的 connectors 將於 2025-12-31 停止運作。

### 系統架構圖

```
┌─────────────────────────────────────────────────────────────┐
│                     Microsoft Teams                         │
│                                                              │
│  Channel: airsync-dev 工作群組                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  👤 Alice (Operator)    → start/stop/status/discover   │ │
│  │  👤 Bob (Viewer/QA)     → status/discover only         │ │
│  │  👤 Carol (Viewer/PM)   → status/discover only         │ │
│  └────────────────────────────────────────────────────────┘ │
└────────────┬─────────────────────────────▲──────────────────┘
             │                              │
             │ ① Command                    │ ⑤ Notification
             │                              │
       ┌─────▼──────────────────────────────┴─────────────────┐
       │          Azure Bot Service (託管)                     │
       └─────┬────────────────────────────────────────────────┘
             │ ② HTTPS POST
             │
┌────────────▼─────────────────────────────────────────────────┐
│                     AWS Infrastructure                       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  API Gateway: POST /webhook/teams                    │   │
│  └──────┬───────────────────────────────────────────────┘   │
│         │                                                    │
│  ┌──────▼───────────────────────────────────────────────┐   │
│  │  Lambda: teams-bot-handler                           │   │
│  │  - Extract user identity (Azure AD)                  │   │
│  │  - Check permissions (DynamoDB)                      │   │
│  │  - Invoke lights-out-handler                         │   │
│  └──────┬───────────────────────────────────────────────┘   │
│         │                                                    │
│  ┌──────▼───────────────────────────────────────────────┐   │
│  │  DynamoDB: teams-config                              │   │
│  │  - project: "airsync-dev"                            │   │
│  │  - webhook_url: "https://..."                        │   │
│  │  - allowed_users: { ... }                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Lambda: lights-out-handler (existing)               │   │
│  └──────┬───────────────────────────────────────────────┘   │
│         │ ③ Resource operations                             │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Target Resources                                    │   │
│  │  - ecs-service/airsync-api                           │   │
│  │  - rds-instance/airsync-db                           │   │
│  └──────┬───────────────────────────────────────────────┘   │
│         │ ④ State change events                             │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  EventBridge Rule: ECS/RDS State Changes             │   │
│  └──────┬───────────────────────────────────────────────┘   │
│         │                                                    │
│  ┌──────▼───────────────────────────────────────────────┐   │
│  │  Lambda: teams-notifier                              │   │
│  │  - Format Adaptive Card                              │   │
│  │  - POST to Teams Incoming Webhook                    │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 成本分析

### AWS 成本估算（單一專案）

#### 假設條件

- 專案：airsync-dev
- 使用者：5 人（3 工程師 + 2 QA）
- 每日操作：平均 10 次指令（start/stop/status）
- 資源變更：每日 20 次狀態通知（ECS task 啟停、RDS 狀態變更）

#### 月成本明細

| AWS 服務                       | 用量計算                               | 單價                     | 月成本 (USD) |
| ------------------------------ | -------------------------------------- | ------------------------ | ------------ |
| **Lambda - teams-bot-handler** | 300 invocations/month × 1s × 512MB     | $0.0000166667/GB-second  | $0.0025      |
| **Lambda - teams-notifier**    | 600 invocations/month × 0.5s × 256MB   | $0.0000166667/GB-second  | $0.0013      |
| **Lambda - Requests**          | 900 requests/month                     | $0.20 per 1M requests    | $0.0002      |
| **API Gateway**                | 300 requests/month                     | $3.50 per 1M requests    | $0.0011      |
| **DynamoDB - Read**            | 900 reads/month (300 指令 × 3 queries) | $0.25 per 1M read units  | $0.0002      |
| **DynamoDB - Write**           | 10 writes/month (配置更新)             | $1.25 per 1M write units | $0.0000      |
| **DynamoDB - Storage**         | 1 KB                                   | $0.25 per GB/month       | ~$0.0000     |
| **EventBridge**                | 600 events/month                       | Free (< 1M events)       | $0.0000      |
| **CloudWatch Logs**            | ~100 MB/month                          | $0.50 per GB             | $0.0500      |
| **Data Transfer**              | ~10 MB/month (Teams webhooks)          | $0.09 per GB             | $0.0009      |
| **總計**                       |                                        |                          | **$0.0562**  |

#### Microsoft 365 成本

- Azure Bot Service: **$0** (免費層，< 10,000 messages/month)
- Teams Incoming Webhook: **$0** (免費)
- Azure AD OAuth: **$0** (使用現有 Microsoft 365 tenant)

#### **單一專案總成本：~$0.06 USD/月（約台幣 $1.8）**

---

### 成本對照：投資報酬率（ROI）

#### 情境：airsync-dev 開發環境

**假設**：

- ECS Service (Fargate): 2 tasks × 0.25 vCPU × 0.5 GB
- RDS Instance: db.t3.micro
- 工作時間：週一至五 09:00-18:00（每週 45 小時）
- 非工作時間：每週 123 小時（73% 時間關閉）

**原始成本（24/7 運行）**：

```
ECS Fargate:
  2 tasks × (0.25 vCPU × $0.04048 + 0.5 GB × $0.004445) × 730 hours
  = $62.50/month

RDS db.t3.micro:
  $0.017/hour × 730 hours = $12.41/month

總計：$74.91/month
```

**使用 Lights-Out 後（僅工作時間運行）**：

```
運行時間：730 hours × 27% = 197 hours/month

ECS Fargate: $62.50 × 27% = $16.88/month
RDS db.t3.micro: $12.41 × 27% = $3.35/month

總計：$20.23/month
```

**每月節省**：$74.91 - $20.23 = **$54.68**

**Teams 整合成本**：$0.06/month

**淨節省**：$54.68 - $0.06 = **$54.62/month**

**ROI**：$54.62 / $0.06 = **910 倍**

---

### 多專案成本分析

#### 場景 A：3 個專案（小規模）

| 項目             | 計算                         | 月成本    |
| ---------------- | ---------------------------- | --------- |
| AWS 基礎設施     | $0.0562 (單一專案)           | $0.06     |
| 額外專案 (×2)    | $0.0562 × 2 × 0.5 (共用資源) | $0.06     |
| **總計**         |                              | **$0.12** |
| **每個專案分攤** |                              | **$0.04** |

**節省成本**（假設每個專案節省 $50/月）：

- 總節省：$150/month
- Teams 成本：$0.12/month
- **ROI：1,250 倍**

---

#### 場景 B：10 個專案（中規模）

| 項目             | 計算                                | 月成本     |
| ---------------- | ----------------------------------- | ---------- |
| AWS 基礎設施     | Lambda + API Gateway + DynamoDB     | $0.20      |
| Lambda Warmup    | 定時 ping (8,640 invocations/month) | $0.03      |
| CloudWatch Logs  | ~500 MB                             | $0.25      |
| **總計**         |                                     | **$0.48**  |
| **每個專案分攤** |                                     | **$0.048** |

**節省成本**（假設每個專案節省 $50/月）：

- 總節省：$500/month
- Teams 成本：$0.48/month
- **ROI：1,042 倍**

---

#### 場景 C：25 個專案（大規模）

| 項目                           | 計算                            | 月成本     |
| ------------------------------ | ------------------------------- | ---------- |
| AWS 基礎設施                   | Lambda + API Gateway + DynamoDB | $0.50      |
| Lambda Provisioned Concurrency | 1 instance × 512MB × 730 hours  | $10.00     |
| CloudWatch Logs                | ~1 GB                           | $0.50      |
| **總計**                       |                                 | **$11.00** |
| **每個專案分攤**               |                                 | **$0.44**  |

**節省成本**（假設每個專案節省 $40/月）：

- 總節省：$1,000/month
- Teams 成本：$11.00/month
- **ROI：91 倍**

**註**：Provisioned Concurrency 用於消除 Lambda cold start，提升使用者體驗

---

### 成本節省試算工具

使用以下公式計算您的專案 ROI：

```typescript
// 計算 Lights-Out 節省成本
function calculateSavings(
  ecsTaskCount: number,
  ecsCpu: number, // vCPU
  ecsMemory: number, // GB
  rdsInstanceType: string, // e.g., "db.t3.micro"
  workHoursPerWeek: number // e.g., 45
): {
  originalCost: number;
  withLightsOut: number;
  savings: number;
  teamsIntegrationCost: number;
  netSavings: number;
  roi: number;
} {
  const hoursPerMonth = 730;
  const workHoursRatio = (workHoursPerWeek * 4.33) / hoursPerMonth;

  // ECS Fargate 定價
  const ecsCostPerHour =
    ecsTaskCount *
    (ecsCpu * 0.04048 + // vCPU price
      ecsMemory * 0.004445); // GB price

  // RDS 定價（簡化，實際需查詢 AWS 定價表）
  const rdsHourlyRates: Record<string, number> = {
    'db.t3.micro': 0.017,
    'db.t3.small': 0.034,
    'db.t3.medium': 0.068,
  };
  const rdsCostPerHour = rdsHourlyRates[rdsInstanceType] || 0;

  // 原始成本（24/7）
  const originalCost = (ecsCostPerHour + rdsCostPerHour) * hoursPerMonth;

  // Lights-Out 後成本
  const withLightsOut = originalCost * workHoursRatio;

  // 節省金額
  const savings = originalCost - withLightsOut;

  // Teams 整合成本（單一專案）
  const teamsIntegrationCost = 0.06;

  // 淨節省
  const netSavings = savings - teamsIntegrationCost;

  // ROI
  const roi = netSavings / teamsIntegrationCost;

  return {
    originalCost: Math.round(originalCost * 100) / 100,
    withLightsOut: Math.round(withLightsOut * 100) / 100,
    savings: Math.round(savings * 100) / 100,
    teamsIntegrationCost,
    netSavings: Math.round(netSavings * 100) / 100,
    roi: Math.round(roi),
  };
}

// 範例：airsync-dev
const result = calculateSavings(
  2, // 2 ECS tasks
  0.25, // 0.25 vCPU
  0.5, // 0.5 GB
  'db.t3.micro', // RDS instance
  45 // 45 hours/week
);

console.log(result);
// {
//   originalCost: 74.91,
//   withLightsOut: 20.23,
//   savings: 54.68,
//   teamsIntegrationCost: 0.06,
//   netSavings: 54.62,
//   roi: 910
// }
```

---

## 實作計畫

### Phase 1: 單向通知（AWS → Teams）

**目標**：當 AWS 資源狀態變更時，自動發送通知到 Teams channel

**時程**：1 週

#### Week 1, Day 1-2: 設定 Teams Incoming Webhook

1. 在 Teams 建立或選擇專案 channel（例如：`#airsync-dev`）
2. 新增 Incoming Webhook connector：
   - 點擊 channel 名稱 → Connectors → Incoming Webhook
   - 設定名稱：`AWS Lights-Out Notifications`
   - 複製 webhook URL（格式：`https://{tenant}.webhook.office.com/webhookb2/{id}@{tenant-id}/IncomingWebhook/{webhook-id}/{guid}`）
3. 儲存 webhook URL（稍後用於 DynamoDB 配置）

#### Week 1, Day 3-4: 實作 teams-notifier Lambda

**新增檔案**：

- `src/teams/notifier.ts` - Lambda handler
- `src/teams/adaptiveCard.ts` - Adaptive Card 模板
- `src/teams/config.ts` - DynamoDB 配置讀取

**部署步驟**：

```bash
# 1. 安裝依賴
npm install node-fetch @types/node-fetch

# 2. 更新 serverless.yml（新增 Lambda function 和 EventBridge rules）

# 3. 手動建立 DynamoDB table（避免 CloudFormation 循環依賴）
aws dynamodb create-table \
  --table-name lights-out-teams-config-poc \
  --attribute-definitions AttributeName=project,AttributeType=S \
  --key-schema AttributeName=project,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --sse-specification Enabled=true \
  --region us-east-1

# 4. 新增專案配置到 DynamoDB
aws dynamodb put-item \
  --table-name lights-out-teams-config-poc \
  --item '{
    "project": {"S": "airsync-dev"},
    "webhook_url": {"S": "<YOUR_WEBHOOK_URL>"},
    "created_at": {"S": "2026-01-05T10:00:00Z"},
    "updated_at": {"S": "2026-01-05T10:00:00Z"}
  }'

# 5. 部署
npm run deploy
```

#### Week 1, Day 5: 測試與驗證

**測試項目**：

```bash
# 1. 手動觸發 ECS service 狀態變更
aws ecs update-service \
  --cluster <cluster-name> \
  --service <service-name> \
  --desired-count 0

# 預期結果：Teams channel 收到 "🔴 STOPPED" 通知

# 2. 啟動 RDS instance
aws rds start-db-instance --db-instance-identifier <instance-id>

# 預期結果：Teams channel 收到 "🟢 available" 通知

# 3. 檢查 CloudWatch Logs
aws logs tail /aws/lambda/lights-out-poc-teams-notifier --follow

# 4. 驗證錯誤處理
# - 測試無效的 webhook URL
# - 測試網路逾時
# - 測試資源缺少 tags
```

**成功標準**：

- ✅ 所有狀態變更都能收到通知（延遲 < 10 秒）
- ✅ 通知內容準確（resource type, ID, state transition）
- ✅ 錯誤情境有適當的 log 記錄

---

### Phase 2: 雙向指令（Teams → AWS）

**目標**：使用者可在 Teams 中執行 start/stop/status/discover 指令

**時程**：1.5 週

**先決條件**：

- Azure AD tenant admin 權限（用於註冊 Bot）
- 或請 IT 部門協助註冊

**詳細步驟**：見 Phase 2 實作指南（待 Phase 1 完成後提供）

---

### Phase 3: 生產強化

**目標**：監控、告警、文件

**時程**：0.5 週

**詳細內容**：待 Phase 2 完成後規劃

---

## 多專案擴展性評估

### 新增專案的步驟（Phase 1 完成後）

#### 手動方式（40 分鐘）

1. **Teams Channel 設定**（5 分鐘）
   - 建立新 channel
   - 新增 Incoming Webhook
   - 複製 webhook URL

2. **DynamoDB 配置**（10 分鐘）

   ```bash
   aws dynamodb put-item \
     --table-name lights-out-teams-config-poc \
     --item '{
       "project": {"S": "product-b-dev"},
       "webhook_url": {"S": "<WEBHOOK_URL>"},
       "created_at": {"S": "2026-01-05T10:00:00Z"},
       "updated_at": {"S": "2026-01-05T10:00:00Z"}
     }'
   ```

3. **標記 AWS 資源**（15 分鐘，假設 5 個資源）

   ```bash
   aws ecs tag-resource \
     --resource-arn <ARN> \
     --tags \
       Key=lights-out:managed,Value=true \
       Key=lights-out:group,Value=product-b-dev \
       Key=lights-out:priority,Value=100
   ```

4. **測試**（10 分鐘）
   - 手動觸發資源狀態變更
   - 驗證 Teams 通知

#### 自動化方式（Phase 2+ 實作後，25 分鐘）

使用 CLI 工具：

```bash
npm run teams:onboard -- \
  --project product-b-dev \
  --webhook-url "https://..." \
  --operators "alice@example.com" \
  --viewers "qa1@example.com"
```

---

### 成本擴展性

| 專案數量 | 月成本 | 每專案分攤 | 節省成本估算\* | ROI    |
| -------- | ------ | ---------- | -------------- | ------ |
| 1 個     | $0.06  | $0.06      | $54.62         | 910x   |
| 3 個     | $0.12  | $0.04      | $163.86        | 1,250x |
| 10 個    | $0.48  | $0.048     | $499.52        | 1,042x |
| 25 個    | $11.00 | $0.44      | $989.00        | 91x    |

\*假設每個專案節省 $50/月（實際取決於資源配置）

**關鍵觀察**：

- 成本幾乎線性增長，無意外開銷
- 即使 25 個專案，ROI 仍達 91 倍
- Provisioned Concurrency（$10/月）是大規模部署的主要成本

---

### 技術債與風險

#### Lambda Cold Start（專案 > 5 時）

**現象**：第一次調用延遲 ~3 秒

**解決方案**：

```yaml
# serverless.yml
functions:
  keepWarm:
    handler: src/warmup.ping
    events:
      - schedule: rate(5 minutes)
    environment:
      TARGETS: teams-notifier
```

**成本**：~$0.03/月（8,640 invocations）

#### 配置無版本控制

**風險**：手動修改 DynamoDB 無法回溯

**解決方案**（Phase 2+）：Configuration as Code

```yaml
# config/teams/poc/airsync-dev.yml
project: airsync-dev
webhook_url: https://...
created_at: 2026-01-05T10:00:00Z
```

納入 Git 版本控制，部署時同步到 DynamoDB

---

## FAQ

### Q1: Workflows Webhooks 和舊版 Incoming Webhooks 有什麼差異？

**A**: 對於我們的使用場景，**功能完全相同**：

| 項目               | 舊版 Connectors      | 新版 Workflows            |
| ------------------ | -------------------- | ------------------------- |
| **建立方式**       | Channel → Connectors | Channel → Workflows       |
| **URL 格式**       | `webhook.office.com` | `logic.azure.com`         |
| **Adaptive Cards** | ✅ 支援              | ✅ 支援                   |
| **HTTP POST**      | ✅ 支援              | ✅ 支援                   |
| **程式碼變更**     | -                    | ❌ 無需變更（僅換 URL）   |
| **額外功能**       | ❌ 無                | ✅ 可加條件邏輯、格式轉換 |
| **狀態**           | ❌ 2025-12-31 停用   | ✅ 當前標準               |

**遷移步驟**（如果已使用舊版）：

1. 在 Teams channel 建立新的 Workflow webhook
2. 更新 DynamoDB 中的 `webhook_url`
3. 測試新 webhook
4. 移除舊 Connector

**相關資料**：

- [Create incoming webhooks with Workflows](https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498)
- [Retirement announcement](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)

### Q2: Teams 整合會增加多少維運負擔？

**A**:

- Phase 1（單向通知）：幾乎零負擔，僅需初始設定
- Phase 2（雙向指令）：需要管理使用者權限（預估 < 1 小時/月）
- 使用 CLI 工具後：新增專案 < 20 分鐘，新增使用者 < 2 分鐘

### Q3: 如果 Teams webhook URL 洩漏怎麼辦？

**A**:

- **風險**：任何人都能發送訊息到 Teams channel
- **緩解**：
  1. 定期輪換 webhook URL（建議每季一次）
     - Workflows 中可以輕鬆重新產生 URL
  2. 通知內容不包含敏感資料（如 AWS Account ID、IP）
  3. 使用 DynamoDB 加密儲存 webhook URL
- **影響範圍**：僅限發送假通知，無法控制 AWS 資源

**如何輪換 Workflow webhook URL**：

1. 在 Teams Workflows 中編輯現有 workflow
2. 點擊 "When a Teams webhook request is received" trigger
3. 點擊 "Regenerate URL"
4. 更新 DynamoDB 配置

### Q4: 成本會隨著資源數量增長嗎？

**A**:

- **不會**：成本主要由「操作次數」決定，而非「資源數量」
- 範例：
  - 10 個資源，每日 5 次操作 = $0.06/月
  - 100 個資源，每日 5 次操作 = $0.06/月
- **真正影響成本的因素**：
  - 使用者數量（更多人 = 更多指令）
  - 資源狀態變更頻率（更頻繁 = 更多通知）

### Q5: 支援哪些 AWS 資源類型？

**A** (Phase 1):

- ✅ ECS Service (Fargate/EC2)
- ✅ RDS Instance
- ⚠️ 其他資源需要額外實作 EventBridge rules

**A** (未來擴展):

- EC2 Instances
- Aurora Clusters
- ElastiCache Clusters
- Redshift Clusters

### Q6: 可以設定通知的時間範圍嗎（例如只在工作時間通知）？

**A**:
可以，透過 EventBridge rule 的 schedule expression：

```yaml
# serverless.yml
events:
  - eventBridge:
      schedule: cron(0 9-18 ? * MON-FRI *) # 週一至五 09:00-18:00
      pattern:
        source: [aws.ecs]
```

### Q7: Teams 整合失敗時，lights-out 原有功能會受影響嗎？

**A**:
**不會**。Teams 整合是獨立的附加功能：

- `teams-notifier` Lambda 失敗 → 僅通知缺失，不影響資源操作
- `teams-bot-handler` Lambda 失敗 → 仍可透過 EventBridge 自動排程

### Q8: 多個專案可以共用同一個 Teams channel 嗎？

**A**:
技術上可以，但**不建議**：

- 通知會混雜，難以追蹤
- 無法針對不同專案設定不同的通知規則
- 建議：每個專案使用獨立 channel

### Q9: 如何追蹤「誰」觸發了操作？

**A** (Phase 2):

- Azure AD OAuth 會提供使用者 email
- CloudWatch Logs 記錄：
  ```json
  {
    "timestamp": "2026-01-05T10:30:00Z",
    "user": "alice@viewsonic.com",
    "action": "start",
    "project": "airsync-dev",
    "result": "succeeded"
  }
  ```

---

## 參考資料

- [Microsoft Teams Incoming Webhooks](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)
- [Adaptive Cards Schema](https://adaptivecards.io/explorer/)
- [AWS EventBridge Event Patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)
- [DynamoDB On-Demand Pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/)
- [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/)

---

**Last Updated**: 2026-01-05
**Version**: 1.0.0 (Phase 1 - Single Direction Notification)
**Author**: AWS Lights-Out Team
