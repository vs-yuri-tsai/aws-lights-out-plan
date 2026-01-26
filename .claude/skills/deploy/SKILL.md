---
name: deploy
description: 引導 AWS Lambda 部署流程（不自動執行部署）
disable-model-invocation: true
---

# Deploy Skill

協助使用者完成安全的部署流程。

## 重要提醒

根據專案規範，**絕對不自動執行部署指令**。此 skill 僅提供指引和指令，由使用者手動執行。

## 部署前檢查

執行以下檢查（可自動執行）：

1. **型別檢查**

   ```bash
   pnpm type:check
   ```

2. **執行測試**

   ```bash
   pnpm test
   ```

3. **Lint 檢查**
   ```bash
   pnpm lint
   ```

## 部署指令

檢查通過後，**提供以下指令供使用者手動執行**：

### 互動式部署（推薦）

```bash
pnpm deploy
```

- 會引導選擇環境（sss-lab、pg-development、pg-stage）
- 自動處理 AWS SSO credentials

### 直接部署

```bash
# 部署到特定環境
pnpm deploy -- --stage <stage-name> --region <region>
```

## 驗證部署

部署完成後，提供驗證指令：

```bash
# 檢查 Lambda 狀態
aws lambda get-function --function-name lights-out-<stage>

# 手動觸發測試
aws lambda invoke \
  --function-name lights-out-<stage> \
  --payload '{"action":"status"}' \
  out.json && cat out.json
```

## 注意事項

- 確認 AWS SSO session 有效：`aws sso login --profile <profile>`
- 部署前確認目標環境正確
- 生產環境部署需額外確認
