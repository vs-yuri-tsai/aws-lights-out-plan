# Task Tracking

> 詳細任務分解與進度追蹤。Agent 協作時請同步更新此文件。

## Phase 1: ECS Service MVP

### Milestone 1.1: 核心程式碼開發 (目前)

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| 建立專案結構 | - | 🔲 | src/lambda_function/ 目錄與 __init__.py |
| 實作 utils/logger.py | - | ✅ | 結構化 JSON logging |
| 實作 core/config.py | - | ✅ | SSM 配置載入與驗證 |
| 實作 discovery/base.py | Gemini CLI | ✅ | DiscoveredResource 與 ResourceDiscovery 介面 |
| 實作 discovery/tag_discovery.py | Gemini CLI | ✅ | Tag-based 資源發現 |
| 實作 handlers/base.py | - | 🔲 | ResourceHandler 抽象類別 |
| 實作 handlers/ecs_service.py | - | 🔲 | ECS Service 啟停邏輯 |
| 實作 core/scheduler.py | - | 🔲 | 時區/工作日判斷 |
| 實作 core/orchestrator.py | - | 🔲 | 執行協調器 |
| 實作 app.py | - | 🔲 | Lambda handler |
| 撰寫單元測試 | Gemini CLI | 🔄 | tests/ 目錄，使用 moto。已完成 tests/unit/test_utils_logger.py 的撰寫。 |
| 2025-12-09 | 專案規劃與文件建立 | Claude | CLAUDE.md, AGENTS.md, 部署指南等 |
| 2025-12-10 | 建立架構流程圖 | Gemini CLI | docs/diagram.md |
| 2025-12-10 | 新增 TDD 開發規範 | Gemini CLI | 更新 AGENTS.md |

### Milestone 1.2: AWS 設定

| Task | Owner | Status | Notes |
|------|-------|--------|-------|
| 建立 IAM Role | - | 🔲 | 見 AGENTS.md IAM 規格 |
| 建立 SSM Parameter | - | 🔲 | /lights-out/workshop/config |
| 為 ECS Service 加標籤 | - | 🔲 | lights-out:* tags |
| 建立 Lambda Function | - | 🔲 | Python 3.11, 256MB, 5min |
| 測試 status action | - | 🔲 | 手動 invoke |

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
| 2025-12-12 | 實作 utils/logger.py | Gemini CLI | 已完成 |
| 2025-12-12 | 實作 core/config.py | Gemini CLI | 依據 TDD 完成實作 |
| 2025-12-12 | 實作 discovery/base.py | Gemini CLI | 依據 TDD 完成介面定義與實作 |
| 2025-12-12 | 實作 discovery/tag_discovery.py | Gemini CLI | 依據 TDD 完成實作 |
