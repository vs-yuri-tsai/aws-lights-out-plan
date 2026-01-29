# AWS Lights Out Resource Discovery

引導使用者探索 AWS 資源並產出 Lights Out 分析報告。

---

## 前置檢查

1. 確認當前目錄是 lights-out 專案目錄
   - 檢查是否存在 `serverless.yml` 或 `package.json` 含有 "lights-out"
   - 如果不是，顯示提醒並結束

---

## Step 1: 驗證 AWS Credentials

使用 `verify_credentials` 工具驗證 AWS 憑證。

**成功時顯示格式：**

```
AWS 帳號資訊：
- Account ID: {account}
- User/Role: {arn}
```

使用 AskUserQuestion 確認：

```
question: "確認要使用此 AWS 帳號進行資源探索嗎？"
options:
  - label: "確認，繼續"
    description: "使用目前的 AWS 憑證進行探索"
  - label: "切換 AWS Profile"
    description: "使用其他 AWS Profile"
```

**如果選擇切換 Profile：**

- 詢問使用者輸入 profile 名稱
- 重新執行 `verify_credentials` 並帶入 profile 參數

**失敗時：**

- 顯示錯誤訊息
- 引導使用者執行 `aws sso login --profile <profile-name>`
- 等待使用者確認已完成登入後再試一次

---

## Step 2: 選擇探索區域

使用 `list_available_regions` 取得完整區域列表。

使用 AskUserQuestion 讓用戶選擇：

```
question: "請選擇要探索的 AWS 區域"
multiSelect: true
options:
  - label: "ap-southeast-1 (Singapore)"
    description: "新加坡區域"
  - label: "ap-northeast-1 (Tokyo)"
    description: "東京區域"
  - label: "us-east-1 (N. Virginia)"
    description: "美東區域"
  - label: "其他區域"
    description: "手動輸入區域代碼"
```

---

## Step 3: 探索資源

並行執行：

- `discover_ecs_services(regions)`
- `discover_rds_instances(regions)`

**探索時顯示：**

```
正在探索 AWS 資源...
- 區域: {regions}
```

**完成後顯示摘要：**

```
發現的資源：
- ECS Services: {ecs_count} 個
- RDS Instances: {rds_count} 個
- 已配置 lights-out tags: {tagged_count} 個
```

如果沒有發現任何資源：

- 提示使用者可能的原因（region 選擇錯誤、權限不足等）
- 提供重新選擇 region 的選項

---

## Step 4: 生成報告

**按照以下固定模板生成報告：**

````markdown
# AWS Lights Out 資源探索報告

**生成時間：** {timestamp}
**AWS 帳號：** {account_id}
**探索區域：** {regions}

---

## 摘要

| 指標                 | 數值                |
| -------------------- | ------------------- |
| ECS Services         | {ecs_count}         |
| RDS Instances        | {rds_count}         |
| 已有 Lights Out Tags | {tagged_count}      |
| 建議納入管理         | {recommended_count} |

---

## ECS Services

| Region   | Cluster   | Service   | 狀態                | Auto Scaling | 風險等級          | Lights Out 支援                   |
| -------- | --------- | --------- | ------------------- | ------------ | ----------------- | --------------------------------- |
| {region} | {cluster} | {service} | {running}/{desired} | {yes/no}     | {low/medium/high} | {supported/caution/not-supported} |

### 高風險服務說明

{對於 high risk 的服務，列出原因和建議}

---

## RDS Instances

| Region   | Instance ID   | 引擎     | 狀態     | 類型                  | Lights Out 支援                           |
| -------- | ------------- | -------- | -------- | --------------------- | ----------------------------------------- |
| {region} | {instance_id} | {engine} | {status} | {標準/Aurora/Replica} | {supported/cluster-managed/not-supported} |

### 不支援的實例說明

{對於 not-supported 的實例，列出原因}

---

## Lights Out 支援程度對照

根據目前 Lights Out Lambda 的實作：

| 資源類型           | 支援程度    | 說明                                    |
| ------------------ | ----------- | --------------------------------------- |
| ECS Service        | ✅ 完全支援 | 支援 Auto Scaling 模式和 Direct 模式    |
| RDS DB Instance    | ✅ 完全支援 | Fire-and-forget 模式，支援 skipSnapshot |
| RDS Aurora Cluster | ❌ 不支援   | 需透過 cluster 啟停，目前未實作         |
| RDS Read Replica   | ❌ 不支援   | 無法獨立停止                            |

---

## 建議配置

### 建議納入 Lights Out 管理的資源

{列出 recommended 的資源和建議的 YAML 配置}

**建議 Tags：**

```yaml
lights-out:managed: 'true'
lights-out:env: 'dev'
lights-out:priority: '50'
```
````

