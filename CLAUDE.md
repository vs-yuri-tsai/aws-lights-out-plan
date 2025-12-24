# AWS Lights Out Plan

## Context

自動在非工作時間關閉 AWS 開發環境資源（ECS Service、RDS 等）以節省成本。支援 Tag-based 資源發現，透過 Serverless Framework 部署至多 Region。

## Tech Stack

- **Runtime:** TypeScript 5.9 + Node.js 20.x (AWS Lambda)
- **Framework:** Serverless Framework + serverless-esbuild
- **Trigger:** EventBridge (cron) + SSM Parameter Store (config)
- **Discovery:** Resource Groups Tagging API
- **Testing:** Vitest + aws-sdk-client-mock
- **Logging:** Pino (JSON structured logs)
- **Validation:** Zod

## Architecture

```
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
│   ├── ecs-service.ts  # ECS service handler
│   └── rds-instance.ts # RDS instance handler
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
```
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
- [docs/tagging-guide.md](./docs/tagging-guide.md) — 標籤操作指南
- [serverless.yml](./serverless.yml) — Infrastructure as Code
