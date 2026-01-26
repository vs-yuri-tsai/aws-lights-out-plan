# AWS Lights Out 資源探索報告

**生成時間：** 2026-01-21
**AWS 帳號：** 677276105166
**探索區域：** us-east-1

---

## 摘要

| 指標 | 數值 |
|------|------|
| ECS Services | 14 |
| RDS Instances | 7 |
| 已有 Lights Out Tags | 0 |
| 建議納入管理 | 12 ECS + 1 RDS |

---

## ECS Services

| Region | Cluster | Service | 狀態 | Auto Scaling | 風險等級 | Lights Out 支援 |
|--------|---------|---------|------|--------------|----------|----------------|
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-subscription-dev | 1/1 | ✅ (1-2) | medium | ⚠️ caution |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-auth-dev | 1/1 | ✅ (1-2) | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-admin-dev | 1/1 | ✅ (1-2) | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-admin-auth-dev | 1/1 | ✅ (1-2) | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-subscription-ui-dev | 1/1 | ❌ | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | manager-dev | 0/0 | ❌ | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-scheduler-dev | 1/1 | ✅ (1-2) | high | ⚠️ caution |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-landing-ui-dev | 1/1 | ✅ (1-2) | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-common-dev | 1/1 | ✅ (1-2) | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | chargify-dev | 0/0 | ❌ | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-account-2-dev | 1/1 | ✅ (1-2) | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-account-dev | 1/1 | ✅ (1-2) | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-entity-dev | 1/1 | ✅ (1-2) | low | ✅ supported |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-entity-2-dev | 1/1 | ✅ (1-2) | low | ✅ supported |

### 高風險服務說明

**vs-scheduler-dev (high risk):**
- 這是一個 scheduler 服務，通常負責定時任務調度
- 建議：
  - 在 lights-out 期間關閉可能會影響定時任務執行
  - 如果定時任務不是關鍵業務，可以納入管理
  - 建議使用較低的 priority (如 200) 讓它在其他服務之後才關閉，並在其他服務之前啟動
  - 或者考慮將排程任務移到 AWS EventBridge/Step Functions

**vs-subscription-dev (medium risk):**
- 訂閱服務可能包含背景處理任務（如 webhook 處理、定期計費檢查等）
- 建議：
  - 確認是否有重要的背景任務在非工作時間執行
  - 如果只是 API 服務，可以安全納入 lights-out 管理

---

## RDS Instances

| Region | Instance ID | 引擎 | 狀態 | 類型 | Lights Out 支援 |
|--------|-------------|------|------|------|----------------|
| us-east-1 | viewsonic-cluster-3-instance-1 | aurora-postgresql | stopped | Aurora Cluster 成員 | ❌ cluster-managed |
| us-east-1 | viewsonic-cluster-3-instance-1-us-east-1b | aurora-postgresql | stopped | Aurora Cluster 成員 | ❌ cluster-managed |
| us-east-1 | viewsonic-cluster-3-instance-2 | aurora-postgresql | stopped | Aurora Cluster 成員 | ❌ cluster-managed |
| us-east-1 | vs-account-service-us-east-1-aurora-postgres-dev-reader | aurora-postgresql | available | Aurora Cluster 成員 | ❌ cluster-managed |
| us-east-1 | vs-account-service-us-east-1-aurora-postgres-dev-writer | aurora-postgresql | available | Aurora Cluster 成員 | ❌ cluster-managed |
| us-east-1 | vs-account-service-us-east-1-postgres-dev | postgres | available | 標準 RDS | ✅ supported |
| us-east-1 | vs-account-service-us-east-1-postgres-replica-dev-1 | postgres | available | Read Replica | ❌ not-supported |

### 不支援的實例說明

**Aurora Cluster 成員 (5 instances):**
- Aurora 的 instance 必須透過 cluster 層級進行啟停，無法獨立操作
- 目前 Lights Out Lambda **尚未實作** Aurora Cluster 管理功能
- 如果需要管理 Aurora Cluster，需要：
  1. 實作新的 `auroraCluster.ts` handler
  2. 使用 `StopDBCluster` / `StartDBCluster` API
  3. 更新 orchestrator 來處理 cluster 類型資源

**Read Replica (1 instance):**
- `vs-account-service-us-east-1-postgres-replica-dev-1` 是 `vs-account-service-us-east-1-postgres-dev` 的 read replica
- Read replica 無法獨立停止（會隨主實例狀態變化）
- 如果要納入 lights-out 管理，只需要管理主實例即可

---

## Lights Out 支援程度對照

根據目前 Lights Out Lambda 的實作：

