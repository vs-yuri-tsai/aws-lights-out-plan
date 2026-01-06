# AWS Lights-Out Plan - TODO & Technical Debt

**Last Updated**: 2026-01-05
**Priority Legend**: 🔴 Critical | 🟡 High | 🟢 Medium | 🔵 Low

---

## 🔴 Critical Tasks

### Critical 1: Microsoft Teams Webhooks Migration (Due: 2025-12-31)

**背景**：Microsoft 已於 2025-01-31 廢棄 Office 365 Connectors（舊版 Incoming Webhooks）。

**影響**：

- ❌ 無法透過 Connectors 建立新的 webhooks
- ⚠️ 現有的 connectors 將於 **2025-12-31** 停止運作
- ✅ 必須遷移到 **Power Automate Workflows**

**時程規劃**：建議在 **2025-11-30 前完成遷移**（留 1 個月緩衝）

#### Task 0.1: 遷移到 Workflows Webhooks

**預估時間**: 1 天（如果已有現有 webhooks）
**優先級**: 🔴 Critical（僅當使用舊版 Connectors 時）
**Owner**: TBD
**Deadline**: 2025-11-30

##### Checklist

- [ ] **識別現有 webhooks**
  - [ ] 列出所有使用舊版 Connectors 的專案
  - [ ] 記錄舊的 webhook URLs

- [ ] **建立 Workflows webhooks**
  - [ ] 在每個 Teams channel 建立新的 Workflow
    1. Channel → `...` → `Workflows`
    2. 搜尋 "Post to a channel when a webhook request is received"
    3. 配置並儲存
  - [ ] 複製新的 webhook URLs（格式：`logic.azure.com`）

- [ ] **更新 DynamoDB 配置**

  ```bash
  # 為每個專案更新 webhook_url
  aws dynamodb update-item \
    --table-name lights-out-teams-config-poc \
    --key '{"project": {"S": "airsync-dev"}}' \
    --update-expression "SET webhook_url = :url" \
    --expression-attribute-values '{":url": {"S": "https://prod-XX.logic.azure.com/..."}}'
  ```

- [ ] **測試新 webhooks**
  - [ ] 手動觸發資源狀態變更
  - [ ] 驗證 Teams 通知正常

- [ ] **停用舊 webhooks**
  - [ ] 在 Teams 中移除舊的 Connectors

- [ ] **文件更新**
  - [ ] 更新內部文件的 webhook URLs

**參考資料**：

- [Create incoming webhooks with Workflows](https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498)
- [Retirement of Office 365 connectors](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)

---

### Critical 2: Node.js 22.x Migration (Due: 2026-04-30)

**背景**：AWS Lambda 將於 **2026-04-30** 停止支援 Node.js 20.x runtime ([AWS 公告](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html))。

**影響範圍**：

- ❌ 2026-05-01 後無法建立新的 Node.js 20.x Lambda functions
- ⚠️ 現有 functions 可繼續運作，但無安全性更新
- ❌ 無法更新使用 Node.js 20.x 的 functions

**時程規劃**：建議在 **2026-03-31 前完成升級**（留 1 個月緩衝）

---

### Task 1.1: 升級到 Node.js 22.x Runtime

**預估時間**: 3-4 天
**優先級**: 🔴 Critical
**Owner**: TBD
**Deadline**: 2026-03-31

#### Checklist

- [ ] **環境準備**
  - [ ] 本地安裝 Node.js 22.x
    ```bash
    # macOS (使用 nvm)
    nvm install 22
    nvm use 22
    node --version  # 確認是 v22.x.x
    ```
  - [ ] 更新 `.nvmrc`（如果有使用）
    ```bash
    echo "22" > .nvmrc
    ```

- [ ] **package.json 更新**
  - [ ] 更新 `engines` 欄位
    ```json
    {
      "engines": {
        "node": ">=22.0.0 <23.0.0"
      }
    }
    ```
  - [ ] 驗證所有依賴與 Node.js 22 相容
    ```bash
    npm install
    npm test
    ```

- [ ] **serverless.yml 更新**
  - [ ] 更新所有 `runtime` 設定

    ```yaml
    provider:
      runtime: nodejs22.x

    functions:
      handler:
        runtime: nodejs22.x
      teamsNotifier:
        runtime: nodejs22.x
    ```

  - [ ] 更新 `esbuild.target`
    ```yaml
    custom:
      esbuild:
        target: node22
    ```

