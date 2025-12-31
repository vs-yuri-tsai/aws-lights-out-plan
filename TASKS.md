# Task Tracking

> 詳細任務分解與進度追蹤。Agent 協作時請同步更新此文件。

## 📊 進度總覽

| Phase | Milestone | Status | Progress |
|-------|-----------|--------|----------|
| Phase 1 | TypeScript 實作 | ✅ 完成 | 100% |
| Phase 1 | Python 原型 | ✅ 已移除 | - |
| Phase 1 | AWS 設定與部署 | ✅ 完成 | 100% |
| Phase 1 | 排程與驗證 | ✅ 完成 | 100% |
| Phase 2 | 更多資源類型 | 🔲 未排程 | - |
| Phase 3 | MCP 整合 | 🔲 未排程 | - |

### 🎯 Phase 1 成果總結

#### TypeScript 實作（完成日期: 2025-12-24）

**專案統計**:

- 核心模組: 10+ 個（100% 完成）
- 測試檔案: 完整單元測試與整合測試
- Runtime: TypeScript 5.9 + Node.js 20.x
- Framework: Serverless Framework + esbuild
- Testing: Vitest + aws-sdk-client-mock
- Validation: Zod runtime validation

**核心架構**:

```ini
src/
├── index.ts                  ✅ Lambda handler（4 actions + 錯誤處理）
├── types.ts                  ✅ 共用型別定義
├── core/
│   ├── config.ts             ✅ SSM 配置載入（LRU cache）
│   ├── scheduler.ts          ✅ 時區/假日判斷
│   └── orchestrator.ts       ✅ 執行協調（結果聚合 + 日誌）
├── discovery/
│   └── tag-discovery.ts      ✅ Tag-based 資源發現
├── handlers/
│   ├── base.ts               ✅ ResourceHandler 介面
│   ├── ecsService.ts        ✅ ECS Service Handler
│   └── rdsInstance.ts       ✅ RDS Instance Handler
└── utils/
    └── logger.ts             ✅ Pino 結構化日誌
```

#### Python 原型（2025-12-17 完成，2025-12-24 移除）

Python 原型實作已完成階段性任務並移除，專案統一使用 TypeScript 實作。此階段驗證了核心架構設計的可行性。

**下一步**: Phase 1 已全部完成。可開始規劃 Phase 2（更多資源類型支援）或 Phase 3（MCP 整合）

---

## Phase 1: Lambda 函數實作

### Milestone 1.1: Python 原型 ✅ **COMPLETED & REMOVED**

Python 原型實作已完成並移除（2025-12-24）。此階段驗證了核心架構設計的可行性，包含 8 個核心模組、100+ 測試案例。

### Milestone 1.2: TypeScript 實作 ✅ **COMPLETED**

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| 建立 TypeScript 專案結構 | Claude | ✅ | 根目錄、package.json、tsconfig.json |
| 實作 utils/logger.ts | Claude | ✅ | Pino 結構化 JSON logging |
| 實作 types.ts | Claude | ✅ | 共用型別定義（Config, Resource, HandlerResult 等） |
| 實作 core/config.ts | Claude | ✅ | SSM 配置載入（AWS SDK v3 + LRU cache） |
| 實作 core/scheduler.ts | Claude | ✅ | 時區與假日邏輯（date-fns-tz） |
| 實作 discovery/tag-discovery.ts | Claude | ✅ | Tag-based 資源發現（AWS SDK v3） |
| 實作 handlers/base.ts | Claude | ✅ | ResourceHandler 介面 |
| 實作 handlers/ecsService.ts | Claude | ✅ | ECS Service 啟停邏輯（AWS SDK v3） |
| 實作 handlers/rdsInstance.ts | Claude | ✅ | RDS Instance 啟停邏輯（AWS SDK v3） |
| 實作 core/orchestrator.ts | Claude | ✅ | 執行協調器 |
| 實作 index.ts | Claude | ✅ | Lambda handler 入口（4 actions） |
| 設定 Serverless Framework | Claude | ✅ | serverless.yml + esbuild + 多 region |
| 撰寫測試 | Claude | ✅ | Vitest 完整測試覆蓋 |
| TypeScript strict mode 驗證 | Claude | ✅ | 全部模組通過 strict 檢查 + Zod validation |
| 移除 Python 實作 | Claude | ✅ | 統一使用 TypeScript（2025-12-24） |

### Milestone 1.3: AWS 設定與部署 ✅ **COMPLETED**

完成日期: 2025-12-29

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| 建立 IAM Role | DevOps | ✅ | Serverless Framework 自動建立（含 ECS + RDS 權限） |
| 建立 SSM Parameter | DevOps | ✅ | /lights-out/config（手動創建，YAML 轉 JSON） |
| 為資源加標籤 | DevOps | ✅ | 已標記 sss-lab 環境資源 |
| 部署 Lambda Function | DevOps | ✅ | 使用 Serverless Framework v3.39.0 部署至 sss-lab |
| 測試 discover action | DevOps | ✅ | 驗證資源發現功能（aws lambda invoke） |
| 測試 status action | DevOps | ✅ | 手動 invoke 驗證成功 |
| 測試 stop action | DevOps | ✅ | 驗證 ECS desiredCount=0 + RDS stop（含 dry-run） |
| 測試 start action | DevOps | ✅ | 驗證 ECS 恢復 + RDS start（含 dry-run） |

