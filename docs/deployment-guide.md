# Deployment Guide

本指南說明如何部署 Lights-Out Lambda 函數至 AWS。

## 前置條件

- **Node.js:** 20.x (使用 nvm 管理版本)
- **pnpm:** 最新版本
- **AWS CLI:** 已設定且能成功執行 `aws sts get-caller-identity`

## 完整部署流程

### Step 1: 環境準備

```bash
# 切換到 Node.js 20.x
nvm use 20

# 安裝依賴
pnpm install

# 型別檢查
pnpm type:check
```

### Step 2: AWS Credentials 設定

本專案的互動式 CLI 會自動處理 AWS SSO credentials 轉換。

```bash
# 1. 確保已登入 SSO
aws sso login --profile <your-profile>

# 2. 驗證登入狀態
aws sts get-caller-identity --profile <your-profile>

# 3. 使用互動式 CLI 部署（會自動處理 credentials）
pnpm deploy
```

如果遇到問題，可手動導出 credentials：

```bash
eval $(aws configure export-credentials --profile <your-profile> --format env)
pnpm deploy
```

### Step 3: 部署

```bash
# 互動式部署
pnpm deploy

# 選擇：
# 1. 目標環境（從 scripts/arguments/ 中選擇）
# 2. 部署模式：
#    - All: 完整 Serverless 部署
#    - Lambda Only: 僅更新 Lambda 程式碼（快速）
```

### Step 4: 上傳配置

```bash
# 互動式配置管理
pnpm config

# 選擇：
# 1. 目標環境
# 2. Upload: 上傳 YAML 配置到 SSM Parameter Store
```

### Step 5: 驗證

```bash
# 測試 Lambda
pnpm action

# 選擇：
# 1. 目標環境
# 2. Discover: 發現帶有 lights-out tags 的資源
# 3. Status: 檢查資源狀態
```

---

## 新增專案

### 1. 建立配置檔案

```bash
# 建立 argument 檔案
cat > scripts/arguments/new-project.json <<'EOF'
{
  "scope": "project",
  "region": "us-east-1",
  "stage": "pg-development-new-project",
  "profile": "pg-development",
  "function-name": "lights-out-pg-development-new-project",
  "config": {
    "name": "/lights-out/pg-development-new-project/config",
    "path": "config/pg-development/new-project.yml",
    "description": "Lights Out configuration for new-project"
  }
}
EOF

# 複製並修改 YAML 配置
cp config/sss-lab.yml config/pg-development/new-project.yml
```

### 2. 更新 serverless.yml

在 `custom.resolveConfigPath` 中新增映射：

```yaml
custom:
  resolveConfigPath:
    pg-development-new-project: pg-development/new-project.yml
```

### 3. 標記 AWS 資源

```bash
aws ecs tag-resource \
  --resource-arn <ARN> \
  --tags \
    Key=lights-out:managed,Value=true \
    Key=lights-out:group,Value=new-project \
    Key=lights-out:priority,Value=50 \
  --region <region>
```

> 💡 **Priority 說明**：數字越小 = 越先啟動、越後關閉。建議 RDS 用 10，ECS 用 50。

### 4. 部署

```bash
pnpm deploy   # 選擇 new-project
pnpm config   # 選擇 Upload
pnpm action   # 選擇 Discover 驗證
```

---

## ECS Service 配置

### Auto Scaling Mode（有 Application Auto Scaling）

```yaml
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      minCapacity: 2
      maxCapacity: 6
      desiredCount: 2
    stop:
      minCapacity: 0
      maxCapacity: 0
      desiredCount: 0
```

### Direct Mode（無 Application Auto Scaling）

```yaml
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      desiredCount: 1
    stop:
      desiredCount: 0
```

Lambda 會在執行時動態偵測 Service 是否有 Auto Scaling。

---

## RDS Instance 配置

RDS 採用 Fire-and-Forget 模式（避免 Lambda timeout）：

```yaml
resource_defaults:
  rds-db:
    waitAfterCommand: 60 # 發送命令後等待秒數
    skipSnapshot: true # 開發環境建議跳過 snapshot
```

---

## 常見問題

### Credentials 問題

```bash
# 錯誤：The security token included in the request is invalid
# 解決：
rm -rf ~/.aws/sso/cache/*
aws sso login --profile <profile>
eval $(aws configure export-credentials --profile <profile> --format env)
```

### Discovered Count 為 0

檢查：

1. 標籤拼寫是否正確（`lights-out:managed` 不是 `lightsout:managed`）
2. 配置檔案的 `discovery.tags` 是否與實際資源 tag 一致
3. 配置檔案的 `regions` 是否包含資源所在 region

### Lambda 日誌查看

```bash
aws logs tail /aws/lambda/lights-out-<stage>-handler \
  --follow \
  --region <region>
```

---

## 移除部署

```bash
# 刪除 CloudFormation Stack
npx serverless remove --stage <stage>

# 手動刪除 SSM Parameter
aws ssm delete-parameter \
  --name "/lights-out/<stage>/config" \
  --region <region>
```

---

## 相關文件

- [CLAUDE.md](../CLAUDE.md) - 專案架構與規範
- [config/sss-lab.yml](../config/sss-lab.yml) - 配置範例
- [serverless.yml](../serverless.yml) - Infrastructure as Code
