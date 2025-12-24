# Deployment Guide

本指南說明如何部署 Lights-Out Lambda 函數至 AWS。

## 前置條件

### 必要工具
- **Node.js:** 20.x (嚴格要求，使用 nvm 管理版本)
- **pnpm:** 最新版本 (`npm install -g pnpm`)
- **AWS CLI:** 已設定 login session
- **Serverless Framework:** v3.39.0+ (透過 pnpm 自動安裝)

### AWS 權限
- Lambda 建立與管理
- IAM Role 建立
- SSM Parameter 存取
- CloudFormation Stack 建立（Serverless Framework 使用）
- EventBridge Rule 建立

---

## 重要限制與決策

### Serverless Framework 版本選擇

**使用 v3.39.0（非 v4）原因:**
- Serverless Framework v4 對年營收 >$2M 組織要求付費訂閱
- 本專案為 PoC 性質，使用免費的 v3 版本
- v3 與 v4 功能差異對本專案無影響

**相容性配置:**
- `serverless@3.39.0` + `serverless-esbuild@1.57.0`
- Node.js 20.x runtime (Lambda 與本地環境一致)
- `provider.runtime` 必須在 `serverless.yml` provider 層級明確定義

---

## 部署流程

### Step 1: 環境準備

```bash
# 1. 切換到 Node.js 20.x
nvm install 20
nvm use 20
node -v  # 確認為 v20.x.x

# 2. 安裝依賴
pnpm install

# 3. 型別檢查
pnpm run type-check
```

### Step 2: 配置檔案準備

本專案使用 **stage-based 配置管理**，配置檔案位於 `config/` 目錄。

#### 配置檔案結構

```
config/
├── sss-lab.yml       # 原始 YAML 配置
├── sss-lab.json      # 中間 JSON 格式
└── sss-lab.json.txt  # 字串化 JSON (用於 SSM Parameter)
```

#### 創建新環境配置

```bash
# 1. 複製範例配置
cp config/sss-lab.yml config/your-stage.yml

# 2. 編輯配置
vim config/your-stage.yml

# 3. 生成 SSM Parameter 所需的字串化 JSON
node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const config = yaml.load(fs.readFileSync('config/your-stage.yml', 'utf8'));
fs.writeFileSync('config/your-stage.json', JSON.stringify(config, null, 2));
" && cat config/your-stage.json | jq -c . > config/your-stage.json.txt
```

#### 配置檔案範例

參考 [config/sss-lab.yml](../config/sss-lab.yml) 的完整範例。

**關鍵配置說明:**

```yaml
version: "1.0"
environment: sss-lab           # 環境識別符（對應 AWS 帳號別名）

regions:                       # 資源掃描的 AWS Regions
  - ap-southeast-1
  - ap-northeast-1

discovery:
  method: tags
  tags:                        # 資源必須有這些標籤才會被管理
    lights-out:managed: "true"
    lights-out:env: sss-lab
  resource_types:
    - ecs:service
    - rds:db

schedules:
  default:
    timezone: Asia/Taipei      # 時區設定
    startTime: "09:00"         # 每天啟動時間
    stopTime: "19:00"          # 每天關閉時間
    activeDays:                # 工作日
      - MON
      - TUE
      - WED
      - THU
      - FRI
    holidays: []               # 國定假日清單（YYYY-MM-DD）
```

### Step 3: AWS Credentials 設定

**問題:** Serverless Framework v3 無法直接讀取 AWS CLI login session。

**解決方法:**

```bash
# 方法 A: 匯出環境變數（推薦用於 CI/CD 或臨時部署）
eval $(aws configure export-credentials --format env)

# 驗證 credentials
aws sts get-caller-identity

# 方法 B: 配置 SSO Profile（推薦用於日常開發）
aws configure sso --profile sss-lab
aws sso login --profile sss-lab
export AWS_PROFILE=sss-lab
```

**注意事項:**
- 臨時憑證有效期通常為 8 小時
- 部署前務必驗證 `aws sts get-caller-identity` 成功
- 如遇 `security token expired` 錯誤，重新執行 `eval $(aws configure export-credentials --format env)`

### Step 4: 部署前驗證

