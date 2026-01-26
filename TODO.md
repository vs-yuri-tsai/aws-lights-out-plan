# AWS Lights-Out Plan - TODO

**Last Updated**: 2026-01-19

---

## Phase 1: AI Integration（優先）

### Node.js 24.x Migration

已升級至 Node.js 24.x（AWS Lambda 最新 LTS 版本，於 2025 年 11 月發布）。

**Checklist:**

- [ ] 本地安裝 Node.js 24.x
- [x] 更新 `package.json` engines 欄位
- [x] 更新 `serverless.yml` runtime 設定
- [ ] 執行測試驗證相容性
- [ ] 部署到測試環境驗證

---

## Phase 2: 集中式增強

**目標：** 基於 AI 分析結果，快速讓多個專案導入

| Task | Description                                            | Status |
| ---- | ------------------------------------------------------ | ------ |
| 2.1  | 建立 onboarding script (`/scripts/onboard-project.js`) | 待開始 |
| 2.2  | 建立配置範本 (`/config/templates/project.yml`)         | 待開始 |
| 2.3  | 撰寫 onboarding 文件                                   | 待開始 |

---

## Phase 3: Package 提取

**目標：** 建立可發布的 npm package (`@vs-infra/lights-out`)

| Task | Description           | Status |
| ---- | --------------------- | ------ |
| 3.1  | 設定 pnpm workspace   | 待開始 |
| 3.2  | 建立 package 結構     | 待開始 |
| 3.3  | Export handler module | 待開始 |
| 3.4  | 建立 Serverless 範本  | 待開始 |

---

## Phase 4: CLI 開發

**目標：** 一鍵部署體驗

| Task | Description                  | Status |
| ---- | ---------------------------- | ------ |
| 4.1  | CLI framework (Commander.js) | 待開始 |
| 4.2  | init command                 | 待開始 |
| 4.3  | discover command             | 待開始 |
| 4.4  | deploy command               | 待開始 |
| 4.5  | invoke command               | 待開始 |

---

## Phase 5: Production Enhancement

**目標：** 生產環境功能

| Task | Description                 | Status |
| ---- | --------------------------- | ------ |
| 5.1  | Scheduled Auto Scaling 整合 | 評估中 |
| 5.2  | EventBridge in IaC          | 評估中 |

---

## Medium Priority

### Teams Integration Phase 2: 雙向指令

**Blocked by:** Phase 1 (單向通知) 部署成功

| Task                     | Description                     | Status |
| ------------------------ | ------------------------------- | ------ |
| Azure Bot 註冊           | 申請 Azure AD tenant admin 權限 | 待開始 |
| teams-bot-handler Lambda | 實作指令解析邏輯                | 待開始 |
| API Gateway 設定         | 建立 `/webhook/teams` endpoint  | 待開始 |

### 測試覆蓋率提升

**Target:** 80% coverage

- [ ] Teams 模組單元測試
- [ ] 整合測試

---

## Low Priority

### 支援更多 AWS 資源類型

| Resource             | Status |
| -------------------- | ------ |
| EC2 Instances        | 待需求 |
| Aurora Clusters      | 待需求 |
| ElastiCache Clusters | 待需求 |

---

## Related Documents

- [docs/roadmap.md](./docs/roadmap.md) - 完整發展藍圖
- [docs/deployment-guide.md](./docs/deployment-guide.md) - 部署指南
- [docs/teams-integration.md](./docs/teams-integration.md) - Teams 整合
- [CLAUDE.md](./CLAUDE.md) - AI Agent 規則
