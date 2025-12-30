# Configuration Files

此目錄包含各環境的 Lights Out 配置檔案。

## 檔案結構

```ini
config/
├── README.md                      # 本檔案
├── sss-lab.yml                    # sss-lab 環境配置（單一 Lambda 模式）
└── pg-development/                # pg-development 帳號（多專案模式）
    └── airsync-dev.yml           # AirSync 開發環境

```

**部署模式說明：**

- **單一 Lambda 模式**：根目錄的 YAML 檔（如 `sss-lab.yml`），一個帳號只有一個 Lambda
- **多專案模式**：子目錄結構（如 `pg-development/`），一個帳號部署多個獨立 Lambda，每個專案/服務有自己的配置

## 配置檔案格式

每個環境需要獨立的 YAML 配置檔案，檔名必須與 `serverless.yml` 中的 `stage` 名稱一致。

### 範例：sss-lab.yml

```yaml
version: "1.0"
environment: sss-lab

regions:
  - ap-southeast-1
  - ap-northeast-1

discovery:
  method: tags
  tags:
    lights-out:managed: "true"
    lights-out:env: sss-lab
  resource_types:
    - ecs:service
    - rds:db

resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300

    # Auto Scaling 整合（推薦）
    autoScaling:
      minCapacity: 2      # START 時的最小容量
      maxCapacity: 6      # START 時的最大容量
      desiredCount: 3     # START 時的目標數量

    # Legacy 模式（無 Auto Scaling 時使用）
    defaultDesiredCount: 1
    stopBehavior:
      mode: "scale_to_zero"  # 預設：完全關閉
      # mode: "reduce_by_count"  # 逐步驗證：每次減少 N 個
      # reduceByCount: 1
      # mode: "reduce_to_count"  # 設定固定數量
      # reduceToCount: 1
  rds-db:
    skipFinalSnapshot: true
    waitTimeout: 600

schedules:
  default:
    timezone: Asia/Taipei
    startTime: "09:00"
    stopTime: "19:00"
    activeDays:
      - MON
      - TUE
      - WED
      - THU
      - FRI
    holidays: []
```

## 欄位說明

### 必要欄位

- **version**: 配置格式版本（目前為 "1.0"）
- **environment**: 環境名稱（應與檔名一致）
- **discovery.method**: 資源發現方法（目前僅支援 "tags"）
- **discovery.tags**: Tag 過濾條件
- __discovery.resource_types__: 要管理的資源類型

### 可選欄位

- **regions**: 要掃描的 AWS regions（未指定時使用 Lambda 部署的 region）
- **resourceDefaults**: 各資源類型的預設行為
- **schedules**: 排程設定（目前由 EventBridge 管理，此欄位保留供未來使用）

### resource_defaults.ecs-service.autoScaling（推薦）

針對有 Application Auto Scaling 的 ECS Service，透過 MinCapacity/MaxCapacity 管理容量。

```yaml
resource_defaults:
  ecs-service:
    autoScaling:
      minCapacity: 2      # START 時設定的最小容量
      maxCapacity: 6      # START 時設定的最大容量
      desiredCount: 3     # START 時設定的目標容量
```

**運作邏輯:**

- **START 操作**: 設定 MinCapacity=2, MaxCapacity=6, desiredCount=3
- **STOP 操作**: 設定 MinCapacity=0, MaxCapacity=0, desiredCount=0（強制停止）

**驗證:**

```yaml
# autoScaling 配置會被 Zod schema 驗證
# - minCapacity <= maxCapacity
# - minCapacity <= desiredCount <= maxCapacity
```

**條件式偵測:**

- 如果 Service 沒有 Auto Scaling，會自動使用 legacy mode（`defaultDesiredCount` + `stopBehavior`）
- 如果 Service 有 Auto Scaling 但 config 缺少 `autoScaling` 欄位，會拋出錯誤

### resource_defaults.ecs-service.stopBehavior（Legacy 模式）

僅在**無 Auto Scaling** 的 Service 使用，支援三種模式：

#### 1. scale_to_zero（預設，向下相容）

完全關閉服務，設定 desiredCount 為 0。

```yaml
stopBehavior:
  mode: "scale_to_zero"
```

#### 2. reduce_by_count（逐步驗證模式）

每次執行減少指定數量，適合分階段驗證影響。

