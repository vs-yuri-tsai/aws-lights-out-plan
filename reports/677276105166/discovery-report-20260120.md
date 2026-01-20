# AWS Lights Out 資源探索報告

**生成時間:** 2026-01-20
**AWS 帳號:** 677276105166
**探索區域:** us-east-1

---

## 摘要

| 指標                 | 數值                |
| -------------------- | ------------------- |
| ECS Services         | 15                  |
| RDS Instances        | 7                   |
| 已有 Lights Out Tags | 0                   |
| 建議納入管理         | 9 個 ECS + 1 個 RDS |

---

## ECS Services

| Region    | Cluster                            | Service                | 狀態 | Auto Scaling | 風險等級 | Lights Out 支援 |
| --------- | ---------------------------------- | ---------------------- | ---- | ------------ | -------- | --------------- |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-subscription-dev    | 1/1  | Yes (1-2)    | high     | caution         |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-auth-dev            | 1/1  | Yes (1-2)    | low      | supported       |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-admin-dev           | 1/1  | Yes (1-2)    | high     | caution         |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-admin-auth-dev      | 1/1  | Yes (1-2)    | low      | supported       |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-subscription-ui-dev | 1/1  | No           | low      | supported       |
| us-east-1 | vs-account-service-ecs-cluster-dev | manager-dev            | 0/0  | No           | low      | supported       |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-scheduler-dev       | 1/1  | Yes (1-2)    | high     | caution         |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-landing-ui-dev      | 1/1  | Yes (1-2)    | low      | supported       |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-common-dev          | 1/1  | Yes (1-2)    | low      | supported       |
| us-east-1 | vs-account-service-ecs-cluster-dev | chargify-dev           | 0/0  | No           | low      | supported       |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-account-2-dev       | 1/1  | Yes (1-2)    | high     | caution         |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-account-dev         | 1/1  | Yes (1-2)    | low      | supported       |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-entity-dev          | 1/1  | Yes (1-2)    | low      | supported       |
| us-east-1 | vs-account-service-ecs-cluster-dev | vs-entity-2-dev        | 1/1  | Yes (1-2)    | low      | supported       |

### 高風險服務說明

**vs-subscription-dev (high risk - caution):**

- 包含 scheduler 容器 (`vs-subscription-scheduler`) 和 webhook 容器 (`vs-subscription-webhook`)
- Scheduler 可能有長時間執行的排程任務,停止時可能中斷正在執行的任務
- Webhook 停止時可能遺失外部系統的請求
- 所有容器的 `stopTimeout` 未設定,建議設定為 60-120 秒
- **建議:** 為 scheduler 實作 graceful shutdown,確保任務可以正常完成後才關閉

**vs-admin-dev (high risk - caution):**

- 包含 scheduler 容器 (`vs-admin-scheduler`)
- Scheduler 可能有長時間執行的排程任務,停止時可能中斷正在執行的任務
- `stopTimeout` 未設定,建議設定為 60-120 秒
- **建議:** 為 scheduler 實作 graceful shutdown

**vs-scheduler-dev (high risk - caution):**

- 主要容器就是 scheduler (`vs-scheduler`)
- 可能有長時間執行的排程任務,停止時可能中斷正在執行的任務
- `stopTimeout` 未設定,建議設定為 60-120 秒
- **建議:** 實作 graceful shutdown 機制

**vs-account-2-dev (high risk - caution):**

- 包含 scheduler 容器 (`vs-account-2-scheduler`) 和 webhook 容器 (`vs-account-2-webhook`)
- 與 vs-subscription-dev 類似的風險
- **建議:** 為 scheduler 實作 graceful shutdown,為 webhook 考慮請求緩衝機制

---

## RDS Instances

| Region    | Instance ID                                             | 引擎                    | 狀態      | 類型                | Lights Out 支援 |
| --------- | ------------------------------------------------------- | ----------------------- | --------- | ------------------- | --------------- |
| us-east-1 | viewsonic-cluster-3-instance-1                          | aurora-postgresql 15.15 | stopped   | Aurora Cluster 成員 | cluster-managed |
| us-east-1 | viewsonic-cluster-3-instance-1-us-east-1b               | aurora-postgresql 15.15 | stopped   | Aurora Cluster 成員 | cluster-managed |
| us-east-1 | viewsonic-cluster-3-instance-2                          | aurora-postgresql 15.15 | stopped   | Aurora Cluster 成員 | cluster-managed |
| us-east-1 | vs-account-service-us-east-1-aurora-postgres-dev-reader | aurora-postgresql 15.15 | available | Aurora Cluster 成員 | cluster-managed |
| us-east-1 | vs-account-service-us-east-1-aurora-postgres-dev-writer | aurora-postgresql 15.15 | available | Aurora Cluster 成員 | cluster-managed |
| us-east-1 | vs-account-service-us-east-1-postgres-dev               | postgres 14.17          | available | 標準 RDS            | supported       |
| us-east-1 | vs-account-service-us-east-1-postgres-replica-dev-1     | postgres 14.17          | available | Read Replica        | not-supported   |

### 不支援的實例說明

