# AWS Lights Out Apply Tags

根據探索報告為 AWS 資源套用 Lights Out 標籤。

---

## 前置檢查

1. 確認當前目錄是 lights-out 專案目錄
   - 檢查是否存在 `serverless.yml` 或 `package.json` 含有 "lights-out"
   - 如果不是，顯示提醒並結束

---

## Step 1: 列出可用的探索報告

使用 `list_discovery_reports` 工具列出報告。

**顯示格式：**

```
找到以下探索報告：

| # | AWS 帳號       | 日期       | 檔案名稱                        |
|---|----------------|------------|--------------------------------|
| 1 | 677276105166   | 2026-01-26 | discovery-report-20260126.md   |
| 2 | 677276105166   | 2026-01-23 | discovery-report-20260123.md   |
```

如果沒有找到報告：

- 提示使用者先執行 `/lights-out-discover` 產生報告
- 結束流程

使用 AskUserQuestion 詢問：

```
question: "請選擇要使用的探索報告"
options:
  - label: "報告 1 (2026-01-26)"
    description: "最新的報告，帳號 677276105166"
  - label: "報告 2 (2026-01-23)"
    description: "帳號 677276105166"
  - label: "其他"
    description: "手動輸入報告路徑"
```

---

## Step 2: 解析報告並分類資源

使用 `parse_discovery_report` 工具解析選擇的報告。

**顯示解析結果摘要：**

```
報告解析完成！

AWS 帳號: {accountId}
探索區域: {regions}

資源統計：
- ECS Services: {totalEcs} 個
- RDS Instances: {totalRds} 個

資源分類：
- 可自動套用 (低風險): {autoApply} 個
- 需要確認 (高風險): {needConfirmation} 個
- 已排除 (不支援): {excluded} 個
```

---

## Step 3: 展示可自動套用的資源與預設標籤

### Step 3.1: 分析 Project 名稱

優先從 ECS cluster 名稱中提取 project 名稱：

**情況 A：成功從 cluster 名稱提取**

```
分析 ECS Cluster 名稱...

Cluster: vs-account-service-ecs-cluster-dev
偵測到 project: "vs-account"
```

**情況 B：無法從 cluster 名稱提取**

如果 `detectedProject` 為 `null`，直接詢問使用者：

```
question: "是否要使用 lights-out:project 標籤？"
options:
  - label: "是，手動輸入 project 名稱"
    description: "提供 project 標籤值以便分組管理資源"
  - label: "否，不使用 project 標籤"
    description: "只使用 managed 和 priority 標籤"
```

如果選擇手動輸入，使用 AskUserQuestion 讓使用者輸入 project 名稱。

### Step 3.2: 展示預設標籤配置

```
預設標籤配置：

| 標籤名稱              | 預設值         | 說明                                    |
|-----------------------|----------------|----------------------------------------|
| lights-out:managed    | true           | 標記為 Lights Out 管理的資源            |
| lights-out:project    | {project}      | 專案名稱（從 cluster 名稱提取或手動輸入）|
| lights-out:priority   | 10/50          | 啟停順序（RDS=10 先啟後關, ECS=50 後啟先關）|
```

### Step 3.3: 確認預設標籤

**只有當 detectedProject 不為 null 時**才詢問確認：

使用 AskUserQuestion 詢問使用者確認預設標籤：

```
question: "請確認預設標籤配置"
options:
  - label: "使用預設值"
    description: "project={project}, priority=10/50"
  - label: "修改標籤"
    description: "自訂 project 名稱或其他標籤值"
```

**如果選擇修改標籤：**

使用 AskUserQuestion 讓使用者輸入：

```
question: "請輸入 project 名稱"
options:
  - label: "{detected_project}"
    description: "使用偵測到的 project"
  - label: "其他"
    description: "手動輸入 project 名稱"
```

### Step 3.4: 展示資源清單

展示 `autoApply` 分類的資源清單：

