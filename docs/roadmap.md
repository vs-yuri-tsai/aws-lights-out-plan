# AWS Lights Out Plan - Roadmap

本文件描述專案的發展藍圖，包含架構設計、開發計畫和階段性目標。

---

## 策略概覽

採用「集中式 + 分散式」並行策略，讓 AWS Lights Out Plan 能快速推廣至多個專案。

```md
+------------------------------------------------------------------+
| PRE-LANDING STRATEGY |
+------------------------------------------------------------------+
| |
| +-- CENTRALIZED MODE --+ +-- DISTRIBUTED MODE --+ |
| | (Quick Onboarding) | | (npm package) | |
| | | | | |
| | edu-aws-lights-out | | @vs-edu/lights-out | |
| | (this repo) | | (published to npm) | |
| | | | | |
| | - Config per project | | - Self-hosted Lambda | |
| | - Shared Lambda | | - Local config | |
| | - scripts/arguments/ | | - Full CLI tools | |
| +----------------------+ +----------------------+ |
+------------------------------------------------------------------+
```

---

## Phase 1: AI Integration（優先）

**目標：** AI 輔助資源探索與 onboarding 評估

**為何優先：** 實務上專案導入 lights-out 時，往往無法完全掌握資源配置。透過 AI 先進行資源探索、評估目前的支援程度，再制定 high-level 的 lights-out plan，可以避免：

- Onboard 階段輸入不適合的配置
- 發現現階段 function 不支援特定資源類型
- 遺漏應納入管理的資源

### 架構

```
+-- MCP SERVER (Primary) --+    +-- CLI Fallback --+
|                          |    |                   |
| Tools:                   |    | Commands:         |
| - discover_resources     |    | - discover        |
| - generate_config        |    | - config validate |
| - apply_tags             |    | - tag scan/apply  |
| - analyze_traffic        |    |                   |
| - cost_diff_report       |    |                   |
+--------------------------+    +-------------------+
```

### 任務清單

| #   | 任務                    | 檔案                                                    | 狀態   |
| --- | ----------------------- | ------------------------------------------------------- | ------ |
| 1.1 | MCP Server 核心         | `/packages/lights-out-mcp/src/server.ts`                | 待開始 |
| 1.2 | discover_resources tool | `/packages/lights-out-mcp/src/tools/discover.ts`        | 待開始 |
| 1.3 | generate_config tool    | `/packages/lights-out-mcp/src/tools/generate-config.ts` | 待開始 |
| 1.4 | apply_tags tool         | `/packages/lights-out-mcp/src/tools/apply-tags.ts`      | 待開始 |
| 1.5 | Traffic Analysis skill  | `/packages/lights-out-mcp/src/skills/traffic.ts`        | 待開始 |
| 1.6 | Cost Diff Report skill  | `/packages/lights-out-mcp/src/skills/cost.ts`           | 待開始 |

### 交付物

- MCP Server 支援 AI-assisted onboarding
- 「描述你的資源」→「探索並評估」→「產生配置建議」工作流程
- 支援程度報告：列出可管理/不支援的資源類型

---

## Phase 2: 集中式增強

**目標：** 基於 AI 分析結果，快速讓多個專案導入

### 任務清單

| #   | 任務                   | 檔案                                | 狀態   |
| --- | ---------------------- | ----------------------------------- | ------ |
| 2.1 | 建立 onboarding script | `/scripts/onboard-project.js`       | 待開始 |
| 2.2 | 建立配置範本           | `/config/templates/project.yml`     | 待開始 |
| 2.3 | 新增專案 argument 配置 | `/scripts/arguments/{project}.json` | 待開始 |
| 2.4 | 新增專案 YAML 配置     | `/config/{account}/{project}.yml`   | 待開始 |
| 2.5 | 撰寫 onboarding 文件   | `/docs/onboarding-guide.md`         | 待開始 |

### 交付物

- `node scripts/onboard-project.js` 互動式建立新專案配置
- 新專案可在 30 分鐘內完成 onboarding（搭配 AI 探索結果）

---

## Phase 3: Package 提取

**目標：** 建立可發布的 npm package

### 任務清單

| #   | 任務                  | 檔案                                  | 狀態   |
| --- | --------------------- | ------------------------------------- | ------ |
| 3.1 | 設定 pnpm workspace   | `/pnpm-workspace.yaml`                | 待開始 |
| 3.2 | 建立 package 結構     | `/packages/lights-out/package.json`   | 待開始 |
| 3.3 | Build 配置            | `/packages/lights-out/tsup.config.ts` | 待開始 |
| 3.4 | Export handler module | `/packages/lights-out/src/index.ts`   | 待開始 |
| 3.5 | 建立 Serverless 範本  | `/packages/lights-out/src/templates/` | 待開始 |

