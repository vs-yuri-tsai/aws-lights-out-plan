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

## Step 2: 詢問 IaC 專案目錄

使用 AskUserQuestion 詢問：

```
question: "你是否有 Infrastructure as Code (IaC) 專案可以提供作為分析參考？"
options:
  - label: "有，我有 Terraform/Terragrunt 專案"
    description: "請提供專案目錄路徑"
  - label: "有，我有 CloudFormation 範本"
    description: "請提供範本目錄路徑"
  - label: "沒有，直接探索 AWS 資源"
    description: "跳過此步驟"
```

---

## Step 2.5: 詢問後端專案目錄（可選）

使用 AskUserQuestion 詢問：

```
question: "你是否有後端專案原始碼可以提供作為相依性分析參考？"
options:
  - label: "有，我有後端專案"
    description: "請提供一個或多個專案目錄路徑"
  - label: "沒有，跳過程式碼分析"
    description: "僅使用 AWS 資源和 IaC 進行分析"
```

如果選擇提供後端專案，詢問目錄路徑和對應的服務名稱。

---

## Step 3: 掃描 IaC 取得區域（如果有提供 IaC 路徑）

使用 `scan_iac_directory` 掃描 IaC 專案。

**顯示掃描結果摘要：**

```
IaC 專案掃描結果：
- 掃描目錄: {directory}
- Terraform 檔案: {terraform} 個
- Terragrunt 檔案: {terragrunt} 個
- CloudFormation 檔案: {cloudformation} 個

發現的資源定義：
- ECS 相關: {ecsResources} 個
- RDS 相關: {rdsResources} 個
- Auto Scaling 相關: {autoscalingResources} 個
- Security Group 相關: {securityGroupResources} 個
- Service Discovery 相關: {serviceDiscoveryResources} 個
- Load Balancer 相關: {loadBalancerResources} 個
- 相依性邊: {dependencyEdges} 個
```

從結果中提取部署的區域列表（如果可識別）。

---

## Step 4: 選擇探索區域

使用 `list_available_regions` 取得完整區域列表。

使用 AskUserQuestion 讓用戶選擇：

```
question: "請選擇要探索的 AWS 區域"
multiSelect: true
options:
  - label: "ap-southeast-1 (Singapore)" + " (Recommended)" if detected from IaC
    description: "新加坡區域"
  - label: "ap-northeast-1 (Tokyo)"
    description: "東京區域"
  - label: "us-east-1 (N. Virginia)"
    description: "美東區域"
  - label: "其他區域"
    description: "手動輸入區域代碼"
```

**如果從 IaC 發現了區域，優先顯示這些區域並標記為推薦。**

---

## Step 5: 探索資源

並行執行：

