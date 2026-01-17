# AWS Lights Out Plan

自動在非工作時間關閉 AWS 開發環境資源（ECS Service、RDS Instance 等）以節省成本。

## 核心功能

- Tag-based 資源自動發現
- 支援 ECS Service 與 RDS Instance 管理
- ECS Application Auto Scaling 整合
- 資源優先級控制（避免依賴問題）
- Regional scheduling 支援多時區排程
- Teams 通知整合

## 技術棧

| 類別      | 技術                           |
| --------- | ------------------------------ |
| Runtime   | TypeScript 5.9 + Node.js 20.x  |
| Framework | Serverless Framework + esbuild |
| Trigger   | EventBridge (Cron)             |
| Config    | SSM Parameter Store (YAML)     |
| Discovery | Resource Groups Tagging API    |
| Testing   | Vitest + aws-sdk-client-mock   |

## 快速開始

```bash
# 安裝依賴
pnpm install

# 型別檢查
pnpm type:check

# 執行測試
pnpm test
```

## 日常操作

```bash
# Lambda 操作（start/stop/status/discover）
pnpm action

# 配置管理（upload/retrieve）
pnpm config

# 部署
pnpm deploy
```

## 資源標籤規範

```ini
lights-out:managed  = true              # 是否納管
lights-out:group    = airsync-dev       # 專案群組
lights-out:priority = 100               # 優先級（數字越小越先啟動）
```

## 專案結構

```
src/functions/handler/
├── index.ts              # Lambda handler
├── core/
│   ├── config.ts         # SSM 配置載入
│   ├── orchestrator.ts   # 資源操作協調
│   └── scheduler.ts      # 時區與假日邏輯
├── discovery/
│   └── tagDiscovery.ts   # Tag-based 資源發現
├── handlers/
│   ├── ecsService.ts     # ECS Service Handler
│   └── rdsInstance.ts    # RDS Instance Handler
└── notification/
    └── teamsNotifier.ts  # Teams 通知
```

## 文件

- **[CLAUDE.md](./CLAUDE.md)** - AI Agent 專案規範
- **[docs/deployment-guide.md](./docs/deployment-guide.md)** - 部署指南
- **[docs/roadmap.md](./docs/roadmap.md)** - 發展藍圖
- **[docs/teams-integration.md](./docs/teams-integration.md)** - Teams 整合
- **[config/sss-lab.yml](./config/sss-lab.yml)** - 配置範例

## 專案狀態

### 已完成

- [x] ECS Service + RDS Instance Handler
- [x] Tag-based 資源發現
- [x] Multi-region 部署
- [x] Regional scheduling
- [x] Teams 通知整合
- [x] 互動式 CLI 工具

### 進行中

- [ ] Pre-Landing: 集中式增強（onboarding script）
- [ ] Pre-Landing: npm package 提取

### 規劃中

- [ ] AI Integration: MCP Server + Skills
- [ ] Production: Scheduled Auto Scaling

## Commit 規範

```
<type>(<scope>): <description>

type: feat|fix|docs|refactor|test|chore
scope: core|discovery|handlers|config|infra|docs
```

## License

Internal project for ViewSonic development team.