```
以下資源為低風險，建議直接套用標籤：

### ECS Services ({count} 個)

| Service Name      | Region    | 風險等級 | 建議標籤                                      |
|-------------------|-----------|----------|-----------------------------------------------|
| vs-auth-dev       | us-east-1 | low      | managed=true, project=vs-account, priority=50 |
| vs-account-dev    | us-east-1 | low      | managed=true, project=vs-account, priority=50 |

### RDS Instances ({count} 個)

| Instance ID                              | Region    | 建議標籤                                       |
|------------------------------------------|-----------|------------------------------------------------|
| vs-account-service-postgres-dev          | us-east-1 | managed=true, project=vs-account, priority=10  |
```

> 💡 RDS priority=10（小數字）確保先啟動、後關閉，ECS priority=50 確保後啟動、先關閉。

---

## Step 4: 確認高風險資源

如果有 `needConfirmation` 分類的資源，逐一詢問：

```
以下資源需要您確認是否要納入 Lights Out 管理：

⚠️ vs-scheduler-dev (high risk)
- 包含 scheduler 容器，可能有長時間執行的排程任務
- 風險：停止時可能中斷正在執行的任務
```

使用 AskUserQuestion 詢問：

```
question: "是否要為 vs-scheduler-dev 套用 Lights Out 標籤？"
options:
  - label: "套用標籤"
    description: "使用較大 priority 數值 (100) 確保較早關閉、較晚啟動"
  - label: "跳過此資源"
    description: "不為此資源套用標籤"
```

對每個需要確認的資源重複此步驟。

---

## Step 5: 選擇實作方式

使用 AskUserQuestion 詢問：

```
question: "請選擇標籤套用方式"
options:
  - label: "透過 AWS API 直接套用 (Recommended)"
    description: "立即套用標籤，快速生效"
  - label: "產生 IaC 修改建議"
    description: "為 Terraform/CloudFormation/Serverless 產生修改建議"
  - label: "兩者都做"
    description: "先套用 API，同時產生 IaC 修改以保持同步"
```

---

## Step 6: 驗證 AWS Credentials

如果選擇透過 AWS API 套用，使用 `verify_credentials` 驗證憑證。

**成功時顯示格式：**

```
AWS 帳號資訊：
- Account ID: {account}
- User/Role: {arn}
```

**失敗時：**

- 顯示錯誤訊息
- 引導使用者執行 `aws sso login --profile <profile-name>`

---

## Step 7A: 透過 AWS API 套用標籤

### Step 7A.1: 預覽模式 (Dry Run)

先使用 `apply_tags_via_api` 的 `dryRun: true` 模式預覽：

```
標籤套用預覽 (Dry Run)：

將套用標籤到以下 {total} 個資源：

| 資源                               | 類型         | Tags                                          |
|------------------------------------|--------------|-----------------------------------------------|
| vs-auth-dev                        | ecs-service  | managed=true, project=vs-account, priority=50 |
| vs-account-dev                     | ecs-service  | managed=true, project=vs-account, priority=50 |
| vs-account-service-postgres-dev    | rds-db       | managed=true, project=vs-account, priority=10 |
```

使用 AskUserQuestion 確認：

```
question: "確認要套用以上標籤嗎？"
options:
  - label: "確認套用"
    description: "立即執行標籤套用"
  - label: "取消"
    description: "取消操作，不進行任何變更"
```

### Step 7A.2: 執行套用

使用 `apply_tags_via_api` 正式套用：

```
正在套用標籤...

進度: [████████████████████] 100%

套用結果：
- 成功: {succeeded} 個
- 失敗: {failed} 個
- 跳過: {skipped} 個
```

如果有失敗的資源，顯示詳細錯誤：

```
⚠️ 以下資源套用失敗：

| 資源            | 錯誤訊息                              |
|-----------------|---------------------------------------|
| vs-example-dev  | AccessDenied: User is not authorized  |
```