- `discover_ecs_services(regions)`
- `discover_rds_instances(regions)`
- `discover_asg_groups(regions)`

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
- Auto Scaling Groups: {asg_count} 個
- 已配置 lights-out tags: {tagged_count} 個
```

如果沒有發現任何資源：

- 提示使用者可能的原因（region 選擇錯誤、權限不足等）
- 提供重新選擇 region 的選項

---

## Step 5.5: 掃描後端專案（如果有提供）

如果使用者在 Step 2.5 提供了後端專案目錄：

使用 `scan_backend_project` 掃描每個專案目錄。

**顯示掃描結果摘要：**

```
後端專案掃描結果：
- 專案: {directory}
- 語言: {language}
- 掃描檔案: {totalFiles} 個
- HTTP 呼叫: {filesWithHttpCalls} 個檔案
- 環境變數: {uniqueEnvVars} 個
- 推測的相依性: {inferredDependencies} 個
```

---

## Step 5.6: 執行相依性分析

使用 `analyze_dependencies` 整合所有來源的相依性資訊：

- ECS 服務探索結果
- IaC 掃描結果（如果有）
- 後端專案分析結果（如果有）

**顯示分析結果摘要：**

```
相依性分析結果：
- 服務節點: {services} 個
- 相依性邊: {edges} 個
- 高風險相依性: {highRiskDependencies} 個
- 服務群組: {serviceGroups} 個
```

---

## Step 6: 生成報告

**按照以下模板生成報告，注意格式和視覺呈現：**

### 報告格式規範

1. **視覺符號**：使用 emoji 增加可讀性
   - ✅ 表示支援/低風險
   - ⚠️ 表示需注意/中等風險
   - ❌ 表示不支援/高風險

2. **Auto Scaling 欄位格式**：
   - 有 Auto Scaling: `✅ (min-max)` 如 `✅ (1-2)`
   - 無 Auto Scaling: `❌`

3. **Lights Out 支援欄位格式**：
   - `✅ supported`
   - `⚠️ caution`
   - `❌ not-supported` 或 `❌ cluster-managed`

4. **風險等級判定**：需根據 Task Definition 分析結果精準判定
   - `low`: 標準 API/UI 服務，無特殊容器
   - `medium`: 有 webhook 容器，或可能有背景任務但非核心
   - `high`: 有 scheduler/worker 容器，或 stopTimeout 過短

````markdown
# AWS Lights Out 資源探索報告

**生成時間：** {timestamp}
**AWS 帳號：** {account_id}
**探索區域：** {regions}

---

## 摘要

| 指標                 | 數值                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| ECS Services         | {ecs_count}                                                           |
| RDS Instances        | {rds_count}                                                           |
| Auto Scaling Groups  | {asg_count}                                                           |
| 已有 Lights Out Tags | {tagged_count}                                                        |
| 建議納入管理         | {ecs_recommended} ECS + {rds_recommended} RDS + {asg_recommended} ASG |

---

## ECS Services

| Region   | Cluster   | Service   | 狀態                | Auto Scaling   | 風險等級        | Lights Out 支援                              |
| -------- | --------- | --------- | ------------------- | -------------- | --------------- | -------------------------------------------- |
| {region} | {cluster} | {service} | {running}/{desired} | ✅ (1-2) 或 ❌ | low/medium/high | ✅ supported / ⚠️ caution / ❌ not-supported |

### 高風險服務說明

**{service_name} ({risk_level} risk):**

- {風險原因，使用 bullet points}
- 建議：
  - {具體建議 1}
  - {具體建議 2}
  - {替代方案，如有}

---

## RDS Instances

| Region   | Instance ID   | 引擎     | 狀態     | 類型                                        | Lights Out 支援                                      |
| -------- | ------------- | -------- | -------- | ------------------------------------------- | ---------------------------------------------------- |
| {region} | {instance_id} | {engine} | {status} | {標準 RDS/Aurora Cluster 成員/Read Replica} | ✅ supported / ❌ cluster-managed / ❌ not-supported |

### 不支援的實例說明

**{類型} ({count} instances):**

- {原因說明}
- 目前 Lights Out Lambda **尚未實作** {功能}
- 如果需要管理，需要：
  1. {步驟 1}
  2. {步驟 2}

---

## Auto Scaling Groups

| Region   | ASG Name   | 容量 (desired/min/max) | 實例數 (InService/Total) | Suspended Processes | Scaling Policies | 風險等級        | Lights Out 支援                                        |
| -------- | ---------- | ---------------------- | ------------------------ | ------------------- | ---------------- | --------------- | ------------------------------------------------------ |
| {region} | {asg_name} | {desired}/{min}/{max}  | {inService}/{total}      | ✅ 無 / ⚠️ {count}  | ✅ 有 / ❌ 無    | low/medium/high | ✅ supported / ⚠️ already-stopped / ❌ not-recommended |

### 高風險 ASG 說明

**{asg_name} ({risk_level} risk):**

- {風險原因，使用 bullet points}
- 建議：
  - {具體建議 1}
  - {具體建議 2}

### 已停止的 ASG

**{asg_name}:**

- 目前狀態：min=0, max=0, desired=0
- 可能原因：已被 Lights Out 或手動停止
- 建議：確認是否需要納入 Lights Out 管理

---

## 服務相依性分析

（若有執行相依性分析才顯示此區塊）

### 相依性圖

```mermaid
graph TD
  {service1} --> {service2}
```

### 高風險相依性

| 服務      | 依賴        | 風險               | 建議             |
| --------- | ----------- | ------------------ | ---------------- |
| {service} | {dependsOn} | {risk_description} | {recommendation} |

### 建議的服務群組

**群組 {n}: {群組名稱或主題}**

- {service1}
- {service2}

應一起啟停，因為 {原因}。

### 建議的啟停順序

**啟動順序**: {service1} → {service2} → {service3} → ...
**停止順序**: (反向)

---

## Lights Out 支援程度對照

根據目前 Lights Out Lambda 的實作：

| 資源類型               | 支援程度    | 說明                                           |
| ---------------------- | ----------- | ---------------------------------------------- |
| ECS Service            | ✅ 完全支援 | 支援 Auto Scaling 模式和 Direct 模式           |
| RDS DB Instance        | ✅ 完全支援 | Fire-and-forget 模式，支援 skipSnapshot        |
| EC2 Auto Scaling Group | ✅ 完全支援 | Suspend/Resume processes，Fire-and-forget 模式 |
| RDS Aurora Cluster     | ❌ 不支援   | 需透過 cluster 啟停，目前未實作                |
| RDS Read Replica       | ❌ 不支援   | 無法獨立停止                                   |

---

## 建議配置

### 建議納入 Lights Out 管理的資源

#### A. 優先推薦（低風險）

**ECS Services ({count} 個):**

- {service1}
- {service2}
- ...

**建議 Tags：**

```yaml
lights-out:managed: 'true'
lights-out:env: 'dev'
lights-out:priority: '50'
```

**建議 SSM 配置（config/{stage_name}.yml）：**

```yaml
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      minCapacity: 1 # 對於有 Auto Scaling 的 services
      maxCapacity: 2
      desiredCount: 1
    stop:
      minCapacity: 0
      maxCapacity: 0
      desiredCount: 0

  rds-db:
    waitAfterCommand: 60
    skipSnapshot: true # 開發環境建議跳過 snapshot 以節省成本

  autoscaling-group:
    suspendProcesses: true
    waitAfterCommand: 30
    start:
      minSize: 2
      maxSize: 10
      desiredCapacity: 2
    stop:
      minSize: 0
      maxSize: 0
      desiredCapacity: 0