- [ ] **測試驗證**
  - [ ] 本地單元測試通過
    ```bash
    npm test
    npm run test:coverage
    ```
  - [ ] 型別檢查無錯誤
    ```bash
    npm run type:check
    ```
  - [ ] 部署到測試環境（poc）
    ```bash
    npm run deploy
    ```
  - [ ] 手動測試所有功能
    - [ ] EventBridge scheduled start/stop
    - [ ] Manual Lambda invoke (status/discover)
    - [ ] Teams notifications

- [ ] **文件更新**
  - [ ] 更新 `README.md` 的 Node.js 版本要求
  - [ ] 更新 `docs/teams-integration.md`
  - [ ] 更新 `docs/teams-phase1-deployment.md`

- [ ] **生產環境部署**
  - [ ] 排程維護時間窗口
  - [ ] 備份現有 Lambda configurations
  - [ ] 部署到生產環境
  - [ ] 監控 CloudWatch Logs（24 小時）
  - [ ] 驗證所有排程正常執行

---

### Task 1.2: 升級到 ES Modules (ESM)

**預估時間**: 2-3 天
**優先級**: 🟡 High（與 Task 1.1 一併處理）
**Owner**: TBD
**Deadline**: 2026-03-31

**Why**: Node.js 22.x 完全支援 ESM，且 node-fetch@3.x 要求 ESM

#### Checklist

- [ ] **package.json 設定**
  - [ ] 新增 `"type": "module"`
    ```json
    {
      "type": "module"
    }
    ```
  - [ ] 更新依賴到 ESM 相容版本
    - [ ] `node-fetch`: `2.7.0` → `3.3.2`
    - [ ] 驗證其他依賴是否支援 ESM

- [ ] **tsconfig.json 更新**
  - [ ] 修改 module 設定
    ```json
    {
      "compilerOptions": {
        "module": "ES2022",
        "moduleResolution": "bundler",
        "target": "ES2022"
      }
    }
    ```

- [ ] **程式碼重構**
  - [ ] 更新所有 import 路徑（加 `.js` 副檔名）

    ```typescript
    // Before
    import { setupLogger } from '@utils/logger';

    // After
    import { setupLogger } from '@utils/logger.js';
    ```

  - [ ] 替換 `__dirname` 和 `__filename`

    ```typescript
    // Before
    const __dirname = path.dirname(__filename);

    // After
    import { fileURLToPath } from 'url';
    import { dirname } from 'path';
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    ```

  - [ ] 更新 dynamic imports

    ```typescript
    // Before
    const config = require('./config.json');

    // After
    import config from './config.json' assert { type: 'json' };
    ```

- [ ] **esbuild 配置**
  - [ ] 更新 `serverless.yml`
    ```yaml
    custom:
      esbuild:
        format: 'esm'
        platform: 'node'
        target: 'node22'
    ```

- [ ] **測試更新**
  - [ ] 更新 Vitest 配置（如需要）
  - [ ] 確保所有測試通過
  - [ ] 驗證 aws-sdk-client-mock 與 ESM 相容

- [ ] **文件更新**
  - [ ] 記錄 ESM 遷移過程
  - [ ] 更新開發者指南

---

## 🟡 High Priority - Teams Integration Enhancements

### Task 2.1: Phase 2 - 雙向指令功能

**預估時間**: 1.5 週
**優先級**: 🟡 High
**Owner**: TBD
**Deadline**: TBD（Phase 1 完成後 2 週內）

**Blocked by**: Phase 1 部署成功並收集使用者回饋

#### Checklist

- [ ] **Azure Bot 註冊**
  - [ ] 申請 Azure AD tenant admin 權限
  - [ ] 在 Azure Portal 建立 Bot Registration
  - [ ] 取得 Bot App ID 和 App Password
  - [ ] 儲存到 AWS SSM Parameter Store
    - [ ] `/lights-out/{stage}/bot-app-id`
    - [ ] `/lights-out/{stage}/bot-app-password` (SecureString)

- [ ] **DynamoDB Schema 擴展**
  - [ ] 更新 `TeamsConfig` 介面
    ```typescript
    interface TeamsConfig {
      project: string;
      webhook_url: string;
      allowed_users: {
        [email: string]: {
          role: 'viewer' | 'operator';
          actions: LambdaAction[];
        };
      };
      created_at: string;
      updated_at: string;
    }
    ```
  - [ ] 建立資料遷移腳本

- [ ] **實作 teams-bot-handler Lambda**
  - [ ] 安裝 `botbuilder` SDK
  - [ ] 實作指令解析邏輯
  - [ ] 整合 Azure AD OAuth
  - [ ] 權限驗證
  - [ ] 調用 `lights-out-handler`
  - [ ] 格式化回應（Adaptive Cards）