---

## Step 7B: 產生 IaC 修改建議

如果選擇產生 IaC 修改建議，詢問 IaC 目錄：

使用 AskUserQuestion 詢問：

```
question: "請提供 IaC 專案目錄路徑"
options:
  - label: "當前目錄"
    description: "使用當前工作目錄"
  - label: "其他目錄"
    description: "手動輸入路徑"
```

### AI 分析模式

使用 AI 能力直接分析 IaC 專案結構，產生標籤修改建議。

**處理步驟：**

1. 使用 Glob、Read 等工具探索 IaC 專案目錄結構：
   - 掃描目錄結構（`*.tf`, `*.hcl`, `*.yaml`, `*.yml`, `serverless.yml` 等）
   - 讀取關鍵檔案內容

2. 根據檔案內容進行 AI 分析：
   - 判斷 IaC 類型（Terraform, Terragrunt, CloudFormation, CDK, Serverless 等）
   - 理解專案結構（module/unit/stack 階層）
   - 找出 tags 應該加在哪些檔案、哪些位置
   - 考慮是否需要在多個層級修改（如 Terragrunt 的 module → unit → stack）

3. 產生修改建議，格式如下：

````
IaC 分析結果：

偵測到專案類型: {detected_type}
結構分析: {structure_analysis}

---

### 建議的修改

**層級 1: {layer_name}**
檔案: {file_path}
說明: {description}

```{language}
{code_snippet}
````

**層級 2: {layer_name}** (如適用)
...

```

4. 如果 AI 無法確定最佳修改方式：

```

⚠️ 此 IaC 結構較為特殊，以下是分析結果供參考：

{analysis_summary}

建議：

1. 請確認 tags 變數在 module 層級是否已定義
2. 查看 {suggested_files} 確認 tags 傳遞路徑
3. 如有疑問，可手動檢查這些檔案並新增 tags

需要我協助分析特定檔案嗎？

```

**支援的 IaC 類型：**

| 類型           | 檔案類型                                   |
|----------------|-------------------------------------------|
| Terraform      | `*.tf`                                    |
| Terragrunt     | `terragrunt.hcl`, `terragrunt.stack.hcl`  |
| CloudFormation | `*.yaml`, `*.yml` (含 AWS::)              |
| Serverless     | `serverless.yml`                          |
| CDK            | `*.ts`, `*.py` (含 CDK constructs)        |
| 其他           | 視專案結構分析                             |

---

## Step 8: 驗證標籤

使用 `verify_tags` 驗證標籤是否正確套用：

```

正在驗證標籤...

驗證結果：

- 已驗證: {verified} 個
- 不符合: {mismatch} 個
- 未找到: {notFound} 個
- 錯誤: {error} 個

```

如果全部成功：

```

✅ 所有標籤已成功套用！

已標記的資源可透過 Lights Out Lambda 的 discover action 發現：

aws lambda invoke \
 --function-name lights-out-{stage} \
 --payload '{"action":"discover"}' \
 --region {region} \
 output.json

```

如果有不符合的資源：

```

⚠️ 以下資源的標籤與預期不符：

| 資源        | 問題                             |
| ----------- | -------------------------------- |
| vs-auth-dev | Missing tag: lights-out:priority |

```

---

## Step 9: 總結

```

標籤套用完成！

摘要：

- 成功套用標籤: {count} 個資源
- API 套用: {api_count} 個
- IaC 修改建議: {iac_count} 個

```

### Step 9.1: 儲存 IaC 修改建議

**僅在 Step 7B 有產生 IaC 修改建議時才執行此步驟。**

使用 AskUserQuestion 詢問：

```

question: "是否要將 IaC 修改建議另存為 Markdown 文件？"
options:

- label: "儲存到 IaC 專案目錄 (Recommended)"
  description: "將修改建議儲存至 {iacDirectory}/lights-out-iac-suggestions.md"
- label: "儲存到自訂路徑"
  description: "手動指定檔案路徑"
- label: "不儲存"
  description: "跳過，僅在對話中保留建議"

`````

