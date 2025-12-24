# Agent Collaboration Guide

> 此文件供多 Agent（Claude Code、Gemini CLI 等）協作使用。包含共享狀態、技術規格、任務追蹤。

---

## 📍 Shared State

### Current Phase
- [x] Phase 0: 專案初始化（文件規劃）
- [x] Phase 1.1: Python 原型實作（完成）
- [x] Phase 1.2: TypeScript 完整實作（完成）
- [ ] Phase 1.3: AWS 環境設定與部署
- [ ] Phase 2: 更多資源類型支援
- [ ] Phase 3: MCP 整合

### Active Decisions
| 決策 | 選擇 | 理由 | 日期 |
|------|------|------|------|
| 主要語言 | TypeScript | 現代化、型別安全、AWS SDK v3 | 2025-12-23 |
| Runtime | Node.js 20 | Lambda 最新穩定版本 | 2025-12-23 |
| 部署方式 | Serverless Framework | 自動化部署、簡化配置 | 2025-12-23 |
| 打包工具 | esbuild | 快速、輕量級打包 | 2025-12-23 |
| Phase 1 範圍 | ECS + RDS | 涵蓋常用資源類型 | 2025-12-23 |
| Python 版本 | 3.11 (原型) | 完整的參考實作 | 2025-12-17 |
| 實作方式 | TDD + TypeScript Strict | 確保程式碼品質與型別安全 | 2025-12-23 |

### Blockers
<!-- Agent 遇到阻礙時在此記錄 -->
- None

### File Locks
<!-- 避免同時編輯，開始前登記 -->
| File | Agent | Since |
|------|-------|-------|
| - | - | - |

---

## 📋 Task Registry

### Phase 1: Lambda 函數實作

#### Python 原型 (已完成)
| ID | Task | Status | Agent | Notes |
|----|------|--------|-------|-------|
| P1-01 | 專案結構設計 | ✅ | Gemini CLI | 建立 src/lambda_function/ 目錄結構 |
| P1-02 | utils/logger.py | ✅ | Gemini CLI | 結構化 JSON logging |
| P1-03 | core/config.py | ✅ | Gemini CLI | SSM Parameter Store 載入 |
| P1-04 | discovery/base.py | ✅ | Gemini CLI | 資源發現介面定義 |
| P1-05 | discovery/tag_discovery.py | ✅ | Gemini CLI | Tag-based 資源發現實作 |
| P1-06 | handlers/base.py | ✅ | Gemini CLI | 資源 Handler 抽象類別 |
| P1-07 | handlers/ecs_service.py | ✅ | Gemini CLI | ECS Service 啟停邏輯 |
| P1-08 | core/scheduler.py | ✅ | Gemini CLI | 時區/工作日判斷 |
| P1-09 | core/orchestrator.py | ✅ | Claude | 執行協調與錯誤處理 |
| P1-10 | app.py | ✅ | Claude | Lambda 進入點 |
| P1-11 | 單元測試 | ✅ | Gemini CLI + Claude | tests/ 目錄，使用 moto |
| P1-12 | 整合測試 | ✅ | Claude | 本地測試 |

#### TypeScript 實作 (已完成)
| ID | Task | Status | Agent | Notes |
|----|------|--------|-------|-------|
| TS-01 | TypeScript 專案初始化 | ✅ | Claude | package.json, tsconfig.json |
| TS-02 | types.ts | ✅ | Claude | 共用型別定義 |
| TS-03 | utils/logger.ts | ✅ | Claude | 結構化 JSON logging |
| TS-04 | core/config.ts | ✅ | Claude | SSM 配置載入（AWS SDK v3） |
| TS-05 | discovery/tagDiscovery.ts | ✅ | Claude | Tag-based 資源發現 |
| TS-06 | handlers/base.ts | ✅ | Claude | ResourceHandler 介面 |
| TS-07 | handlers/factory.ts | ✅ | Claude | Handler Factory Pattern |
| TS-08 | handlers/ecsService.ts | ✅ | Claude | ECS Service Handler |
| TS-09 | handlers/rdsInstance.ts | ✅ | Claude | RDS Instance Handler |
| TS-10 | core/orchestrator.ts | ✅ | Claude | 執行協調器 |
| TS-11 | index.ts | ✅ | Claude | Lambda handler 入口 |
| TS-12 | Serverless Framework | ✅ | Claude | serverless.yml + esbuild |
| TS-13 | 測試 | ✅ | Claude | 307 個測試檔案 |