- [ ] **API Gateway 設定**
  - [ ] 建立 `/webhook/teams` endpoint
  - [ ] 設定 Rate Limiting
  - [ ] Bot Token 驗證

- [ ] **測試**
  - [ ] 單元測試
  - [ ] 整合測試
  - [ ] 端到端測試（Teams → AWS）

- [ ] **文件**
  - [ ] 撰寫 Phase 2 部署指南
  - [ ] 更新 `docs/teams-integration.md`

---

### Task 2.2: CLI 工具開發（多專案管理）

**預估時間**: 2-3 天
**優先級**: 🟢 Medium
**Owner**: TBD
**Deadline**: TBD（專案數 > 3 時）

**Trigger**: 當需要管理 3+ 個專案時啟動

#### Checklist

- [ ] **實作 CLI 工具**
  - [ ] `scripts/teams-onboard.ts` - 新增專案
  - [ ] `scripts/teams-sync.ts` - 同步配置到 DynamoDB
  - [ ] `scripts/teams-validate.ts` - 驗證 YAML 格式
  - [ ] `scripts/teams-list.ts` - 列出所有專案
  - [ ] `scripts/teams-user-add.ts` - 新增使用者
  - [ ] `scripts/teams-user-remove.ts` - 移除使用者

- [ ] **Configuration as Code**
  - [ ] 建立 `config/teams/` 目錄結構
    ```
    config/teams/
    ├── poc/
    │   ├── airsync-dev.yml
    │   └── product-b-dev.yml
    └── prod/
        └── airsync-prod.yml
    ```
  - [ ] 定義 YAML schema（Zod validation）

- [ ] **package.json scripts**
  - [ ] `teams:onboard`
  - [ ] `teams:sync`
  - [ ] `teams:sync-all`
  - [ ] `teams:validate`
  - [ ] `teams:list`
  - [ ] `teams:user:add`
  - [ ] `teams:user:remove`

- [ ] **Pre-commit Hook**
  - [ ] 驗證 Teams config 變更
  - [ ] 檢查未同步的配置

- [ ] **文件**
  - [ ] CLI 工具使用指南
  - [ ] Configuration as Code 最佳實踐

---

## 🟢 Medium Priority - Code Quality & DevOps

### Task 3.1: 增加測試覆蓋率

**預估時間**: 3 天
**優先級**: 🟢 Medium
**Owner**: TBD
**Target**: 80% coverage

#### Checklist

- [ ] **Teams 模組單元測試**
  - [ ] `src/teams/adaptiveCard.test.ts`
    - [ ] `createStateChangeCard()` 各種狀態
    - [ ] `getStatusIndicator()` edge cases
    - [ ] `formatTimestamp()` timezone handling
  - [ ] `src/teams/config.test.ts`
    - [ ] Cache hit/miss 邏輯
    - [ ] DynamoDB 錯誤處理
    - [ ] 配置驗證
  - [ ] `src/teams/notifier.test.ts`
    - [ ] ECS event 處理
    - [ ] RDS event 處理
    - [ ] Resource tags 提取
    - [ ] Teams webhook 調用

- [ ] **整合測試**
  - [ ] EventBridge → Lambda 流程
  - [ ] DynamoDB → Lambda 流程
  - [ ] 錯誤重試機制

- [ ] **E2E 測試（可選）**
  - [ ] 模擬 ECS 狀態變更
  - [ ] 驗證 Teams 通知接收

---

### Task 3.2: 監控與告警

**預估時間**: 1 天
**優先級**: 🟢 Medium
**Owner**: TBD

#### Checklist

- [ ] **CloudWatch Alarms**
  - [ ] Lambda Errors > 5%
  - [ ] Lambda Duration > 5 秒
  - [ ] API Gateway 4xx > 10 req/min
  - [ ] DynamoDB Throttled Requests

- [ ] **CloudWatch Dashboard**
  - [ ] Lambda invocations 趨勢
  - [ ] Teams 通知成功率
  - [ ] DynamoDB 讀寫 capacity
  - [ ] 成本追蹤

- [ ] **SNS Topic（可選）**
  - [ ] 設定告警通知目標
  - [ ] 整合 Slack/Email

---

### Task 3.3: 安全性增強

**預估時間**: 2 天
**優先級**: 🟢 Medium
**Owner**: TBD

#### Checklist

- [ ] **Secrets Rotation**
  - [ ] Teams Webhook URL 定期輪換（建議每季）
  - [ ] Bot credentials 輪換機制