```bash
# 1. 測試打包（不部署）
npx serverless package --stage sss-lab

# 2. 檢查生成的 CloudFormation template
cat .serverless/cloudformation-template-update-stack.json | jq '.Resources | keys'

# 3. 驗證配置載入
cat .serverless/cloudformation-template-update-stack.json | \
  jq '.Resources.LightsOutConfigParameter.Properties.Value'
```

### Step 5: 執行部署

```bash
# 完整部署（包含 infrastructure）
npx serverless deploy --stage sss-lab --verbose

# 僅更新 Lambda 程式碼（快速部署）
npx serverless deploy function -f lights-out --stage sss-lab
```

**部署成功輸出範例:**

```
✔ Service deployed to stack lights-out-sss-lab (42s)

endpoint: None
functions:
  lights-out: lights-out-sss-lab-lights-out (1.3 MB)
```

### Step 6: 部署驗證

```bash
# 1. 檢查 CloudFormation Stack 狀態
aws cloudformation describe-stacks \
  --stack-name lights-out-sss-lab \
  --region ap-southeast-1 \
  --query 'Stacks[0].StackStatus'

# 2. 驗證 SSM Parameter
aws ssm get-parameter \
  --name /lights-out/config \
  --region ap-southeast-1 \
  --query 'Parameter.Value' \
  --output text | jq .

# 3. 測試 Lambda 函數
aws lambda invoke \
  --function-name lights-out-sss-lab-lights-out \
  --payload '{"action":"discover"}' \
  --region ap-southeast-1 \
  out.json && cat out.json | jq .

# 4. 檢查 EventBridge Rules
aws events list-rules \
  --name-prefix lights-out-sss-lab \
  --region ap-southeast-1
```

---

## 部署的 AWS 資源

Serverless Framework 會自動建立以下資源：

### Lambda Function
- **Name:** `lights-out-{stage}-lights-out`
- **Runtime:** Node.js 20.x
- **Memory:** 512 MB
- **Timeout:** 300 seconds
- **Handler:** `src/index.main`

### IAM Role
自動生成，包含以下權限：

```yaml
iam:
  role:
    statements:
      - Effect: Allow
        Action: [ssm:GetParameter]
        Resource: arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/lights-out/*
      - Effect: Allow
        Action: [tag:GetResources]
        Resource: "*"
      - Effect: Allow
        Action:
          - ecs:DescribeServices
          - ecs:UpdateService
          - ecs:ListServices
          - ecs:DescribeClusters
        Resource: "*"
      - Effect: Allow
        Action:
          - rds:DescribeDBInstances
          - rds:StartDBInstance
          - rds:StopDBInstance
        Resource: "*"
```

### SSM Parameter
- **Name:** `/lights-out/config`
- **Type:** String
- **Value:** JSON 字串（從 `config/{stage}.json.txt` 載入）
- **Tags:** `project=lights-out`, `managed-by=serverless`, `stage={stage}`

### EventBridge Rules

**Start Rule:** `lights-out-{stage}-start`
- **Schedule:** `cron(0 1 ? * MON-FRI *)` (每週一至五 09:00 台北時間)
- **Input:** `{"action":"start"}`
- **Status:** ENABLED

**Stop Rule:** `lights-out-{stage}-stop`
- **Schedule:** `cron(0 11 ? * MON-FRI *)` (每週一至五 19:00 台北時間)
- **Input:** `{"action":"stop"}`
- **Status:** ENABLED

### CloudWatch Log Group
- **Name:** `/aws/lambda/lights-out-{stage}-lights-out`
- **Retention:** 預設 (無限期)

---

## 常見部署問題

### 1. Runtime Not Supported Error

**錯誤訊息:**
```
AssertionError [ERR_ASSERTION]: not a supported runtime
```

**原因:** `serverless.yml` 缺少 `provider.runtime` 設定。

**解決方法:**
確保 `serverless.yml` 包含：

```yaml
provider:
  name: aws
  runtime: nodejs20.x  # 必須在 provider 層級定義
```

### 2. SSM Parameter Value 型別錯誤

**錯誤訊息:**
```
The following hook(s)/validation failed: [AWS::EarlyValidation::PropertyValidation]
```

**原因:** SSM Parameter 的 `Value` 必須是字串，但 Serverless 將 YAML object 直接轉為 JSON object。