#### 部署與驗證 (待開始)
| ID | Task | Status | Agent | Notes |
|----|------|--------|-------|-------|
| D-01 | 建立 IAM Role | 🔲 | - | 支援 ECS + RDS 權限 |
| D-02 | 建立 SSM Parameter | 🔲 | - | YAML 格式配置 |
| D-03 | 為資源加標籤 | 🔲 | - | lights-out:* tags |
| D-04 | 部署 Lambda | 🔲 | - | 使用 Serverless Framework |
| D-05 | 建立 EventBridge | 🔲 | - | start/stop cron rules |
| D-06 | Workshop 驗證 | 🔲 | - | 端對端測試 |

**Status:** 🔲 Todo | 🔄 In Progress | ✅ Done | ⏸️ Blocked

---

## 🔧 Technical Specifications

### SSM Configuration Schema

**Path:** `/lights-out/config` (統一路徑，由 AWS Account 隔離)

**格式:** YAML（TypeScript 實作）或 JSON（Python 原型）

**YAML 範例:**
```yaml
version: "1.0"
environment: sss-lab

# Optional: List of AWS regions to scan for resources
# If omitted, defaults to Lambda's deployment region
regions:
  - ap-southeast-1  # Singapore
  - ap-northeast-1  # Tokyo

discovery:
  method: tags
  tagFilters:
    lights-out:managed: "true"
    lights-out:env: sss-lab
  resourceTypes:
    - ecs-service
    - rds-instance

resourceDefaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    defaultDesiredCount: 1
  rds-instance:
    skipFinalSnapshot: true
    waitTimeout: 600

overrides: {}

schedules:
  default:
    timezone: Asia/Taipei
    startTime: "09:00"
    stopTime: "19:00"
    activeDays:
      - MON
      - TUE
      - WED
      - THU
      - FRI
    holidays: []
```

**JSON 範例（Python 原型）:**
```json
{
  "version": "1.0",
  "environment": "workshop",
  "region": "ap-southeast-1",
  "discovery": {
    "method": "tags",
    "tag_filters": {
      "lights-out:managed": "true",
      "lights-out:env": "workshop"
    },
    "resource_types": ["ecs-service", "rds-instance"]
  }
}
```

### Interface Definitions

```python
# discovery/base.py
@dataclass
class DiscoveredResource:
    resource_type: str      # "ecs-service"
    arn: str                # Full AWS ARN
    resource_id: str        # Human-readable ID
    priority: int           # From tag, default 50
    group: str              # Schedule group
    tags: dict[str, str]
    metadata: dict

# handlers/base.py
class ResourceHandler(ABC):
    def get_status(self) -> dict: ...
    def start(self) -> HandlerResult: ...
    def stop(self) -> HandlerResult: ...
    def is_ready(self) -> bool: ...
```

### Lambda Response Format

```json
{
  "success": true,
  "action": "stop",
  "dry_run": false,
  "timestamp": "2025-12-09T19:00:00+08:00",
  "environment": "workshop",
  "summary": {
    "total": 1,
    "succeeded": 1,
    "failed": 0,
    "skipped": 0
  },
  "resources": [
    {
      "resource_type": "ecs-service",
      "resource_id": "my-cluster/my-service",
      "status": "success",
      "message": "Service scaled to 0"
    }
  ]
}
```