### Milestone 1.4: 排程與驗證 ✅ **COMPLETED**

完成日期: 2025-12-29

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| 建立 EventBridge Rule (stop) | DevOps | ✅ | cron(0 11 ? * MON-FRI *) - 每日 19:00 TPE 停止資源 |
| 建立 EventBridge Rule (start) | DevOps | ✅ | cron(0 1 ? * MON-FRI *) - 每日 09:00 TPE 啟動資源 |
| 端到端測試 (stop) | DevOps | ✅ | 確認 ECS + RDS 正常關閉 |
| 端到端測試 (start) | DevOps | ✅ | 確認 ECS + RDS 正常啟動 |
| 文件更新 | DevOps | ✅ | 已更新 deployment-guide.md 與相關文件 |

---

## Phase 2: RDS Handler (已完成於 TypeScript)

| Task | Status | Notes |
|------|--------|-------|
| 設計 RDS handler 介面 | ✅ | 已整合至 TypeScript 實作 |
| 實作 RDS start/stop | ✅ | rdsInstance.ts（使用 AWS SDK v3） |
| 測試 RDS handler | ✅ | 整合於 TypeScript 測試套件 |

## Phase 3: 其他資源類型支援 (未來)

| Task | Status | Notes |
|------|--------|-------|
| NAT Gateway handler | 🔲 | 刪除/重建流程 |
| Lambda Function handler | 🔲 | Reserved concurrency 調整 |
| DynamoDB handler | 🔲 | On-Demand ↔ Provisioned 切換 |

---

## Phase 4: MCP 整合 (未來)

| Task | Status | Notes |
|------|--------|-------|
| 定義 MCP 介面 | 🔲 | |
| 實作排程修改 API | 🔲 | |
| 實作臨時啟動 API | 🔲 | |
| 中文自然語言解析 | 🔲 | |

---

## Done Log

### Python 實作階段

| Date | Task | Agent | Notes |
|------|------|-------|-------|
| 2025-12-09 | 專案規劃與文件建立 | Claude | CLAUDE.md, AGENTS.md, 部署指南等 |
| 2025-12-10 | 建立架構流程圖 | Gemini CLI | docs/diagram.md |
| 2025-12-10 | 新增 TDD 開發規範 | Gemini CLI | 更新 AGENTS.md |
| 2025-12-12 | 實作 utils/logger.py | Gemini CLI | 結構化 JSON logging |
| 2025-12-12 | 實作 core/config.py | Gemini CLI | SSM 配置載入與驗證（含測試） |
| 2025-12-12 | 實作 discovery/base.py | Gemini CLI | DiscoveredResource 與 ResourceDiscovery 介面 |
| 2025-12-12 | 實作 discovery/tag_discovery.py | Gemini CLI | Tag-based 資源發現（含測試） |
| 2025-12-15 | 實作 handlers/base.py | Gemini CLI | ResourceHandler 抽象類別 + HandlerResult |
| 2025-12-16 | 實作 handlers/ecs_service.py | Gemini CLI | ECS Service 完整實作（含 moto 測試） |
| 2025-12-16 | 實作 core/scheduler.py | Gemini CLI | 時區/工作日判斷邏輯 |
| 2025-12-17 | 實作 core/orchestrator.py | Claude | 執行協調器（重構：錯誤處理 + 日誌 + action 參數） |
| 2025-12-17 | 實作 handlers/factory.py | Claude | Handler Registry Pattern（ECS Handler 註冊） |
| 2025-12-17 | 整合測試 | Claude | Orchestrator + Factory + Handler 完整流程測試 |
| 2025-12-17 | 實作 app.py | Claude | Lambda 入口點（TDD：10 測試案例全通過） |
| 2025-12-17 | 測試修正與文件 | Claude | 修正 MagicMock 序列化問題 + 完整測試指南 |

### TypeScript 實作階段

| Date | Task | Agent | Notes |
|------|------|-------|-------|
| 2025-12-18 | TypeScript 專案初始化 | Claude | 建立 typescript/ 目錄、設定檔 |
| 2025-12-19 | 實作核心型別定義 | Claude | types.ts（Config, Resource, HandlerResult 等） |
| 2025-12-19 | 實作 utils/logger.ts | Claude | 結構化 JSON logging（TypeScript） |
| 2025-12-20 | 實作 core/config.ts | Claude | SSM 配置載入（AWS SDK v3） |
| 2025-12-20 | 實作 discovery/tagDiscovery.ts | Claude | Tag-based 資源發現（AWS SDK v3） |
| 2025-12-21 | 實作 handlers/base.ts | Claude | ResourceHandler 介面定義 |
| 2025-12-21 | 實作 handlers/factory.ts | Claude | Handler Factory Pattern |
| 2025-12-22 | 實作 handlers/ecsService.ts | Claude | ECS Service Handler（AWS SDK v3） |
| 2025-12-22 | 實作 handlers/rdsInstance.ts | Claude | RDS Instance Handler（AWS SDK v3） |
| 2025-12-23 | 實作 core/orchestrator.ts | Claude | 執行協調器 |
| 2025-12-23 | 實作 index.ts | Claude | Lambda handler 入口 |
| 2025-12-23 | Serverless Framework 設定 | Claude | serverless.yml + esbuild 整合 |
| 2025-12-23 | TypeScript 測試完成 | Claude | 307 個測試檔案完成 |
