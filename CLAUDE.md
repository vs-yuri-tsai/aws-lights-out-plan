# AWS Lights Out Plan

## Context

自動在非工作時間關閉 AWS 開發環境資源（ECS Service、RDS 等）以節省成本。支援 Tag-based 資源發現，透過 Serverless Framework 部署至多 Region。

## Tech Stack

- **Runtime:** TypeScript 5.9 + Node.js 22.x (AWS Lambda)
- **Framework:** Serverless Framework + serverless-esbuild
- **Trigger:** EventBridge (cron) + SSM Parameter Store (config)
- **Discovery:** Resource Groups Tagging API
- **Auto Scaling:** Application Auto Scaling API (conditional detection)
- **Testing:** Vitest + aws-sdk-client-mock
- **Logging:** Pino (JSON structured logs)
- **Validation:** Zod

## Architecture

```ini
src/
├── index.ts            # Lambda handler entry point
├── types.ts            # Shared type definitions
├── core/
│   ├── config.ts       # SSM config loader with LRU cache
│   ├── orchestrator.ts # Resource operation orchestration
│   └── scheduler.ts    # Timezone & holiday logic
├── discovery/
│   └── tag-discovery.ts # Tag-based resource discovery
├── handlers/
│   ├── base.ts         # Abstract ResourceHandler interface
│   ├── ecsService.ts  # ECS service handler
│   └── rdsInstance.ts # RDS instance handler
└── utils/
    └── logger.ts       # Pino logger setup
```

**Why this structure:**

- `handlers/` 模組化：新增資源類型實作 `ResourceHandler` 介面即可
- `discovery/` 抽象化：配置與程式碼分離，資源清單動態發現
- `core/` 業務邏輯：可注入 mock clients，方便單元測試
- 嚴格型別系統：Zod runtime validation + TypeScript compile-time checks

## Conventions

**Tags（必須）:**

```ini
lights-out:managed  = true
lights-out:env      = workshop | dev | staging
lights-out:priority = 100    # 數字越小越優先（啟動先/關閉後）
```

**Lambda actions:** `start`, `stop`, `status`, `discover`

**Error handling:** 單一資源失敗不中斷整體流程（fail-fast: false）

**Commits:** `<type>(<scope>): <description>`

- type: `feat|fix|docs|refactor|test`
- scope: `core|discovery|handlers|config|infra`

## AI Agent Rules

**CRITICAL - DO NOT AUTO-EXECUTE:**

- ❌ **NEVER** 自動執行 `npm test` 或任何測試指令
- ❌ **NEVER** 自動執行 `npm run deploy`
- ❌ **NEVER** 自動執行 `aws lambda invoke`
- ✅ **ALWAYS** 僅提供指令，由開發者確認後在終端中執行

**Why:** 避免意外執行測試或部署影響 AWS 資源狀態。

**CRITICAL - 依賴管理 (Dependency Management):**

遇到依賴相關問題時（版本衝突、API 變更、配置格式等），**必須**先使用 Context7 MCP 取得最新文檔：

- ✅ 使用 `mcp__context7__resolve-library-id` 查詢 library ID
- ✅ 使用 `mcp__context7__query-docs` 取得版本資訊與最新文檔
- ✅ 適用場景：ESLint、Prettier、Husky、AWS SDK、Serverless Framework 等工具

**Why:** 避免使用過時的配置格式或 API（如 ESLint v9 flat config、Husky v9 移除 `husky install`）。

## ECS Service 配置

**問題：** ECS Services 若有 Application Auto Scaling，直接設定 `desiredCount` 會與 scaling policies 衝突。

**解決方案：統一的 start/stop 配置（v3.3+）**

使用統一的 `start` 和 `stop` 配置，支援兩種模式：

1. **Auto Scaling Mode**（有 Application Auto Scaling）：
   - 同時提供 `minCapacity`、`maxCapacity` 和 `desiredCount`
   - START: 設定 `MinCapacity=N`, `MaxCapacity=M`, `desiredCount=D`
   - STOP: 設定 `MinCapacity=0`, `MaxCapacity=0`, `desiredCount=0`

2. **Direct Mode**（無 Application Auto Scaling）：
   - 僅提供 `desiredCount`
   - START: 設定 `desiredCount=N`
   - STOP: 設定 `desiredCount=0`

**配置範例：**

```yaml
# Auto Scaling mode（有 Application Auto Scaling 的 service）
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

# Direct mode（無 Application Auto Scaling 的 service）
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      desiredCount: 1
    stop:
      desiredCount: 0
```

**運作機制：** Lambda 在執行時會動態偵測 service 是否有 Auto Scaling，並根據配置中是否提供 `minCapacity`/`maxCapacity` 來決定使用哪種 API。

