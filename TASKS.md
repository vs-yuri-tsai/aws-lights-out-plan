# Task Tracking

> 詳細任務分解與進度追蹤。Agent 協作時請同步更新此文件。

## 📊 進度總覽

| Phase | Milestone | Status | Progress |
|-------|-----------|--------|----------|
| Phase 1 | 1.1 核心程式碼開發 | ✅ 完成 | 100% |
| Phase 1 | 1.2 AWS 設定 | 🔄 進行中 | 0% |
| Phase 1 | 1.3 排程與驗證 | 🔲 待開始 | 0% |
| Phase 2 | NAT Gateway | 🔲 未排程 | - |
| Phase 3 | MCP 整合 | 🔲 未排程 | - |

### 🎯 Milestone 1.1 成果總結

**完成日期**: 2025-12-17

**程式碼統計**:
- 核心模組: 8 個（100% 完成）
- 測試檔案: 11 個（單元測試 + 整合測試）
- 測試案例: 100+ 個（全部通過 ✅）
- 文件檔案: 5 個（完整測試指南 + 範例）

**核心架構**:
```
src/lambda_function/
├── app.py                    ✅ Lambda 入口（4 actions + 錯誤處理）
├── core/
│   ├── config.py             ✅ SSM 配置載入
│   ├── scheduler.py          ✅ 時區/假日判斷
│   └── orchestrator.py       ✅ 執行協調（結果聚合 + 日誌）
├── discovery/
│   ├── base.py               ✅ 資源發現介面
│   └── tag_discovery.py      ✅ Tag-based 發現實作
├── handlers/
│   ├── base.py               ✅ Handler 抽象類別
│   ├── factory.py            ✅ Registry Pattern
│   └── ecs_service.py        ✅ ECS Service Handler
└── utils/
    └── logger.py             ✅ 結構化 JSON 日誌
```

**下一步**: 進入 Milestone 1.2 - AWS 環境設定與部署

---

## Phase 1: ECS Service MVP

### Milestone 1.1: 核心程式碼開發 ✅ **COMPLETED**

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| 建立專案結構 | - | ✅ | src/lambda_function/ 目錄與 __init__.py |
| 實作 utils/logger.py | Gemini CLI | ✅ | 結構化 JSON logging |
| 實作 core/config.py | Gemini CLI | ✅ | SSM 配置載入與驗證 |
| 實作 discovery/base.py | Gemini CLI | ✅ | DiscoveredResource 與 ResourceDiscovery 介面 |
| 實作 discovery/tag_discovery.py | Gemini CLI | ✅ | Tag-based 資源發現 |
| 實作 handlers/base.py | Gemini CLI | ✅ | ResourceHandler 抽象類別 + HandlerResult |
| 實作 handlers/ecs_service.py | Gemini CLI | ✅ | ECS Service 啟停邏輯（含 wait_for_stable） |
| 實作 handlers/factory.py | Claude | ✅ | Handler Registry Pattern，支援動態註冊 |
| 實作 core/scheduler.py | Gemini CLI | ✅ | 時區/工作日判斷 |
| 實作 core/orchestrator.py | Claude | ✅ | 執行協調器（含錯誤處理、日誌、結果聚合） |
| 實作 app.py | Claude | ✅ | Lambda handler（支援 4 種 actions + 錯誤處理） |
| 撰寫單元測試 | Gemini CLI + Claude | ✅ | 完整測試覆蓋（10+ 測試檔案，100+ 測試案例） |
| 整合測試 | Claude | ✅ | tests/integration/test_orchestrator_with_handlers.py |
| 專案規劃與文件建立 | Claude | ✅ | CLAUDE.md, AGENTS.md, 部署指南等 |
| 建立架構流程圖 | Gemini CLI | ✅ | docs/diagram.md |
| 新增 TDD 開發規範 | Gemini CLI | ✅ | 更新 AGENTS.md |
| 範例與使用文件 | Claude | ✅ | examples/orchestrator_usage.py, lambda_local_test.py |
| 測試指南與修正文件 | Claude | ✅ | docs/app-testing-guide.md, test-fixes.md |

### Milestone 1.2: AWS 設定 (目前)

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| 建立 IAM Role | - | 🔲 | 見 AGENTS.md IAM 規格 |
| 建立 SSM Parameter | - | 🔲 | /lights-out/workshop/config |
| 為 ECS Service 加標籤 | - | 🔲 | lights-out:* tags，參考 docs/tagging-guide.md |
| 建立 Lambda Function | - | 🔲 | Python 3.11, 256MB, 5min timeout |
| 上傳程式碼 | - | 🔲 | zip 打包（見 CLAUDE.md） |
| 測試 discover action | - | 🔲 | 驗證資源發現功能 |
| 測試 status action | - | 🔲 | 手動 invoke |
| 測試 stop action | - | 🔲 | 驗證 ECS desiredCount=0 |
| 測試 start action | - | 🔲 | 驗證 ECS 恢復 |

### Milestone 1.3: 排程與驗證

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| 建立 EventBridge Rule (stop) | - | 🔲 | cron(0 11 ? * MON-FRI *) |
| 建立 EventBridge Rule (start) | - | 🔲 | cron(0 1 ? * MON-FRI *) |
| 端到端測試 (stop) | - | 🔲 | 確認 ECS desiredCount=0 |
| 端到端測試 (start) | - | 🔲 | 確認 ECS 恢復 |
| 文件更新 | - | 🔲 | ops guide |

---

## Phase 2: NAT Gateway (未來)

| Task | Status | Notes |
|------|--------|-------|
| 設計 NAT Gateway handler | 🔲 | 刪除/重建流程 |
| Route Table 更新邏輯 | 🔲 | |
| EIP 保留處理 | 🔲 | |
| 依賴順序處理 | 🔲 | NAT 需在 ECS 前啟動 |

---

## Phase 3: MCP 整合 (未來)

| Task | Status | Notes |
|------|--------|-------|
| 定義 MCP 介面 | 🔲 | |
| 實作排程修改 API | 🔲 | |
| 實作臨時啟動 API | 🔲 | |
| 中文自然語言解析 | 🔲 | |

---

## Done Log

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