**Aurora Cluster 成員 (cluster-managed):**

- `viewsonic-cluster-3` (3 個 instances)
- `vs-account-service-us-east-1-aurora-postgres-dev` (2 個 instances: reader, writer)
- **原因:** Aurora Cluster 需透過 cluster 層級進行啟停,不能單獨停止個別 instance
- **目前狀態:** Lights Out Lambda 尚未實作 Aurora Cluster 支援
- **建議:** 需要手動管理或等待未來版本實作 `rds-cluster` 類型

**Read Replica (not-supported):**

- `vs-account-service-us-east-1-postgres-replica-dev-1`
- **原因:** Read Replica 無法獨立停止
- **影響:** 停止 source DB (`vs-account-service-us-east-1-postgres-dev`) 會自動影響 replica
- **建議:** 如果要納入 Lights Out,只需管理 source DB 即可

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

以下 ECS Services 適合立即納入 Lights Out 管理:

**低風險 Services (建議優先納入):**

1. vs-auth-dev
2. vs-admin-auth-dev
3. vs-landing-ui-dev
4. vs-common-dev
5. vs-account-dev
6. vs-entity-dev
7. vs-entity-2-dev
8. vs-subscription-ui-dev

**已停止的 Services (可選):**

- manager-dev (desiredCount=0)
- chargify-dev (desiredCount=0)

**RDS Instance (建議納入):**

- vs-account-service-us-east-1-postgres-dev (標準 PostgreSQL,完全支援)

**建議 Tags:**

```yaml
lights-out:managed: 'true'
lights-out:env: 'dev'
lights-out:priority: '50'
```

**建議配置範例 (SSM Parameter):**

```yaml
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      minCapacity: 1
      maxCapacity: 2
      desiredCount: 1
    stop:
      minCapacity: 0
      maxCapacity: 0
      desiredCount: 0

  rds-db:
    waitAfterCommand: 60
    skipSnapshot: true # 開發環境建議跳過 snapshot
```

---

### 需要注意的資源 (caution)

以下 Services 包含 scheduler 或 webhook 容器,建議先評估影響再納入:

1. **vs-subscription-dev** - 包含 scheduler + webhook
2. **vs-admin-dev** - 包含 scheduler
3. **vs-scheduler-dev** - 主要功能為 scheduler
4. **vs-account-2-dev** - 包含 scheduler + webhook

**建議行動:**

- 先與開發團隊確認 scheduler 執行頻率和任務時長
- 評估 webhook 請求遺失的影響
- 在 Task Definition 中設定適當的 `stopTimeout` (建議 60-120 秒)
- 實作 graceful shutdown 機制
- 建議在 Lights Out 配置中使用較晚的停止時間,確保其他服務先停止

**可考慮的配置 (較晚停止,較早啟動):**

```yaml
# 為 scheduler/webhook services 使用不同的 priority
# priority 數字越小越優先 (啟動時先啟動,停止時後停止)
lights-out:priority: '30' # 比一般服務 (50) 更優先
```

---

### 不建議納入的資源

**RDS Aurora Cluster 成員:**

- viewsonic-cluster-3 (3 instances)
- vs-account-service-us-east-1-aurora-postgres-dev (2 instances)
- **原因:** 目前 Lights Out 不支援 Aurora Cluster
- **替代方案:** 手動管理或使用 AWS CLI scripts

**RDS Read Replica:**

- vs-account-service-us-east-1-postgres-replica-dev-1
- **原因:** 無法獨立停止
- **說明:** 停止 source DB 時會自動影響,無需額外配置

---

## 下一步

### 1. 為建議的資源加上 Tags

**ECS Service:**

```bash
# 範例: vs-auth-dev
aws ecs tag-resource \
  --resource-arn arn:aws:ecs:us-east-1:677276105166:service/vs-account-service-ecs-cluster-dev/vs-auth-dev \
  --tags key=lights-out:managed,value=true \
         key=lights-out:env,value=dev \
         key=lights-out:priority,value=50

# 對其他低風險 services 重複執行
```

**RDS Instance:**

```bash
aws rds add-tags-to-resource \
  --resource-name arn:aws:rds:us-east-1:677276105166:db:vs-account-service-us-east-1-postgres-dev \
  --tags Key=lights-out:managed,Value=true \
         Key=lights-out:env,Value=dev \
         Key=lights-out:priority,Value=100
```

### 2. 更新 SSM Parameter Store 配置

建立或更新配置檔 (例如 `config/dev-us-east-1.yml`),然後上傳到 SSM:

```bash
aws ssm put-parameter \
  --name /lights-out/dev/config \
  --type String \
  --value file://config/dev-us-east-1.yml \
  --overwrite
```

### 3. 部署 Lights Out Lambda

```bash
cd /path/to/lights-out-project
pnpm deploy
```

### 4. 測試

先執行 `discover` 和 `status` action 確認資源可正確發現:

```bash
aws lambda invoke \
  --function-name lights-out-dev-handler \
  --payload '{"action":"discover"}' \
  out.json

aws lambda invoke \
  --function-name lights-out-dev-handler \
  --payload '{"action":"status"}' \
  out.json
```