### IAM Permissions Required

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECS",
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:UpdateService",
        "ecs:ListServices",
        "ecs:DescribeClusters"
      ],
      "Resource": "*"
    },
    {
      "Sid": "RDS",
      "Effect": "Allow",
      "Action": [
        "rds:DescribeDBInstances",
        "rds:StartDBInstance",
        "rds:StopDBInstance"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Tagging",
      "Effect": "Allow",
      "Action": ["tag:GetResources"],
      "Resource": "*"
    },
    {
      "Sid": "SSM",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:*:*:parameter/lights-out/*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONFIG_PARAMETER_NAME` | Yes | - | SSM parameter name (e.g., `/lights-out/workshop/config`) |
| `DRY_RUN` | No | `false` | Skip actual operations |
| `LOG_LEVEL` | No | `INFO` | Logging level |
| `AWS_REGION` | No | `ap-southeast-1` | AWS Region (由 Lambda 自動設定) |

---

## 📚 AWS API Quick Reference

### ECS Service
```python
ecs = boto3.client('ecs')

# Status
ecs.describe_services(cluster='name', services=['svc'])

# Stop
ecs.update_service(cluster='name', service='svc', desiredCount=0)

# Start
ecs.update_service(cluster='name', service='svc', desiredCount=1)
```

### Resource Groups Tagging API
```python
tagging = boto3.client('resourcegroupstaggingapi')

tagging.get_resources(
    TagFilters=[
        {'Key': 'lights-out:managed', 'Values': ['true']},
        {'Key': 'lights-out:env', 'Values': ['workshop']}
    ],
    ResourceTypeFilters=['ecs:service']
)
```

### SSM Parameter Store
```python
ssm = boto3.client('ssm')

response = ssm.get_parameter(
    Name='/lights-out/workshop/config',
    WithDecryption=True
)
config = json.loads(response['Parameter']['Value'])
```

---

## 🤝 Working Agreements

### Agent 分工建議
| Agent | 擅長 | 建議任務 |
|-------|------|----------|
| Claude Code | 架構、複雜邏輯 | handlers、orchestrator |
| Gemini CLI | 文件、測試 | tests、docs、review |

### TDD 開發流程 (TDD Development Workflow)

為了確保程式碼品質與開發者對需求的理解，Milestone 1.1 的所有核心程式碼開發任務都應遵循 TDD 流程。

1.  **Red (寫一個失敗的測試):**
    -   針對一個具體的功能需求，先在 `tests/` 目錄下撰寫一個對應的單元測試。
    -   這個測試應該會因為功能尚未實作而失敗。
    -   **指令範例:** `pytest tests/test_core_config.py::test_load_config_from_ssm`

2.  **Green (寫最少的程式碼讓測試通過):**
    -   在 `src/` 目錄下撰寫最精簡的程式碼，剛好能讓前一步的測試通過即可。
    -   此階段不追求完美的程式碼結構或效能。

3.  **Refactor (重構程式碼):**
    -   在測試持續通過的前提下，重構 `src/` 中的程式碼，改善可讀性、結構和效率。
    -   確保程式碼符合 `Code Review Checklist` 的所有要求（如 Type hints、Docstring 等）。

所有 Agent 在執行 P1-02 到 P1-11 的任務時，都必須遵循此流程。

### 執行策略 (Execution Policy)

**⚠️ CRITICAL: 測試與程式執行規則**

AI Agents **必須遵守** 以下執行限制：

1. **禁止自動執行測試:**
   - ❌ 不可自動執行 `pytest`、`python -m pytest` 等測試指令
   - ✅ 應提供測試指令，讓開發者在虛擬環境中執行

2. **禁止自動執行主程式:**
   - ❌ 不可自動執行 `python app.py`、`aws lambda invoke` 等主程式
   - ✅ 應提供執行指令，說明參數與預期結果

3. **環境說明:**
   - 開發者使用獨立虛擬環境（venv）管理 Python 依賴
   - AI Agent 在不同 shell context 執行會導致 `ModuleNotFoundError`
   - 測試與執行需由開發者在已啟動虛擬環境的終端中進行

**允許的操作:**
- ✅ 檔案讀寫、搜尋、編輯
- ✅ 靜態程式碼分析（Grep、Glob）
- ✅ Git 操作（status、diff、commit）
- ✅ 文件生成與更新

### 溝通協定

1. **開始任務前：** 更新 Task Registry 為 🔄，登記 File Locks
2. **完成任務後：** 更新為 ✅，清除 File Locks，記錄 Notes
3. **遇到阻礙時：** 記錄到 Blockers，狀態改為 ⏸️
4. **重要決策時：** 記錄到 Active Decisions
5. **需要測試時：** 提供完整測試指令，等待開發者回報結果

### Code Review Checklist
- [ ] Type hints 完整
- [ ] Docstring 有寫
- [ ] Error handling 正確（不中斷整體流程）
- [ ] Dry-run 模式有支援
- [ ] Logging 有結構化輸出

---

## 🗂️ File Dependencies

```
app.py
└── core/orchestrator.py
    ├── core/config.py
    │   └── utils/logger.py
    ├── core/scheduler.py
    ├── discovery/tag_discovery.py
    │   └── discovery/base.py
    └── handlers/ecs_service.py
        └── handlers/base.py
```

**建議實作/修改順序：** 由下往上（先改依賴少的）