- [ ] **DynamoDB 加密**
  - [ ] 驗證 SSE (Server-Side Encryption) 已啟用
  - [ ] 考慮使用 AWS KMS Customer Managed Keys

- [ ] **IAM Least Privilege Review**
  - [ ] 檢視 Lambda IAM role 權限
  - [ ] 移除不必要的 `Resource: '*'`
  - [ ] 套用 condition keys

- [ ] **Audit Logging**
  - [ ] 啟用 CloudTrail（如未啟用）
  - [ ] 記錄所有 DynamoDB 操作
  - [ ] 記錄所有 Lambda invocations

---

## 🔵 Low Priority - Future Enhancements

### Task 4.1: Terraform Module（自動 Tagging）

**預估時間**: 2 天
**優先級**: 🔵 Low
**Trigger**: 當使用 Terraform 管理基礎設施時

#### Checklist

- [ ] 建立 `terraform/modules/lights-out-resource/`
- [ ] 定義標準化 tags 輸出
- [ ] 撰寫使用範例
- [ ] 文件化

---

### Task 4.2: Web Admin UI（可選）

**預估時間**: 1 週
**優先級**: 🔵 Low
**Trigger**: 專案數 > 10 且非技術人員需要管理

#### Checklist

- [ ] 技術選型（React / Next.js）
- [ ] 功能規劃
  - [ ] 專案列表
  - [ ] 使用者管理
  - [ ] 配置編輯
  - [ ] 操作日誌
- [ ] 部署方式（S3 + CloudFront / Amplify）

---

### Task 4.3: 支援更多 AWS 資源類型

**預估時間**: 每種資源 1 天
**優先級**: 🔵 Low
**Trigger**: 使用者明確需求

#### Checklist

- [ ] EC2 Instances
  - [ ] Handler 實作
  - [ ] EventBridge rule
  - [ ] 測試
- [ ] Aurora Clusters
  - [ ] Handler 實作
  - [ ] EventBridge rule
  - [ ] 測試
- [ ] ElastiCache Clusters
- [ ] Redshift Clusters

---

## 📊 Progress Tracking

### Sprint 1 (2026-01-06 ~ 2026-01-19)

- [x] Phase 1: Teams 單向通知實作
- [ ] Task 1.1: Node.js 22.x 升級（進行中）
- [ ] Task 1.2: ESM 遷移（進行中）

### Sprint 2 (2026-01-20 ~ 2026-02-02)

- [ ] Phase 2: Teams 雙向指令實作
- [ ] Task 3.1: 測試覆蓋率提升

### Sprint 3 (2026-02-03 ~ 2026-02-16)

- [ ] Task 2.2: CLI 工具開發
- [ ] Task 3.2: 監控與告警
- [ ] Task 3.3: 安全性增強

---

## 🔗 Related Documents

- [README.md](./README.md) - 專案概述
- [CLAUDE.md](./CLAUDE.md) - AI Agent 規則
- [docs/teams-integration.md](./docs/teams-integration.md) - Teams 整合技術文件
- [docs/teams-phase1-deployment.md](./docs/teams-phase1-deployment.md) - Phase 1 部署指南
- [docs/deployment-guide.md](./docs/deployment-guide.md) - 一般部署指南

---

## 📝 Notes

### Node.js 20.x EOL Timeline

- **2024-10-29**: Node.js 20.x 進入 Maintenance LTS
- **2026-04-30**: Node.js 20.x EOL（End of Life）
- **2026-05-01**: AWS Lambda 停止支援 Node.js 20.x

**參考資料**:

- [Node.js Release Schedule](https://github.com/nodejs/release#release-schedule)
- [AWS Lambda Runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)

### ESM Migration Benefits

- ✅ 與現代 JavaScript 生態系統一致
- ✅ 更好的 tree-shaking（減少 bundle size）
- ✅ 原生支援 top-level await
- ✅ 更嚴格的模組邊界（減少 circular dependencies）
- ✅ 可使用最新版本的套件（如 node-fetch@3.x）

### Cost Optimization Checklist

每季檢查一次：

- [ ] 檢視 CloudWatch Logs retention（預設 Never expire）
  - 建議：保留 30 天即可，節省成本
- [ ] 檢視 Lambda memory size 是否過度配置
  - teams-notifier: 256MB 是否足夠？
- [ ] 檢視 DynamoDB 讀寫次數
  - 如果 > 1000 reads/month，考慮調整 cache TTL
- [ ] 檢視 unused EventBridge rules
  - 停用測試用的 rules

---

**Owner**: @tsaiyu
**Reviewers**: TBD
**Status**: Active