| 資源類型 | 支援程度 | 說明 |
|---------|---------|------|
| ECS Service | ✅ 完全支援 | 支援 Auto Scaling 模式和 Direct 模式 |
| RDS DB Instance | ✅ 完全支援 | Fire-and-forget 模式，支援 skipSnapshot |
| RDS Aurora Cluster | ❌ 不支援 | 需透過 cluster 啟停，目前未實作 |
| RDS Read Replica | ❌ 不支援 | 無法獨立停止 |

---

## 建議配置

### 建議納入 Lights Out 管理的資源

#### A. 優先推薦（低風險）

**ECS Services (10 個):**
- vs-auth-dev
- vs-admin-dev
- vs-admin-auth-dev
- vs-subscription-ui-dev
- vs-landing-ui-dev
- vs-common-dev
- vs-account-2-dev
- vs-account-dev
- vs-entity-dev
- vs-entity-2-dev

**建議 Tags：**
```yaml
lights-out:managed: 'true'
lights-out:env: 'dev'
lights-out:priority: '50'
```

**建議 SSM 配置（config/vs-account-dev.yml）：**
```yaml
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      minCapacity: 1    # 對於有 Auto Scaling 的 services
      maxCapacity: 2
      desiredCount: 1
      # 對於沒有 Auto Scaling 的 services，只需要 desiredCount
    stop:
      minCapacity: 0
      maxCapacity: 0
      desiredCount: 0

  rds-db:
    waitAfterCommand: 60
    skipSnapshot: true    # 開發環境建議跳過 snapshot 以節省成本

schedules:
  - name: weekday-schedule
    timezone: Asia/Taipei
    stop_cron: '0 22 * * 1-5'   # 週一到週五 22:00 停止
    start_cron: '0 8 * * 1-5'   # 週一到週五 08:00 啟動
    holidays:
      - '2026-01-01'  # 元旦
      - '2026-02-18'  # 農曆新年
```

#### B. 需要注意（中等風險）

**vs-subscription-dev:**
- 建議先確認是否有重要的背景任務
- 如果確認可以停止，使用相同配置但較低 priority：

```yaml
lights-out:managed: 'true'
lights-out:env: 'dev'
lights-out:priority: '100'  # 較晚關閉，較早啟動
```

#### C. 高風險（需要評估）

**vs-scheduler-dev:**
- **不建議納入 lights-out** 除非確認定時任務可以中斷
- 替代方案：
  - 將定時任務移到 AWS EventBridge Rules + Lambda
  - 或使用 Step Functions 來管理工作流程
  - 這樣就可以完全關閉這個 ECS service

#### D. RDS 實例

**vs-account-service-us-east-1-postgres-dev (標準 RDS):**

```bash
# 為 RDS 加上 tags
aws rds add-tags-to-resource \
  --resource-name arn:aws:rds:us-east-1:677276105166:db:vs-account-service-us-east-1-postgres-dev \
  --tags Key=lights-out:managed,Value=true \
         Key=lights-out:env,Value=dev \
         Key=lights-out:priority,Value=100 \
  --region us-east-1 \
  --profile sss-development-vs-account
```

**注意：** Read replica 會自動跟隨主實例的狀態，不需要單獨管理。

---

### 需要注意的資源

**目前已停止的 services:**
- manager-dev (desired: 0)
- chargify-dev (desired: 0)

這些 service 目前已經是停止狀態，可以：
- 選項 1：不納入 lights-out 管理（保持目前狀態）
- 選項 2：如果未來需要定期啟停，再加上 tags

---

### 不建議納入的資源

**Aurora Cluster instances (5 個):**
- viewsonic-cluster-3-* (3 instances, 目前已 stopped)
- vs-account-service-us-east-1-aurora-postgres-dev-* (2 instances)

**原因：**
- 目前 Lights Out Lambda 尚未實作 Aurora Cluster 管理
- 需要新增 handler 才能支援

**如果需要管理 Aurora Cluster：**
1. 實作 `src/handlers/auroraCluster.ts`
2. 使用以下 API：
   - `RDSClient.StopDBCluster()`
   - `RDSClient.StartDBCluster()`
3. 更新 orchestrator 的資源探索邏輯

---

## 下一步

### 1. 為建議的資源加上 Tags

**ECS Services（批次加 tags 腳本）：**

```bash
#!/bin/bash

export AWS_PROFILE=sss-development-vs-account
CLUSTER="vs-account-service-ecs-cluster-dev"
REGION="us-east-1"
ACCOUNT="677276105166"

# Low risk services (priority 50)
services_p50="vs-auth-dev vs-admin-dev vs-admin-auth-dev vs-subscription-ui-dev vs-landing-ui-dev vs-common-dev vs-account-2-dev vs-account-dev vs-entity-dev vs-entity-2-dev"

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
# service="vs-subscription-dev"
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
export AWS_PROFILE=sss-development-vs-account

aws rds add-tags-to-resource \
  --resource-name arn:aws:rds:us-east-1:677276105166:db:vs-account-service-us-east-1-postgres-dev \
  --tags Key=lights-out:managed,Value=true \
         Key=lights-out:env,Value=dev \
         Key=lights-out:priority,Value=100 \
  --region us-east-1
```

