# Configuration Files

此目錄包含各環境的 Lights Out 配置檔案。

## 檔案結構

```
config/
├── README.md        # 本檔案
├── sss-lab.yml      # sss-lab 環境配置
├── sss-dev.yml      # sss-dev 環境配置（範例）
└── sss-stage.yml    # sss-stage 環境配置（待建立）
```

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

resourceDefaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    defaultDesiredCount: 1
  rds-instance:
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
- **discovery.resource_types**: 要管理的資源類型

### 可選欄位

- **regions**: 要掃描的 AWS regions（未指定時使用 Lambda 部署的 region）
- **resourceDefaults**: 各資源類型的預設行為
- **schedules**: 排程設定（目前由 EventBridge 管理，此欄位保留供未來使用）

## 部署流程

### 部署到 sss-lab

```bash
cd typescript
npm run deploy
# 或
sls deploy --stage sss-lab
```

Serverless Framework 會自動：
1. 讀取 `config/sss-lab.yml`
2. 將內容上傳到 SSM Parameter: `/lights-out/config`
3. Lambda 函數從 SSM 讀取配置

### 部署到其他環境

```bash
# 部署到 sss-dev
sls deploy --stage sss-dev --aws-profile sss-dev

# 部署到 sss-stage
sls deploy --stage sss-stage --aws-profile sss-stage
```

**注意：** 部署前請確保對應的配置檔案存在（如 `config/sss-dev.yml`）

## 修改配置

### 方式 1：修改配置檔案後重新部署（推薦）

```bash
# 1. 編輯配置檔案
vim config/sss-lab.yml

# 2. 重新部署（會自動更新 SSM）
cd typescript
npm run deploy
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

## 常見問題

### Q: 為什麼配置檔案中的 `tags` 與 `resource_types` 使用底線？

A: 這是為了符合 TypeScript 程式碼中的命名慣例（snake_case）。Serverless Framework 會將 YAML 直接序列化為字串上傳到 SSM，Lambda 再用 js-yaml 解析。

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
- [typescript/serverless.yml](../typescript/serverless.yml) - 部署配置
- [src/core/config.ts](../typescript/src/core/config.ts) - 配置載入與驗證
