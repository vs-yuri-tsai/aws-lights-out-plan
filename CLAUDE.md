# AWS Lights Out Plan

## Context

自動在非工作時間關閉 AWS 開發環境資源（ECS Service、RDS 等）以節省成本。支援 Tag-based 資源發現，透過 Serverless Framework 部署至多 Region。

## Tech Stack

- **Runtime:** TypeScript 5.9 + Node.js 20.x (AWS Lambda)
- **Framework:** Serverless Framework + serverless-esbuild + serverless-better-credentials
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

## ECS Auto Scaling 整合

**問題：** ECS Services 若有 Application Auto Scaling，直接設定 `desiredCount` 會與 scaling policies 衝突。

**解決方案：條件式偵測（Conditional Detection）**

1. **偵測階段**：Lambda 使用 `DescribeScalableTargets` 檢查 service 是否有 Auto Scaling
2. **有 Auto Scaling**：
   - START: 設定 `MinCapacity=N`, `MaxCapacity=M`, `desiredCount=D`
   - STOP: 設定 `MinCapacity=0`, `MaxCapacity=0`
3. **無 Auto Scaling（Legacy Mode）**：
   - START: 設定 `desiredCount=defaultDesiredCount`
   - STOP: 使用 `stopBehavior` (scale_to_zero/reduce_by_count/reduce_to_count)

**配置範例：**

```yaml
resource_defaults:
  ecs-service:
    # Auto Scaling mode (推薦，有 Auto Scaling 的 service 使用)
    autoScaling:
      minCapacity: 2
      maxCapacity: 6
      desiredCount: 3

    # Legacy mode (fallback，無 Auto Scaling 的 service 使用)
    defaultDesiredCount: 1
    stopBehavior:
      mode: scale_to_zero
```

**重要：** 如果 service 有 Auto Scaling 但 config 缺少 `autoScaling` 設定，Lambda 會拋出錯誤要求補充配置。

## Known Issues & Workarounds

### Issue #1: Serverless Framework + AWS SSO Credentials

**問題：** `serverless deploy` 無法正確處理 AWS SSO credentials，出現：
```
EHOSTUNREACH 169.254.169.254:80
Could not load credentials from any providers
```

**解決方案：** 使用互動式 CLI（自動處理 AWS credentials）

```bash
# ✅ 使用互動式 CLI（推薦）
npm run deploy
# 選擇環境 → 選擇部署模式

# ❌ 不要直接用 serverless deploy (SSO 環境會失敗)
# serverless deploy --stage pg-development-airsync-dev
```

**背景機制：** 互動式 CLI 使用 `serverless-better-credentials` plugin 正確處理 SSO credentials

### Issue #2: Config Schema 大小寫

**問題：** YAML config 使用 camelCase (`resourceDefaults`)，但 TypeScript 期望 snake_case (`resource_defaults`)

**解決：** 統一使用 snake_case

```yaml
# ✅ 正確
resource_defaults:
  ecs-service:
    autoScaling: ...

# ❌ 錯誤（會導致 config 讀取為空物件）
resourceDefaults:
  ecs-service:
    autoScaling: ...
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