### 2. 建立 SSM Parameter Store 配置

在 lights-out 專案中建立配置檔案：

```bash
# 建立配置檔案
cp config/sss-lab.yml config/vs-account-dev.yml

# 編輯配置（參考上方建議配置）
# 然後上傳到 SSM
```

使用 `run-interactive.js` 部署時選擇對應的 stage 名稱。

### 3. 部署 Lights Out Lambda

```bash
cd /Users/tsaiyu/GitHub/ViewSonic/worktrees/edu-aws-lights-out/feat/onboarding-ai-integration

# 使用互動式部署
pnpm deploy

# 選擇或輸入 stage name: vs-account-dev
# 選擇 region: us-east-1
```

### 4. 測試

部署完成後，測試 Lambda 功能：

```bash
# 檢查資源探索
aws lambda invoke \
  --function-name lights-out-vs-account-dev \
  --payload '{"action":"discover"}' \
  --region us-east-1 \
  --profile sss-development-vs-account \
  /tmp/discover-output.json && cat /tmp/discover-output.json | jq '.'

# 檢查狀態
aws lambda invoke \
  --function-name lights-out-vs-account-dev \
  --payload '{"action":"status"}' \
  --region us-east-1 \
  --profile sss-development-vs-account \
  /tmp/status-output.json && cat /tmp/status-output.json | jq '.'
```

---

## 預期成本節省

假設每日 lights-out 時間為 14 小時（22:00 - 08:00），工作日為週一至週五：

**ECS Services (10-12 個):**
- Fargate Spot vCPU 成本: ~$0.012 per vCPU-hour
- 假設每個 service 平均 0.25 vCPU
- 每日節省: 12 services × 0.25 vCPU × 14 hours × $0.012 = $0.504
- 每月節省: $0.504 × 22 working days = **$11.09**

**RDS Instance (1 個 db.r7g.large):**
- db.r7g.large 成本: ~$0.24 per hour
- 每日節省: 14 hours × $0.24 = $3.36
- 每月節省: $3.36 × 22 working days = **$73.92**

**總計每月節省: ~$85**

**注意：**
- Aurora Cluster 如果也能納入管理，預期可再節省 **$150-200/月**
- 實際節省會依據運算資源配置和使用時間有所不同

---

## 附錄：資源清單

### ECS Services 完整列表

| Service Name | Desired | Running | Auto Scaling | Task Definition |
|-------------|---------|---------|--------------|-----------------|
| vs-subscription-dev | 1 | 1 | 1-2 | :99 |
| vs-auth-dev | 1 | 1 | 1-2 | :73 |
| vs-admin-dev | 1 | 1 | 1-2 | :80 |
| vs-admin-auth-dev | 1 | 1 | 1-2 | :31 |
| vs-subscription-ui-dev | 1 | 1 | ❌ | :25 |
| manager-dev | 0 | 0 | ❌ | :14 |
| vs-scheduler-dev | 1 | 1 | 1-2 | :7 |
| vs-landing-ui-dev | 1 | 1 | 1-2 | :16 |
| vs-common-dev | 1 | 1 | 1-2 | :64 |
| chargify-dev | 0 | 0 | ❌ | :8 |
| vs-account-2-dev | 1 | 1 | 1-2 | :102 |
| vs-account-dev | 1 | 1 | 1-2 | :67 |
| vs-entity-dev | 1 | 1 | 1-2 | :77 |
| vs-entity-2-dev | 1 | 1 | 1-2 | :102 |

### RDS Instances 完整列表

| Instance ID | Engine | Class | Status | Type |
|------------|--------|-------|--------|------|
| viewsonic-cluster-3-instance-1 | aurora-postgresql | db.r7g.large | stopped | Cluster Member |
| viewsonic-cluster-3-instance-1-us-east-1b | aurora-postgresql | db.r7g.large | stopped | Cluster Member |
| viewsonic-cluster-3-instance-2 | aurora-postgresql | db.r5.large | stopped | Cluster Member |
| vs-account-service-us-east-1-aurora-postgres-dev-reader | aurora-postgresql | db.t3.medium | available | Cluster Member |
| vs-account-service-us-east-1-aurora-postgres-dev-writer | aurora-postgresql | db.r7g.large | available | Cluster Member |
| vs-account-service-us-east-1-postgres-dev | postgres | db.r7g.large | available | Standard RDS |
| vs-account-service-us-east-1-postgres-replica-dev-1 | postgres | db.t3.small | available | Read Replica |

---