**如果選擇儲存：**

使用 Write 工具將 IaC 修改建議寫入 markdown 文件。

**預設檔案路徑：** `{iacDirectory}/lights-out-iac-suggestions.md`

如果選擇自訂路徑，使用 AskUserQuestion 讓使用者輸入路徑。

**文件內容格式：**

````markdown
# Lights Out IaC Tag Suggestions

> Generated: {date}
> AWS Account: {accountId}
> Region: {regions}
> Project: {project}

## Overview

This document contains IaC modification suggestions for adding Lights Out tags to AWS resources.

- Total resources: {total}
- ECS Services: {ecsCount}
- RDS Instances: {rdsCount}

## Tags to Apply

| Tag | Value | Description |
|-----|-------|-------------|
| `lights-out:managed` | `true` | Mark as Lights Out managed resource |
| `lights-out:project` | `{project}` | Project name |
| `lights-out:priority` | `50` (ECS) / `100` (RDS) | Startup/shutdown order |

## Modification Suggestions

{iac_suggestions_content}

<!-- 此處包含 Step 7B 中 AI 分析產生的所有 IaC 修改建議內容 -->

## Resources

### Applied (via API)

| Resource | Type | Tags |
|----------|------|------|
| {resource_name} | {type} | managed=true, project={project}, priority={priority} |
| ... | ... | ... |

### Excluded

| Resource | Reason |
|----------|--------|
| {resource_name} | {reason} |
| ... | ... |

### Skipped (High Risk / Stopped)

| Resource | Reason |
|----------|--------|
| {resource_name} | {reason} |
| ... | ... |
`````

**儲存成功後顯示：**

```
IaC 修改建議已儲存至：
{file_path}
```

**注意事項：**

- 文件內容應包含 Step 7B 中 AI 分析產生的**完整** IaC 修改建議（含程式碼片段）
- 同時列出 API 已套用的資源、已排除的資源、被跳過的資源，方便日後追蹤

---

### Step 9.2: 下一步

```

下一步：

1. 如果使用 API 套用，標籤已立即生效
2. 如果產生 IaC 修改，請手動應用變更並部署
3. 執行 `/lights-out-discover` 確認資源已被正確標記
4. 部署 Lights Out Lambda 開始自動化啟停

相關文件：

- docs/deployment-guide.md - 完整部署指南
- config/sss-lab.yml - 配置範例

```

---

## MCP Tools 使用

此命令使用 `lights-out-discovery` MCP Server 提供的以下 tools：

| Tool                     | 用途                  |
| ------------------------ | --------------------- |
| `list_discovery_reports` | 列出可用的探索報告    |
| `parse_discovery_report` | 解析報告並分類資源    |
| `verify_credentials`     | 驗證 AWS 認證         |
| `apply_tags_via_api`     | 透過 AWS API 套用標籤 |
| `verify_tags`            | 驗證標籤是否成功套用  |

> IaC 修改建議由 AI 直接分析專案結構產生，不依賴 MCP 工具。

---

## 必要的 IAM 權限

要執行標籤套用，AWS 憑證需要以下權限：

```json
{
  "Effect": "Allow",
  "Action": [
    "ecs:TagResource",
    "ecs:ListTagsForResource",
    "rds:AddTagsToResource",
    "rds:ListTagsForResource"
  ],
  "Resource": "*"
}
```

---

## 注意事項

- 此命令會修改 AWS 資源的標籤
- 建議先使用 Dry Run 模式預覽變更
- 標籤套用後可透過 `verify_tags` 驗證
- 如果同時使用 API 和 IaC，請確保兩者同步以避免 drift
- Production 環境建議優先使用 IaC 方式以保持版本控制