schedules:
  - name: weekday-schedule
    timezone: Asia/Taipei
    stop_cron: '0 22 * * 1-5' # 週一到週五 22:00 停止
    start_cron: '0 8 * * 1-5' # 週一到週五 08:00 啟動
    holidays:
      - '{year}-01-01' # 元旦
      # 根據實際需求添加
```

#### B. 需要注意（中等風險）

**{service_name}:**

- 建議先確認 {注意事項}
- 如果確認可以停止，使用較低 priority：

```yaml
lights-out:managed: 'true'
lights-out:env: 'dev'
lights-out:priority: '100' # 較早關閉、較晚啟動（數字越大優先級越低）
```

#### C. 高風險（需要評估）

**{service_name}:**

- **不建議納入 lights-out** 除非 {條件}
- 替代方案：
  - {替代方案 1}
  - {替代方案 2}

#### D. RDS 實例

**{instance_id} (標準 RDS):**

```bash
aws rds add-tags-to-resource \
  --resource-name arn:aws:rds:{region}:{account}:db:{instance_id} \
  --tags Key=lights-out:managed,Value=true \
         Key=lights-out:env,Value=dev \
         Key=lights-out:priority,Value=10 \
  --region {region} \
  --profile {profile}
```

> 💡 RDS 使用 priority=10（較小數字），確保先啟動、後關閉，讓 ECS 服務可以連線。

---

### 需要注意的資源

**目前已停止的 services:**

- {service1} (desired: 0)
- {service2} (desired: 0)

這些 service 目前已經是停止狀態，可以：

- 選項 1：不納入 lights-out 管理（保持目前狀態）
- 選項 2：如果未來需要定期啟停，再加上 tags

---

### 不建議納入的資源

**{資源類型} ({count} 個):**

- {resource1}
- {resource2}

**原因：**

- {原因說明}

**如果需要管理：**

1. {步驟說明}
2. {API 說明}

---

## 下一步

### 1. 為建議的資源加上 Tags

**ECS Services（批次加 tags 腳本）：**

```bash
#!/bin/bash

export AWS_PROFILE={profile}
CLUSTER="{cluster_name}"
REGION="{region}"
ACCOUNT="{account_id}"

# Low risk services (priority 50)
services_p50="{service1} {service2} {service3}"

for service in $services_p50; do
  arn="arn:aws:ecs:$REGION:$ACCOUNT:service/$CLUSTER/$service"
  echo "Tagging $service..."
  aws ecs tag-resource \
    --resource-arn "$arn" \
    --tags key=lights-out:managed,value=true \
           key=lights-out:env,value=dev \
           key=lights-out:priority,value=50 \
    --region $REGION
done

# Medium risk service (priority 100) - 需要先確認再執行
# service="{medium_risk_service}"
# arn="arn:aws:ecs:$REGION:$ACCOUNT:service/$CLUSTER/$service"
# aws ecs tag-resource \
#   --resource-arn "$arn" \
#   --tags key=lights-out:managed,value=true \
#          key=lights-out:env,value=dev \
#          key=lights-out:priority,value=100 \
#   --region $REGION

echo "Done!"
```

**RDS Instance：**

```bash
export AWS_PROFILE={profile}

aws rds add-tags-to-resource \
  --resource-name arn:aws:rds:{region}:{account}:db:{instance_id} \
  --tags Key=lights-out:managed,Value=true \
         Key=lights-out:env,Value=dev \
         Key=lights-out:priority,Value=10 \
  --region {region}