## RDS Instance 配置

**問題：** RDS 啟動/停止需要 5-10 分鐘完成，會超過 Lambda timeout 限制（通常設定 5-15 分鐘）。

**解決方案：Fire-and-Forget 模式**

Handler 採用「發送命令後短暫等待即返回」的策略：

1. 發送 `StartDBInstance` 或 `StopDBInstance` 命令
2. 等待 `waitAfterCommand` 秒（預設 60 秒）確認狀態轉換已開始
3. 發送 Teams 通知（標註為「進行中」而非「已完成」）
4. 立即返回，讓後續 ECS 操作可以接續執行

**配置參數：**

| 參數               | 類型    | 預設值 | 說明                                   |
| ------------------ | ------- | ------ | -------------------------------------- |
| `waitAfterCommand` | number  | 60     | 發送命令後等待秒數，確認狀態轉換已開始 |
| `skipSnapshot`     | boolean | true   | 停止時是否跳過創建 snapshot            |

**skipSnapshot 使用情境：**

| 環境             | 建議值            | 原因                               |
| ---------------- | ----------------- | ---------------------------------- |
| Development/Test | `true`            | 每日啟停不需要備份，節省儲存成本   |
| Staging          | `true` 或 `false` | 視資料重要性決定                   |
| 重要資料         | `false`           | 每次停止前保留 snapshot 作為還原點 |

**成本考量：** 每個 snapshot 都會產生儲存成本。對於每日 lights-out 週期，累積的 snapshot 成本可能相當可觀。

**配置範例：**

```yaml
resource_defaults:
  rds-db:
    waitAfterCommand: 60 # 發送命令後等待 60 秒
    skipSnapshot: true # 開發環境建議跳過 snapshot


  # 需要備份的環境
  # rds-db:
  #   waitAfterCommand: 60
  #   skipSnapshot: false       # 每次停止前創建 snapshot
```

**Snapshot 命名規則：** 當 `skipSnapshot: false` 時，snapshot 會以 `lights-out-{instance-id}-{timestamp}` 格式命名。

**Teams 通知訊息範例：**

- 成功：`DB instance stop initiated (status: stopping, was: available). Full stop takes ~5-10 minutes.`
- 失敗：`Stop operation failed`

## Known Issues & Workarounds

### Issue #1: Serverless Framework + AWS SSO Credentials ✅ RESOLVED

**問題（已解決）：** Serverless Framework 無法正確處理 AWS SSO credentials，出現 `EHOSTUNREACH 169.254.169.254:80` 錯誤。

**解決方案（v4.0+）：** 互動式 CLI 現在會自動將 SSO credentials 轉換為標準環境變數

```bash
# ✅ 使用互動式 CLI（推薦）
npm run deploy
# 選擇環境 → 選擇部署模式
# Script 會自動執行 `aws configure export-credentials` 並注入環境變數

# ✅ 如果部署失敗，請先確認 SSO session 有效
aws sso login --profile <profile-name>
```

**背景機制：**

- `run-interactive.js` 使用 `aws configure export-credentials` 自動導出 SSO credentials
- 轉換為標準的 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN`
- Serverless Framework 直接使用標準 credentials（無需特殊 plugin）
- **已移除 `serverless-better-credentials` 依賴**

### Issue #2: Config Schema 大小寫

**問題：** YAML config 使用 camelCase (`resourceDefaults`)，但 TypeScript 期望 snake_case (`resource_defaults`)

**解決：** 統一使用 snake_case

```yaml
# ✅ 正確
resource_defaults:
  ecs-service:
    start:
      desiredCount: 1

# ❌ 錯誤（會導致 config 讀取為空物件）
resourceDefaults:
  ecs-service:
    start:
      desiredCount: 1
```

## Quick Commands

```bash
# 本地測試
pnpm test              # Run all tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # With coverage report

# 型別檢查
pnpm build             # TypeScript compile check (no emit)

# 部署
pnpm deploy            # Deploy to POC stage
pnpm deploy:prod       # Deploy to production

# 手動觸發
aws lambda invoke \
  --function-name lights-out-poc-handler \
  --payload '{"action":"status"}' \
  out.json
```

## Related Docs

- [AGENTS.md](./AGENTS.md) — 多 Agent 協作 + 技術規格
- [TASKS.md](./TASKS.md) — 任務追蹤
- [docs/deployment-guide.md](./docs/deployment-guide.md) — 完整部署與操作手冊
- [config/sss-lab.yml](./config/sss-lab.yml) — 配置範例（含詳細註解）
- [serverless.yml](./serverless.yml) — Infrastructure as Code