### Package 結構

```ini
@vs-infra/lights-out/
├── dist/
│   ├── index.js              # Main entry point
│   ├── lambda/               # Lambda handler exports
│   └── handlers/             # Resource handlers
├── templates/                # Serverless templates
│   ├── serverless.yml
│   └── config-example.yml
├── bin/
│   └── lights-out.js         # CLI entry point
└── package.json
```

### 交付物

- `@vs-infra/lights-out` package 可發布
- Lambda handler 可作為 module 引入

---

## Phase 4: CLI 開發

**目標：** 一鍵部署體驗

### CLI 命令設計

```bash
npx @vs-infra/lights-out <command> [options]

init                    # 初始化專案
discover                # 發現帶有 lights-out tags 的資源
config upload/retrieve  # 配置管理
deploy                  # 部署 Lambda
invoke                  # 執行 Lambda action
tag scan/apply          # 標籤管理
```

### 任務清單

| #   | 任務               | 檔案                                                | 狀態   |
| --- | ------------------ | --------------------------------------------------- | ------ |
| 4.1 | CLI framework 設定 | `/packages/lights-out/src/cli/index.ts`             | 待開始 |
| 4.2 | init command       | `/packages/lights-out/src/cli/commands/init.ts`     | 待開始 |
| 4.3 | discover command   | `/packages/lights-out/src/cli/commands/discover.ts` | 待開始 |
| 4.4 | deploy command     | `/packages/lights-out/src/cli/commands/deploy.ts`   | 待開始 |
| 4.5 | invoke command     | `/packages/lights-out/src/cli/commands/invoke.ts`   | 待開始 |
| 4.6 | config command     | `/packages/lights-out/src/cli/commands/config.ts`   | 待開始 |
| 4.7 | tag command        | `/packages/lights-out/src/cli/commands/tag.ts`      | 待開始 |

### 交付物

- `npx @vs-infra/lights-out init` 建立完整專案結構
- `npx @vs-infra/lights-out deploy` 一鍵部署

---

## Phase 5: Production 增強（評估）

**目標：** 生產環境功能

| #   | 任務                   | 說明                                            | 狀態   |
| --- | ---------------------- | ----------------------------------------------- | ------ |
| 5.1 | Scheduled Auto Scaling | 整合 Application Auto Scaling scheduled actions | 評估中 |
| 5.2 | EventBridge in IaC     | 更新 Serverless template 支援 IaC 定義          | 評估中 |
| 5.3 | Production 模式配置    | 支援 production 專用的 scaling 策略             | 評估中 |

---

## 技術選型

| 元件            | 選擇                      | 理由                              |
| --------------- | ------------------------- | --------------------------------- |
| CLI Framework   | Commander.js              | 業界標準，TypeScript 支援         |
| Prompts         | @inquirer/prompts         | 專案已使用 prompts                |
| Template Engine | Handlebars                | 簡單，適合 YAML 模板              |
| Build Tool      | tsup                      | 現代 ESM/CJS 雙輸出，基於 esbuild |
| Package Manager | pnpm workspace            | 專案已使用 pnpm                   |
| MCP Server      | @modelcontextprotocol/sdk | 官方 SDK                          |

---

## 風險與緩解

| 風險             | 影響 | 緩解方案                                             |
| ---------------- | ---- | ---------------------------------------------------- |
| 破壞現有部署     | 高   | 不修改現有 Lambda 代碼；package 採用提取而非修改策略 |
| Package 版本衝突 | 中   | 嚴格 semver；AWS SDK 使用 peerDependencies           |
| CLI 複雜度       | 低   | 漸進式揭露：簡單預設值，進階選項                     |
| MCP 可用性       | 低   | CLI 可作為所有操作的 fallback                        |

---

## 決策記錄

1. **AI Integration 優先**：Phase 1
   - 實務上專案導入時無法完全掌握資源配置
   - 先透過 AI 探索資源、評估支援程度
   - 避免 onboard 階段配置錯誤或發現不支援情況
   - 產出 high-level lights-out plan 後再進行實際 onboarding

2. **Landing 模式**：兩者並行
   - 集中式快速推廣
   - 同時開發 package 版本

3. **AI 資料存取**：MCP + CLI
   - MCP Server 為核心
   - CLI 為備援/進階操作

4. **Package 範圍**：完整方案
   - Lambda handler + Serverless 配置 + CLI 工具
   - 一鍵部署體驗

---

**Last Updated**: 2026-01-19