**解決方法:**
使用預先字串化的 JSON 檔案：

```yaml
Value: ${file(./config/${self:provider.stage}.json.txt)}
```

並確保 `.json.txt` 是單行 JSON 字串（非 pretty-printed）。

### 3. AWS Credentials Not Found

**錯誤訊息:**
```
AWS provider credentials not found.
```

**原因:** Serverless Framework 無法讀取 AWS CLI login session。

**解決方法:**
```bash
# 匯出環境變數
eval $(aws configure export-credentials --format env)

# 重新部署
npx serverless deploy --stage sss-lab
```

### 4. Node Version Mismatch

**錯誤訊息:**
```
WARN Unsupported engine: wanted: {"node":">=20.0.0 <21.0.0"} (current: {"node":"v22.12.0"})
```

**解決方法:**
```bash
nvm use 20
node -v  # 確認為 v20.x.x
```

### 5. CloudFormation Intrinsic Function 語法錯誤

**錯誤訊息:**
```
yamllint: unknown tag !<!Sub>
```

**原因:** YAML tag 語法不相容。

**解決方法:**
使用標準 YAML map 語法：

```yaml
# 錯誤
Resource: !Sub "arn:aws:ssm:${AWS::Region}:..."

# 正確
Resource:
  Fn::Sub: "arn:aws:ssm:${AWS::Region}:..."
```

---

## 手動測試

### 測試 Lambda 函數

```bash
# 1. 發現資源
aws lambda invoke \
  --function-name lights-out-sss-lab-lights-out \
  --payload '{"action":"discover"}' \
  --region ap-southeast-1 \
  out.json && cat out.json | jq .

# 2. 檢查資源狀態
aws lambda invoke \
  --function-name lights-out-sss-lab-lights-out \
  --payload '{"action":"status"}' \
  --region ap-southeast-1 \
  out.json && cat out.json | jq .

# 3. 測試停止（Dry Run）
aws lambda invoke \
  --function-name lights-out-sss-lab-lights-out \
  --payload '{"action":"stop","dryRun":true}' \
  --region ap-southeast-1 \
  out.json && cat out.json | jq .

# 4. 實際停止資源
aws lambda invoke \
  --function-name lights-out-sss-lab-lights-out \
  --payload '{"action":"stop"}' \
  --region ap-southeast-1 \
  out.json && cat out.json | jq .

# 5. 啟動資源
aws lambda invoke \
  --function-name lights-out-sss-lab-lights-out \
  --payload '{"action":"start"}' \
  --region ap-southeast-1 \
  out.json && cat out.json | jq .
```

### 查看 Lambda 日誌

```bash
# 使用 Serverless CLI
npx serverless logs -f lights-out --stage sss-lab --tail

# 使用 AWS CLI
aws logs tail /aws/lambda/lights-out-sss-lab-lights-out \
  --follow \
  --region ap-southeast-1 \
  --format short
```

---

## 更新與維護

### 更新 Lambda 程式碼

```bash
# 1. 修改程式碼
vim src/index.ts

# 2. 型別檢查
pnpm run type-check

# 3. 快速部署（僅更新函數程式碼）
npx serverless deploy function -f lights-out --stage sss-lab

# 或完整部署（包含 infrastructure 變更）
npx serverless deploy --stage sss-lab
```

### 更新配置

```bash
# 1. 修改配置檔案
vim config/sss-lab.yml

# 2. 重新生成字串化 JSON
node -e "
const yaml = require('js-yaml');
const fs = require('fs');
const config = yaml.load(fs.readFileSync('config/sss-lab.yml', 'utf8'));
fs.writeFileSync('config/sss-lab.json', JSON.stringify(config, null, 2));
" && cat config/sss-lab.json | jq -c . > config/sss-lab.json.txt

# 3. 重新部署（SSM Parameter 會自動更新）
npx serverless deploy --stage sss-lab

# 4. 驗證 SSM Parameter
aws ssm get-parameter \
  --name /lights-out/config \
  --region ap-southeast-1 \
  --query 'Parameter.Value' \
  --output text | jq .
```

### 更新 EventBridge 排程

直接修改 `serverless.yml` 中的 `events.schedule` 配置：