**建議配置範例：**

```yaml
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      minCapacity: { min }
      maxCapacity: { max }
      desiredCount: { desired }
    stop:
      minCapacity: 0
      maxCapacity: 0
      desiredCount: 0

  rds-db:
    waitAfterCommand: 60
    skipSnapshot: true
```

### 需要注意的資源

{列出 caution 的資源和注意事項}

### 不建議納入的資源

{列出 not-recommended 的資源和原因}

---

## 下一步

1. 為建議的資源加上 Tags：

   ```bash
   # ECS Service
   aws ecs tag-resource \
     --resource-arn {arn} \
     --tags key=lights-out:managed,value=true \
            key=lights-out:env,value=dev \
            key=lights-out:priority,value=50

   # RDS Instance
   aws rds add-tags-to-resource \
     --resource-name {arn} \
     --tags Key=lights-out:managed,Value=true \
            Key=lights-out:env,Value=dev \
            Key=lights-out:priority,Value=100
   ```

2. 更新 SSM Parameter Store 配置

3. 部署 Lights Out Lambda：
   ```bash
   pnpm deploy
   ```

```

---

## Step 5: 儲存報告

**判斷儲存位置：**

1. 檢查當前目錄是否為 lights-out 專案目錄（存在 `serverless.yml` 或 `package.json` 含有 "lights-out"）
2. 如果是 lights-out 目錄：
   - 儲存路徑：`reports/<account-name>/discovery-report-<YYYYMMDD>.md`
   - `<account-name>`: 從 Step 1 取得的 AWS Account ID
   - `<YYYYMMDD>`: 當前日期，格式如 `20260120`
3. 如果不是 lights-out 目錄：
   - 儲存路徑：`./discovery-report-<YYYYMMDD>.md`

使用 AskUserQuestion 詢問：

```

question: "報告已產出完成。是否要將此報告儲存為檔案？"
options:

- label: "儲存報告"
  description: "儲存至 {target_path}"
- label: "不用，我已經看完了"
  description: "跳過儲存"

```

**如果使用者選擇儲存：**
1. 如果目標目錄不存在，先建立目錄（使用 Bash 的 `mkdir -p`）
2. 使用 Write 工具將報告內容寫入檔案
3. 顯示確認訊息：
```

報告已儲存至：{file_path}

```

---

## 分析邏輯

### ECS Service 分析規則

1. **Lights Out 支援判定：**
- `supported`: 可安全啟停
- `caution`: 需要注意（有 scheduler/webhook 容器，或 Task Definition 風險等級為 medium/high）
- `not-supported`: 名稱包含 production 關鍵字

2. **風險等級判定（基於 Task Definition）：**
- `high`: 包含 scheduler、webhook 容器，或 stopTimeout 設定過長
- `medium`: 包含 worker 容器
- `low`: 標準 API/UI 服務

3. **Production 關鍵字檢測：**
- 檢查 service name 和 cluster name 是否包含：`prod`, `production`, `live`, `prd`

4. **Dev/Test 關鍵字檢測：**
- 檢查是否包含：`dev`, `development`, `test`, `staging`, `sandbox`, `qa`, `demo`, `poc`

### RDS Instance 分析規則

1. **Lights Out 支援判定（使用 configAnalysis.supportLevel）：**
- `supported`: 標準 RDS instance，可直接啟停
- `cluster-managed`: Aurora Cluster 成員，需透過 cluster 管理
- `not-supported`: Read Replica 或 Aurora Serverless v1

2. **特殊配置檢測：**
- Aurora Cluster 成員：檢查 `isAuroraClusterMember`
- Read Replica：檢查 `isReadReplica`
- Aurora Serverless：檢查 `isAuroraServerless`
- Multi-AZ：檢查 `multiAZ`（通常表示生產環境）

---

## MCP Tools 使用

此命令使用 `lights-out-discovery` MCP Server 提供的以下 tools：

| Tool | 用途 |
|------|------|
| `verify_credentials` | 驗證 AWS 認證 |
| `list_available_regions` | 取得按地區分組的 AWS regions 列表 |
| `discover_ecs_services` | 探索 ECS Services |
| `discover_rds_instances` | 探索 RDS Instances |

---

## 注意事項

- 此命令只會讀取 AWS 資源資訊，不會進行任何修改
- 探索需要以下 IAM 權限：
- `ecs:ListClusters`, `ecs:ListServices`, `ecs:DescribeServices`, `ecs:DescribeTaskDefinition`
- `rds:DescribeDBInstances`
- `application-autoscaling:DescribeScalableTargets`
- `sts:GetCallerIdentity`
- 如果帳號中資源較多，探索過程可能需要一些時間
```
