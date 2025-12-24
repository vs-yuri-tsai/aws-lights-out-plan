# Deployment Guide

本指南說明如何部署 Lights-Out Lambda 函數至 AWS。

## 前置條件

### 必要工具
- **Node.js:** 20+ ([安裝指南](https://nodejs.org/))
- **pnpm:** 最新版本 (`npm install -g pnpm`)
- **AWS CLI:** 已設定 (`aws configure`)
- **Serverless Framework:** 已安裝（透過 pnpm 自動安裝）

### AWS 權限
- Lambda 建立與管理
- IAM Role 建立
- SSM Parameter 存取
- CloudFormation Stack 建立（Serverless Framework 使用）
- EventBridge Rule 建立

## 部署方式

### TypeScript + Serverless Framework（推薦）

本專案使用 Serverless Framework 自動化部署，簡化配置與管理。

### Step 1: 安裝相依套件

```bash
cd aws-lights-out-plan/typescript
pnpm install
```

Serverless Framework 會自動建立所需的 IAM Role，包含以下權限：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECS",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:UpdateService",
        "ecs:ListServices",
        "ecs:DescribeClusters"
      ],
      "Resource": "*"
    },
    {
      "Sid": "RDS",
      "Effect": "Allow",
      "Action": [
        "rds:DescribeDBInstances",
        "rds:StartDBInstance",
        "rds:StopDBInstance"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Tagging",
      "Effect": "Allow",
      "Action": ["tag:GetResources"],
      "Resource": "*"
    },
    {
      "Sid": "SSM",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:*:*:parameter/lights-out/*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

### Step 2: 建立 SSM Parameter

建立配置參數（使用 YAML 格式）：

```bash
# 1. 建立配置檔案
cat > /tmp/lights-out-config.yml <<'EOF'
version: "1.0"
environment: workshop
region: ap-southeast-1

discovery:
  method: tags
  tagFilters:
    lights-out:managed: "true"
    lights-out:env: workshop
  resourceTypes:
    - ecs-service
    - rds-instance

resourceDefaults:
  ecs-service:
    waitForStable: false
    stableTimeoutSeconds: 300
    defaultDesiredCount: 1
  rds-instance:
    skipFinalSnapshot: true
    waitTimeout: 600

overrides: {}

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
EOF

# 2. 上傳至 SSM Parameter Store
aws ssm put-parameter \
  --name "/lights-out/workshop/config" \
  --type "String" \
  --value "file:///tmp/lights-out-config.yml" \
  --description "Lights-Out configuration for workshop environment" \
  --region ap-southeast-1
```

參考範例檔案：`docs/ssm-config-examples/workshop.yml`

### Step 3: 為資源加標籤

為 ECS Service 與 RDS Instance 加上必要標籤。參考 [tagging-guide.md](./tagging-guide.md)

### Step 4: 部署 Lambda Function

```bash
cd typescript

# 部署至開發環境
pnpm sls deploy --stage dev

# 部署至 Workshop 環境
pnpm sls deploy --stage workshop

# 部署至 Staging 環境
pnpm sls deploy --stage staging

# 部署至生產環境
pnpm sls deploy --stage prod
```

Serverless Framework 會自動執行：
- 建立 IAM Role（含所需權限）
- 建立 Lambda Function（Node.js 20 runtime）
- 設定環境變數
- 建立 CloudWatch Log Group
- 部署最佳化的程式碼包（使用 esbuild）

### Step 5: 測試部署

```bash
# 測試 discover action
pnpm sls invoke -f lights-out --stage workshop --data '{"action":"discover"}'

# 測試 status action
pnpm sls invoke -f lights-out --stage workshop --data '{"action":"status"}'

# 測試 stop action (dry-run)
pnpm sls invoke -f lights-out --stage workshop --data '{"action":"stop","dryRun":true}'

# 測試 start action (dry-run)
pnpm sls invoke -f lights-out --stage workshop --data '{"action":"start","dryRun":true}'

# 查看 Lambda 日誌
pnpm sls logs -f lights-out --stage workshop --tail
```

### Step 6: 建立 EventBridge Rules

使用 AWS Console 或 AWS CLI 建立排程規則：

#### 使用 AWS CLI

```bash
# Stop Rule (每天 19:00 台北時間 = UTC 11:00)
aws events put-rule \
  --name lights-out-workshop-stop \
  --schedule-expression "cron(0 11 ? * MON-FRI *)" \
  --state ENABLED \
  --region ap-southeast-1

# 新增 Lambda 為 target
aws events put-targets \
  --rule lights-out-workshop-stop \
  --targets "Id"="1","Arn"="arn:aws:lambda:ap-southeast-1:ACCOUNT_ID:function:lights-out-workshop","Input"='{"action":"stop"}' \
  --region ap-southeast-1

# Start Rule (每天 09:00 台北時間 = UTC 01:00)
aws events put-rule \
  --name lights-out-workshop-start \
  --schedule-expression "cron(0 1 ? * MON-FRI *)" \
  --state ENABLED \
  --region ap-southeast-1

# 新增 Lambda 為 target
aws events put-targets \
  --rule lights-out-workshop-start \
  --targets "Id"="1","Arn"="arn:aws:lambda:ap-southeast-1:ACCOUNT_ID:function:lights-out-workshop","Input"='{"action":"start"}' \
  --region ap-southeast-1

# 賦予 EventBridge 執行 Lambda 的權限
aws lambda add-permission \
  --function-name lights-out-workshop \
  --statement-id AllowEventBridgeInvoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:ap-southeast-1:ACCOUNT_ID:rule/lights-out-workshop-* \
  --region ap-southeast-1
```

#### 使用 AWS Console

1. **EventBridge** → **Rules** → **Create rule**
2. **Stop Rule:**
   - Name: `lights-out-workshop-stop`
   - Schedule: `cron(0 11 ? * MON-FRI *)`
   - Target: Lambda → `lights-out-workshop`
   - Input: `{"action":"stop"}`
3. **Start Rule:**
   - Name: `lights-out-workshop-start`
   - Schedule: `cron(0 1 ? * MON-FRI *)`
   - Target: Lambda → `lights-out-workshop`
   - Input: `{"action":"start"}`

---

## 監控與維護

### 查看 Lambda 日誌

```bash
# 即時查看日誌
pnpm sls logs -f lights-out --stage workshop --tail

# 查看最近的日誌
pnpm sls logs -f lights-out --stage workshop --startTime 1h

# 使用 AWS CLI 查看
aws logs tail /aws/lambda/lights-out-workshop --follow --region ap-southeast-1
```

### 更新部署

```bash
# 修改程式碼後重新部署
cd typescript
pnpm build
pnpm sls deploy --stage workshop

# 僅更新函數程式碼（快速部署）
pnpm sls deploy function -f lights-out --stage workshop
```

### 移除部署

```bash
# 移除整個 CloudFormation Stack
pnpm sls remove --stage workshop
```

---

## 故障排除

### Lambda 執行失敗

1. 檢查 CloudWatch Logs
2. 確認 IAM Role 權限正確
3. 確認 SSM Parameter 存在且格式正確
4. 確認資源標籤正確

### 資源未被發現

1. 確認資源有正確的標籤
2. 檢查 SSM 配置中的 `tagFilters`
3. 使用 `discover` action 測試

### EventBridge 未觸發

1. 確認 EventBridge Rule 狀態為 ENABLED
2. 確認 cron 表達式正確
3. 確認 Lambda 有權限被 EventBridge 觸發

---

## 附錄

### 版本歷史

- **v2.0 (2025-12-24)**: TypeScript 實作，統一使用 Serverless Framework 部署
- **v1.0 (2025-12-17)**: Python 原型（已移除）