```yaml
events:
  - schedule:
      rate: cron(0 1 ? * MON-FRI *)  # 修改 cron 表達式
      input:
        action: start
```

重新部署：

```bash
npx serverless deploy --stage sss-lab
```

---

## 移除部署

### 完整移除 Stack

```bash
# 刪除 CloudFormation Stack（包含所有資源）
npx serverless remove --stage sss-lab

# 驗證刪除
aws cloudformation describe-stacks \
  --stack-name lights-out-sss-lab \
  --region ap-southeast-1
# 應該返回 "Stack with id lights-out-sss-lab does not exist"
```

**注意:** `serverless remove` 會刪除：
- Lambda Function
- IAM Role
- SSM Parameter
- EventBridge Rules
- CloudWatch Log Group
- S3 Deployment Bucket (如果為空)

### 保留日誌的移除方式

如果需要保留 CloudWatch Logs：

```bash
# 1. 手動匯出日誌
aws logs create-export-task \
  --log-group-name /aws/lambda/lights-out-sss-lab-lights-out \
  --from $(date -u -d '30 days ago' +%s)000 \
  --to $(date +%s)000 \
  --destination your-s3-bucket \
  --destination-prefix lights-out-logs

# 2. 移除 Stack
npx serverless remove --stage sss-lab
```

---

## 監控與告警

### CloudWatch Metrics

Lambda 預設提供的 Metrics:
- **Invocations:** 執行次數
- **Duration:** 執行時間
- **Errors:** 錯誤次數
- **Throttles:** 被限流次數

查看 Metrics:

```bash
# 最近 1 小時的執行次數
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=lights-out-sss-lab-lights-out \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region ap-southeast-1
```

### 設定 CloudWatch Alarms

```bash
# Lambda 錯誤告警
aws cloudwatch put-metric-alarm \
  --alarm-name lights-out-sss-lab-errors \
  --alarm-description "Lights-Out Lambda errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=FunctionName,Value=lights-out-sss-lab-lights-out \
  --alarm-actions arn:aws:sns:ap-southeast-1:ACCOUNT_ID:your-sns-topic \
  --region ap-southeast-1
```

---

## 多 Region 部署

如需在多個 Region 部署相同的 Stack：

```bash
# 部署至 ap-southeast-1
npx serverless deploy --stage sss-lab --region ap-southeast-1

# 部署至 ap-northeast-1
npx serverless deploy --stage sss-lab --region ap-northeast-1
```

**注意:**
- 每個 Region 會建立獨立的 Stack
- SSM Parameter 需要在每個 Region 單獨建立
- EventBridge Rules 獨立於各 Region

---

## 成本估算

### Lambda 費用
- **Free Tier:** 每月 100 萬次請求 + 400,000 GB-秒運算時間
- **本專案估算:**
  - 每天 2 次執行 (start/stop)
  - 每次執行約 30 秒
  - 512 MB memory
  - **月費用:** 約 $0 (在 Free Tier 內)

### 其他資源費用
- **SSM Parameter (Standard):** 免費
- **EventBridge Rules:** 免費 (前 100 萬次事件)
- **CloudWatch Logs:** $0.50/GB (超過 5GB 後)

**總計:** 對於 PoC 環境，預估月費用 < $1

---

## 相關文件

- [CLAUDE.md](../CLAUDE.md) - 專案架構與規範
- [tagging-guide.md](./tagging-guide.md) - 資源標籤操作指南
- [config/README.md](../config/README.md) - 配置檔案說明
- [serverless.yml](../serverless.yml) - Infrastructure as Code

---

## 版本歷史

### v3.0 (2025-12-24)
- 降級至 Serverless Framework v3.39.0（避免 v4 付費限制）
- 修復 SSM Parameter Value 型別問題（使用字串化 JSON）
- 修復 CloudFormation intrinsic function 語法（使用 `Fn::Sub`）
- 新增 AWS CLI login session credential 匯出流程
- 強制 Node.js 20.x runtime 要求
- 完善故障排除文件

### v2.0 (2025-12-24)
- TypeScript 實作，統一使用 Serverless Framework 部署
- 支援多 Region 資源掃描
- Tag-based 資源發現機制

### v1.0 (2025-12-17)
- Python 原型（已移除）