```

> 💡 RDS 使用較小的 priority 值確保先啟動（讓 ECS 服務可連線）、後關閉（等 ECS 服務都停止後再關閉）。

### 2. 建立 SSM Parameter Store 配置

```bash
# 建立配置檔案
cp config/aws-account-example.yml config/{stage_name}.yml

# 編輯配置（參考上方建議配置）
# 然後使用 run-interactive.js 部署時會自動上傳
```

### 3. 部署 Lights Out Lambda

```bash
cd {project_path}

# 使用互動式部署
pnpm deploy

# 選擇或輸入 stage name: {stage_name}
# 選擇 region: {region}
```

### 4. 測試

```bash
# 檢查資源探索
aws lambda invoke \
  --function-name lights-out-{stage_name} \
  --payload '{"action":"discover"}' \
  --region {region} \
  --profile {profile} \
  /tmp/discover-output.json && cat /tmp/discover-output.json | jq '.'

# 檢查狀態
aws lambda invoke \
  --function-name lights-out-{stage_name} \
  --payload '{"action":"status"}' \
  --region {region} \
  --profile {profile} \
  /tmp/status-output.json && cat /tmp/status-output.json | jq '.'
```

---

## 預期成本節省

假設每日 lights-out 時間為 {hours} 小時，工作日為週一至週五：

**ECS Services ({count} 個):**

- Fargate vCPU 成本: ~${vcpu_cost} per vCPU-hour
- 假設每個 service 平均 {avg_vcpu} vCPU
- 每日節省: {count} services × {avg_vcpu} vCPU × {hours} hours × ${vcpu_cost} = ${daily_ecs}
- 每月節省: ${daily_ecs} × {working_days} working days = **${monthly_ecs}\*\*

**RDS Instance ({count} 個 {instance_class}):**

- {instance_class} 成本: ~${hourly_cost} per hour
- 每日節省: {hours} hours × ${hourly_cost} = ${daily_rds}
- 每月節省: ${daily_rds} × {working_days} working days = **${monthly_rds}\*\*

**總計每月節省: ~${total_monthly}**

**注意：**

- 如果 Aurora Cluster 也能納入管理，預期可再節省更多
- 實際節省會依據運算資源配置和使用時間有所不同

---

## 附錄：資源清單

### ECS Services 完整列表

| Service Name | Desired   | Running   | Auto Scaling      | Task Definition |
| ------------ | --------- | --------- | ----------------- | --------------- |
| {service}    | {desired} | {running} | {min}-{max} 或 ❌ | :{revision}     |

### RDS Instances 完整列表

| Instance ID   | Engine   | Class   | Status   | Type   |
| ------------- | -------- | ------- | -------- | ------ |
| {instance_id} | {engine} | {class} | {status} | {type} |
````

---

## Step 7: 儲存報告

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

## Step 8: 銜接到標籤套用

報告儲存完成後，使用 AskUserQuestion 詢問：

```
question: "是否要繼續為報告中的資源套用 Lights Out 標籤？"
options:
  - label: "繼續套用標籤 (Recommended)"
    description: "根據報告建議，為資源套用 lights-out:managed 等標籤"
  - label: "稍後再處理"
    description: "您可以之後執行 /lights-out-apply-tags 來套用標籤"
```

**如果選擇繼續套用標籤：**

提示使用者執行：

```
請執行 /lights-out-apply-tags 來為資源套用標籤。

報告路徑：{file_path}
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

| Tool                     | 用途                                   |
| ------------------------ | -------------------------------------- |
| `verify_credentials`     | 驗證 AWS 認證                          |
| `list_available_regions` | 取得按地區分組的 AWS regions 列表      |
| `scan_iac_directory`     | 掃描 IaC 目錄，找出資源定義和相依性    |
| `scan_backend_project`   | 掃描後端專案，分析 HTTP 呼叫和環境變數 |
| `discover_ecs_services`  | 探索 ECS Services，包含環境變數分析    |
| `discover_rds_instances` | 探索 RDS Instances                     |
| `discover_asg_groups`    | 探索 EC2 Auto Scaling Groups           |
| `analyze_dependencies`   | 整合相依性分析，產出風險評估和啟停順序 |

---

## 注意事項

- 此命令只會讀取 AWS 資源資訊，不會進行任何修改
- 探索需要以下 IAM 權限：
  - `ecs:ListClusters`, `ecs:ListServices`, `ecs:DescribeServices`, `ecs:DescribeTaskDefinition`
  - `rds:DescribeDBInstances`
  - `autoscaling:DescribeAutoScalingGroups`, `autoscaling:DescribePolicies`, `autoscaling:DescribeScheduledActions`
  - `application-autoscaling:DescribeScalableTargets`
  - `sts:GetCallerIdentity`
- 如果帳號中資源較多，探索過程可能需要一些時間

```

```