```yaml
stopBehavior:
  mode: "reduce_by_count"
  reduceByCount: 1  # 每次減少 1 個 task
```

**範例：** 如果服務當前 desiredCount 為 3

- 第一次執行 stop：3 → 2
- 第二次執行 stop：2 → 1
- 第三次執行 stop：1 → 0

**注意：** 不會低於 0（會自動 floor 至 0）

#### 3. reduce_to_count（固定目標模式）

設定為固定數量，保留最小運行實例。

```yaml
stopBehavior:
  mode: "reduce_to_count"
  reduceToCount: 1  # 停止時保留 1 個 task
```

**使用場景：** 需要保留一個實例處理背景任務或監控

## 部署流程

### 單一 Lambda 模式部署（sss-lab）

```bash
pnpm deploy:sss-lab
# 等同於：serverless deploy --stage sss-lab
```

Serverless Framework 會自動：

1. 讀取 `config/sss-lab.yml`
2. Lambda 函數名稱：`lights-out-sss-lab`
3. SSM Parameter 路徑：`/lights-out/sss-lab/config`

### 多專案模式部署（pg-development）

每個專案/服務部署獨立的 Lambda：

```bash
# 部署 AirSync 開發環境
pnpm deploy:airsync-dev
# 等同於：serverless deploy --stage pg-development-airsync-dev
```

每個 Lambda：

- 函數名稱：`lights-out-{stage}`（例如：`lights-out-pg-development-airsync-dev`）
- SSM Parameter：`/lights-out/{stage}/config`
- 配置檔案：`config/pg-development/airsync-dev.yml`
- 獨立排程、獨立權限、獨立資源管理

### 新增專案到多專案模式

**步驟 1：建立配置檔案**

```bash
# 建立新專案配置
cp config/pg-development/airsync-dev.yml config/pg-development/new-service-dev.yml

# 編輯配置
vim config/pg-development/new-service-dev.yml
```

**步驟 2：更新 serverless.yml**

在 `custom.resolveConfigPath` 中新增映射：

```yaml
custom:
  resolveConfigPath:
    pg-development-new-service-dev: pg-development/new-service-dev.yml
```

**步驟 3：更新 package.json**

新增部署腳本：

```json
{
  "scripts": {
    "deploy:pg-new": "serverless deploy --stage pg-development-new-service-dev"
  }
}
```

**步驟 4：標記 AWS 資源**

為需要管理的 ECS Service 加上 tags：

```bash
aws ecs tag-resource \
  --resource-arn arn:aws:ecs:ap-northeast-1:ACCOUNT:service/CLUSTER/SERVICE \
  --tags \
    lights-out:managed=true \
    lights-out:project=new-service-dev
```

**步驟 5：部署**

```bash
pnpm deploy:pg-new
```

## 修改配置

### 方式 1：修改配置檔案後重新部署（推薦）

```bash
# 1. 編輯配置檔案
vim config/sss-lab.yml

# 2. 重新部署（會自動更新 SSM）
pnpm deploy
```

**優點：**

- ✅ 配置變更有 Git history
- ✅ 透過 Code Review 確保正確性
- ✅ 可回滾到任意版本

### 方式 2：直接修改 SSM Parameter（不推薦）

```bash
# 手動更新 SSM（僅測試用）
aws ssm put-parameter \
  --name "/lights-out/config" \
  --value file://config/sss-lab.yml \
  --overwrite \
  --region ap-southeast-1
```

**缺點：**

- ❌ 無版本控制
- ❌ 與 Git 中的配置不同步
- ❌ 下次部署會被覆蓋

## ECS Auto Scaling 配置指南

### 何時使用 autoScaling 配置？

**使用場景:**

- ECS Service 已配置 Application Auto Scaling
- Service 有 target tracking scaling policy 或 step scaling policy
- 希望 Lambda 與 Auto Scaling policy 協同運作

**檢查方式:**

```bash
# 檢查 Service 是否有 Auto Scaling
aws application-autoscaling describe-scalable-targets \
  --service-namespace ecs \
  --resource-ids service/{cluster-name}/{service-name} \
  --scalable-dimension ecs:service:DesiredCount
```

如果回傳結果有 `ScalableTargets`，表示 Service 有 Auto Scaling。

### autoScaling vs defaultDesiredCount 優先級

**優先級規則:**

