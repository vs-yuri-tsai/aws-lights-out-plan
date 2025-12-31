# AWS Lights Out Plan

> 自動在非工作時間關閉 AWS 開發環境資源（ECS Service、RDS Instance 等）以節省成本。支援 Tag-based 資源發現，透過 Serverless Framework 部署至多 Region。

## 📋 專案概述

**目標:** 降低非營業時間的 AWS 成本（預估節省 60-70%）
**範圍:** Workshop/Staging 環境
**架構:** Serverless（Lambda + EventBridge + SSM Parameter Store）

### 核心功能

- ✅ Tag-based 資源自動發現
- ✅ 支援 ECS Service 與 RDS Instance 管理
- ✅ ECS Application Auto Scaling 整合（條件式偵測）
- ✅ 資源優先級控制（避免依賴問題）
- ✅ TypeScript + AWS SDK v3 實作
- ✅ Serverless Framework 多 Region 部署
- 🚧 未來支援更多資源類型（NAT Gateway、Lambda 等）
- 🚧 未來支援 MCP AI Agent 手動控制

---

## 🛠️ 技術棧

| 類別 | 技術 |
|------|------|
| **Runtime** | TypeScript 5.9 + Node.js 20.x |
| **Framework** | Serverless Framework + serverless-esbuild |
| **Trigger** | EventBridge (Cron) |
| **Config** | SSM Parameter Store (YAML) |
| **Discovery** | Resource Groups Tagging API |
| **ECS Auto Scaling** | Application Auto Scaling API (conditional detection) |
| **Testing** | Vitest + aws-sdk-client-mock |
| **Logging** | Pino (JSON structured logs) |
| **Validation** | Zod |

### 開發工具

- **Type Checking:** TypeScript strict mode
- **Bundling:** esbuild (ESM bundling)
- **Testing:** Vitest with coverage
- **Linting:** ESLint

---

## 🚀 快速開始

### 前置需求