1. **Runtime 偵測**: Lambda 執行時會先偵測 Service 是否有 Auto Scaling
2. **有 Auto Scaling**: 使用 `autoScaling` 配置（如果缺少會拋出錯誤）
3. **無 Auto Scaling**: 使用 `defaultDesiredCount` + `stopBehavior`

**範例配置（同時提供兩者）:**

```yaml
resource_defaults:
  ecs-service:
    # Auto Scaling mode（優先使用）
    autoScaling:
      minCapacity: 2
      maxCapacity: 6
      desiredCount: 3

    # Legacy mode（fallback）
    defaultDesiredCount: 1
    stopBehavior:
      mode: scale_to_zero
```

這樣配置的好處：

- 有 Auto Scaling 的 Service 使用 autoScaling 配置
- 無 Auto Scaling 的 Service 使用 defaultDesiredCount
- 同一個 Lambda 可以管理混合模式的 Services

### 設定 Auto Scaling 後的預期行為

**START 操作:**

```bash
# Lambda 執行
aws lambda invoke --function-name lights-out-{stage}-handler \
  --payload '{"action":"start"}' out.json

# CloudWatch Logs 應顯示
# "Detected Auto Scaling configuration" (minCapacity=2, maxCapacity=6)
# "Managing service via Auto Scaling"
# "Service started via Auto Scaling (min=2, max=6, desired=3)"
```

**STOP 操作:**

```bash
# Lambda 執行
aws lambda invoke --function-name lights-out-{stage}-handler \
  --payload '{"action":"stop"}' out.json

# CloudWatch Logs 應顯示
# "Detected Auto Scaling configuration" (minCapacity=2, maxCapacity=6)
# "Managing service via Auto Scaling"
# "Service stopped via Auto Scaling (was 3)"
```

**驗證 AWS Console:**

- ECS Service → Auto Scaling → MinCapacity/MaxCapacity 應正確
- ECS Service → Desired count 應正確
- 等待 10-15 分鐘，確認 Auto Scaling policy 不會將 desired count 調整回原值

## 常見問題

### Q: 為什麼配置檔案中的 `tags` 與 `resource_types` 使用底線？

A: 這是為了符合 TypeScript 程式碼中的命名慣例（snake_case）。Serverless Framework 會將 YAML 直接序列化為字串上傳到 SSM，Lambda 再用 js-yaml 解析。

### Q: Service 有 Auto Scaling 但 config 沒有 autoScaling 欄位會如何？

A: Lambda 會拋出錯誤並返回失敗結果：

```json
{
  "success": false,
  "error": "Service has Auto Scaling but config lacks autoScaling settings. Please add resource_defaults.ecs-service.autoScaling to config."
}
```

**解決方法:** 在配置檔案中新增 `autoScaling` 欄位。

### Q: 如何遷移現有配置到 Auto Scaling 模式？

A: 分三步驟：

**步驟 1: 檢查現有 Auto Scaling 設定**

```bash
aws application-autoscaling describe-scalable-targets \
  --service-namespace ecs \
  --resource-ids service/{cluster}/{service} \
  --scalable-dimension ecs:service:DesiredCount \
  --query 'ScalableTargets[0].{Min:MinCapacity,Max:MaxCapacity}'
```

**步驟 2: 更新配置檔案**

```yaml
resource_defaults:
  ecs-service:
    autoScaling:
      minCapacity: {從步驟 1 取得}
      maxCapacity: {從步驟 1 取得}
      desiredCount: {期望的啟動數量}
```

**步驟 3: 重新部署**

```bash
pnpm deploy:{stage}
pnpm {stage}:set-config
```

### Q: 可以在配置檔案中使用 Serverless 變數嗎？

A: 不建議。`${file(...)}` 會將整個檔案內容讀取為字串，內部的 Serverless 變數不會被解析。如需動態值，在配置檔案中使用佔位符，在程式碼中處理。

### Q: 如何驗證配置檔案格式正確？

A: 使用 YAML linter：

```bash
# 安裝 yamllint
pip install yamllint

# 驗證配置
yamllint config/sss-lab.yml
```

或在 Lambda 中使用 Zod schema 驗證（已在 `src/core/config.ts` 中實作）。

## 相關文件

- [AGENTS.md](../AGENTS.md) - 技術規格與 API 文件
- [serverless.yml](../serverless.yml) - 部署配置
- [src/core/config.ts](../src/core/config.ts) - 配置載入與驗證