- **Node.js:** 20+ (推薦使用 [nvm](https://github.com/nvm-sh/nvm))
- **pnpm:** 最新版本 (`npm install -g pnpm`)
- **AWS CLI:** 已配置 (用於部署)
- **權限:** 能存取目標 AWS 帳號

### 本機開發環境設置

```bash
# 1. Clone 專案
git clone https://github.com/ViewSonic/aws-lights-out-plan.git
cd aws-lights-out-plan

# 2. 安裝相依套件
pnpm install

# 3. 驗證安裝
node --version  # 應顯示 v20.x.x
pnpm --version
pnpm tsc --version

# 4. 型別檢查
pnpm type-check

# 5. 執行測試
pnpm test
```

### 執行測試

```bash
# 執行所有測試
pnpm test

# 監視模式（開發時使用）
pnpm test:watch

# 產生覆蓋率報告
pnpm test:coverage

# 型別檢查
pnpm type-check

# Linting
pnpm lint
```

---

## 📁 專案結構

```ini
aws-lights-out-plan/
├── src/
│   ├── index.ts                # Lambda handler 入口
│   ├── types.ts                # 共用型別定義
│   ├── core/
│   │   ├── config.ts           # SSM 配置載入 (LRU cache)
│   │   ├── orchestrator.ts     # 資源操作協調
│   │   └── scheduler.ts        # 時區與假日邏輯
│   ├── discovery/
│   │   └── tag-discovery.ts    # Tag-based 資源發現
│   ├── handlers/
│   │   ├── base.ts             # ResourceHandler 介面
│   │   ├── ecsService.ts      # ECS Service Handler
│   │   └── rdsInstance.ts     # RDS Instance Handler
│   └── utils/
│       └── logger.ts           # Pino 結構化 logging
│
├── tests/                      # Vitest 測試
├── config/                     # SSM 配置範本
├── docs/
│   └── deployment-guide.md     # 完整部署與操作手冊
├── scripts/                    # Helper scripts
├── serverless.yml              # Serverless Framework IaC
├── tsconfig.json               # TypeScript 配置 (strict mode)
├── vitest.config.ts            # Vitest 配置
├── package.json                # 相依套件
├── AGENTS.md                   # Agent 協作文件
├── TASKS.md                    # 任務追蹤
└── CLAUDE.md                   # AI Agent 專案規範
```

**Why this structure:**

- `handlers/` 模組化：實作 `ResourceHandler` 介面新增資源類型
- `discovery/` 抽象化：配置與程式碼分離，資源清單動態發現
- `core/` 業務邏輯：可注入 mock clients，方便單元測試
- 嚴格型別系統：Zod runtime validation + TypeScript compile-time checks

---

## 🏷️ 資源標籤規範

所有需要管理的資源**必須**具備以下標籤：

```ini
lights-out:managed  = true              # 是否納管
lights-out:env      = workshop          # 環境名稱 (workshop/dev/staging)
lights-out:priority = 100               # 優先級（數字越小越先啟動/越後關閉）
lights-out:schedule = default           # 排程群組（可選）
```

**範例:**

```bash
# ECS Service 標籤
aws ecs tag-resource \
  --resource-arn arn:aws:ecs:ap-southeast-1:123456789012:service/my-cluster/my-service \
  --tags key=lights-out:managed,value=true \
         key=lights-out:env,value=workshop \
         key=lights-out:priority,value=50
```

詳見 [docs/deployment-guide.md - 標記 AWS 資源](./docs/deployment-guide.md#step-4-標記-aws-資源)

---

## 🔧 日常操作指令

本專案提供互動式 CLI，所有操作透過選單進行。

### Lambda 操作（啟動/停止資源）

```bash
# 互動式選單：選擇環境和動作（start/stop/status/discover）
npm run action

# 執行流程：
# 1. 選擇目標環境（airsync-dev 或 sss-lab）
# 2. 選擇操作（Start/Stop/Status/Discover）
# 3. 自動呼叫對應的 Lambda 函數
```

### SSM 配置管理

```bash
# 互動式選單：上傳或下載 SSM Parameter Store 配置
npm run config

# 執行流程：
# 1. 選擇目標環境
# 2. 選擇操作：
#    - Upload: 部署本地 YAML 到 SSM Parameter Store
#    - Retrieve: 從 SSM 下載當前配置
```

### 部署 Lambda

```bash
# 互動式選單：完整部署或僅更新 Lambda 程式碼
npm run deploy

# 執行流程：
# 1. 選擇目標環境
# 2. 選擇部署模式：
#    - All: 完整 Serverless 部署（infrastructure + Lambda）
#    - Lambda Only: 僅更新 Lambda 函數程式碼（快速部署）
```

### 開發測試

```bash
# 型別檢查
npm run type-check

# 執行測試
npm test

# 測試覆蓋率
npm run test:coverage
```

---

## 📖 相關文件

- **[CLAUDE.md](./CLAUDE.md)** - AI Agent 專案規範（開始此處）
- **[AGENTS.md](./AGENTS.md)** - 多 Agent 協作規範 + 技術規格
- **[TASKS.md](./TASKS.md)** - Milestone 與任務追蹤
- **[docs/deployment-guide.md](./docs/deployment-guide.md)** - 完整部署與操作手冊
- **[config/sss-lab.yml](./config/sss-lab.yml)** - 配置範例（含詳細註解）

---

## 🤝 開發協作

### Commit 規範

```html
<type>(<scope>): <description>

type: feat|fix|docs|refactor|test|chore
scope: core|discovery|handlers|config|infra|docs
```

**範例:**

```bash
git commit -m "feat(handlers): implement RDS instance handler"
git commit -m "test(core): add scheduler timezone tests"
git commit -m "docs(deployment): update Lambda IAM requirements"
```

### TDD 工作流程

1. **Red** - 撰寫失敗的測試 (`tests/`)
2. **Green** - 實作最少程式碼讓測試通過 (`src/`)
3. **Refactor** - 重構程式碼（保持測試通過）

詳見 [AGENTS.md - TDD Development Workflow](./AGENTS.md#tdd-development-workflow)

### Code Review Checklist

- [ ] TypeScript strict mode 通過
- [ ] 函式有明確的返回型別
- [ ] Error handling 正確（不中斷整體流程）
- [ ] Dry-run 模式有支援
- [ ] Logging 有結構化輸出（Pino）
- [ ] 測試覆蓋率 ≥ 80%
- [ ] Zod schema 有定義（runtime validation）

---

## 📊 專案狀態

### 當前階段

- [x] Phase 0: 專案初始化（文件規劃）
- [x] Phase 1.1: Python 原型實作（已移除）
- [x] Phase 1.2: TypeScript 完整實作（ECS + RDS Handler）
- [x] Phase 1.3: AWS 環境設定與部署（sss-lab account）
- [x] Phase 1.4: 排程與驗證（EventBridge + 手動觸發測試）
- [ ] Phase 2: 更多資源類型支援（NAT Gateway、Lambda 等）
- [ ] Phase 3: MCP 整合

### Phase 1 部署成果（2025-12-29）

**部署環境:** sss-lab AWS Account (091947912308)
**Lambda 函數:** lights-out-sss-lab-handler
**排程規則:**
- 每週一至五 09:00 TPE 自動啟動資源
- 每週一至五 19:00 TPE 自動停止資源

**驗證完成項目:**
- ✅ Lambda Function 部署與 IAM 權限配置
- ✅ SSM Parameter Store 配置管理
- ✅ 資源標籤（ECS Service + RDS Instance）
- ✅ 手動觸發測試（discover/status/stop/start actions）
- ✅ EventBridge 排程規則自動觸發
- ✅ Dry-run 模式驗證

### 技術決策

| 決策 | 選擇 | 理由 | 日期 |
|------|------|------|------|
| 主要語言 | TypeScript | 現代化、型別安全、AWS SDK v3 | 2025-12-23 |
| Runtime | Node.js 20 | Lambda 最新穩定版本 | 2025-12-23 |
| 部署方式 | Serverless Framework | 自動化部署、簡化配置 | 2025-12-23 |
| 打包工具 | esbuild | 快速、輕量級打包 | 2025-12-23 |
| 測試框架 | Vitest | 現代化、快速、原生 ESM 支援 | 2025-12-23 |
| Phase 1 範圍 | ECS + RDS | 涵蓋常用資源類型 | 2025-12-23 |
| Python 移除 | 2025-12-24 | 統一使用 TypeScript | 2025-12-24 |
| 首次部署環境 | sss-lab | PoC 驗證環境 | 2025-12-29 |
| EventBridge 排程 | 09:00-19:00 TPE | 週一至五自動啟停 | 2025-12-29 |
| ECS Auto Scaling 整合 | 條件式偵測模式 | 支援 MinCapacity/MaxCapacity 管理 | 2025-12-30 |

---

## 📝 License

Internal project for ViewSonic development team.

---

## 🙋 支援

- **Issues:** [GitHub Issues](https://github.com/ViewSonic/aws-lights-out-plan/issues)
- **Docs:** 參考 `docs/` 目錄
- **Contact:** DevOps Team
