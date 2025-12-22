# Lights-Out 架構流程圖

## 完整資料流向

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AWS Cloud Environment                                │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ SSM Parameter Store (配置中心)                                       │   │
│  │                                                                       │   │
│  │  /lights-out/dev/airsync          /lights-out/stage/vs-account      │   │
│  │  ┌──────────────────────┐         ┌──────────────────────┐          │   │
│  │  │ version: "1.0"       │         │ version: "1.0"       │          │   │
│  │  │ environment: dev     │         │ environment: stage   │          │   │
│  │  │ discovery:           │         │ discovery:           │          │   │
│  │  │   tags:              │         │   tags:              │          │   │
│  │  │     managed: "true"  │         │     managed: "true"  │          │   │
│  │  │ schedule:            │         │ schedule:            │          │   │
│  │  │   work_hours:        │         │   work_hours:        │          │   │
│  │  │     start: "08:00"   │         │     start: "08:00"   │          │   │
│  │  │     end: "20:00"     │         │     end: "20:00"     │          │   │
│  │  └──────────────────────┘         └──────────────────────┘          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    │ ① Lambda 讀取配置                      │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ EventBridge (定時觸發器)                                             │   │
│  │                                                                       │   │
│  │  Rule: lights-out-start-airsync-dev                                 │   │
│  │  ├─ Schedule: cron(0 0 * * ? *)  ← TPE 08:00 (UTC 00:00)           │   │
│  │  └─ Target: Lambda                                                   │   │
│  │      Payload: {                                                      │   │
│  │        "action": "start",                                            │   │
│  │        "parameter_name": "/lights-out/dev/airsync"                  │   │
│  │      }                                                                │   │
│  │                                                                       │   │
│  │  Rule: lights-out-stop-airsync-dev                                  │   │
│  │  ├─ Schedule: cron(0 12 * * ? *) ← TPE 20:00 (UTC 12:00)           │   │
│  │  └─ Target: Lambda                                                   │   │
│  │      Payload: {                                                      │   │
│  │        "action": "stop",                                             │   │
│  │        "parameter_name": "/lights-out/dev/airsync"                  │   │
│  │      }                                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    │ ② 觸發 Lambda                          │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Lambda Function: lights-out                                          │   │
│  │                                                                       │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │ core/config  │→ │ discovery/   │→ │ orchestrator │              │   │
│  │  │ .loadConfig  │  │ .discover()  │  │ .execute()   │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  │         │                  │                  │                      │   │
│  │         │ ③ 從 SSM 取配置  │ ④ 發現資源      │ ⑤ 執行操作         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Resource Groups Tagging API (資源發現)                               │   │
│  │                                                                       │   │
│  │  Query: GetResources                                                 │   │
│  │  ├─ TagFilters:                                                      │   │
│  │  │   - Key: lights-out:managed   Value: true                        │   │
│  │  │   - Key: lights-out:env       Value: dev                         │   │
│  │  │   - Key: lights-out:project   Value: airsync                     │   │
│  │  ├─ ResourceTypes: [ecs:service, rds:db]                            │   │
│  │  │                                                                    │   │
│  │  └─ Response: [                                                      │   │
│  │      {                                                                │   │
│  │        arn: "arn:aws:ecs:...:service/api-service",                  │   │
│  │        tags: { priority: "50", ... }                                 │   │
│  │      },                                                               │   │
│  │      {                                                                │   │
│  │        arn: "arn:aws:rds:...:db:postgres-db",                       │   │
│  │        tags: { priority: "100", ... }                                │   │
│  │      }                                                                │   │
│  │    ]                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 實際資源 (按 priority 排序執行)                                      │   │
│  │                                                                       │   │
│  │  ┌──────────────────────────────────────────────────────────┐       │   │
│  │  │ ECS Service: airsync-api-service                          │       │   │
│  │  │ ├─ Priority: 50 (先啟動/先關閉)                           │       │   │
│  │  │ ├─ Action: start → UpdateService(desiredCount=1)         │       │   │
│  │  │ └─ Action: stop  → UpdateService(desiredCount=0)         │       │   │
│  │  └──────────────────────────────────────────────────────────┘       │   │
│  │         ⑥ 執行 AWS API                                               │   │
│  │  ┌──────────────────────────────────────────────────────────┐       │   │
│  │  │ RDS Instance: airsync-postgres-db                         │       │   │
│  │  │ ├─ Priority: 100 (後啟動/後關閉)                          │       │   │
│  │  │ ├─ Action: start → StartDBInstance()                     │       │   │
│  │  │ └─ Action: stop  → StopDBInstance()                      │       │   │
│  │  └──────────────────────────────────────────────────────────┘       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ CloudWatch Logs (執行記錄)                                            │   │
│  │                                                                       │   │
│  │  {                                                                    │   │
│  │    "level": "INFO",                                                  │   │
│  │    "message": "Resource stopped",                                    │   │
│  │    "resource_arn": "arn:aws:ecs:...:service/api-service",           │   │
│  │    "action": "stop",                                                 │   │
│  │    "timestamp": "2025-12-22T12:00:00Z"                               │   │
│  │  }                                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 時間線範例：AirSync Dev 環境的一天

```
時間軸 (Asia/Taipei)
│
│  00:00 ────────────────────────────────────────────
│    │     資源處於 STOPPED 狀態
│    │     (節省成本中...)
│  07:00 ────────────────────────────────────────────
│    │
│  08:00 ─────────────────────────────────────────── ★ EventBridge 觸發
│    │                                                   "lights-out-start"
│    │
│    ├─► ① Lambda 啟動
│    │     Payload: {
│    │       "action": "start",
│    │       "parameter_name": "/lights-out/dev/airsync"
│    │     }
│    │
│    ├─► ② loadConfigFromSsm("/lights-out/dev/airsync")
│    │     └─ 讀取配置：work_hours.start = "08:00"
│    │
│    ├─► ③ TagDiscovery.discover()
│    │     └─ 發現 2 個資源（ECS Service + RDS DB）
│    │
│    ├─► ④ 按 priority 排序
│    │     └─ [ECS(50), RDS(100)]  ← 小數字先執行
│    │
│    ├─► ⑤ 執行 start 操作
│    │     ├─ ECS.UpdateService(desiredCount=1) ✓
│    │     └─ RDS.StartDBInstance() ✓
│    │
│  08:05 ─────────────────────────────────────────── ✓ 資源啟動完成
│    │     應用開始接受流量
│    │
│  09:00 ────────────────────────────────────────────
│    │     開發團隊開始工作
│  12:00 ────────────────────────────────────────────
│  18:00 ────────────────────────────────────────────
│  19:00 ────────────────────────────────────────────
│    │     開發團隊下班
│  20:00 ─────────────────────────────────────────── ★ EventBridge 觸發
│    │                                                   "lights-out-stop"
│    │
│    ├─► ① Lambda 啟動
│    │     Payload: {
│    │       "action": "stop",
│    │       "parameter_name": "/lights-out/dev/airsync"
│    │     }
│    │
│    ├─► ② loadConfigFromSsm (使用 cached config)
│    │     └─ 配置已在 cache 中，無需重新讀取 SSM
│    │
│    ├─► ③ TagDiscovery.discover()
│    │     └─ 發現相同 2 個資源
│    │
│    ├─► ④ 按 priority 排序 (stop 時反向)
│    │     └─ [ECS(50), RDS(100)]  ← stop 時小數字先執行 = 先斷連
│    │
│    ├─► ⑤ 執行 stop 操作
│    │     ├─ ECS.UpdateService(desiredCount=0) ✓
│    │     └─ RDS.StopDBInstance() ✓
│    │
│  20:05 ─────────────────────────────────────────── ✓ 資源關閉完成
│    │     開始節省成本
│    │
│  24:00 ────────────────────────────────────────────
│    │     持續 STOPPED 狀態
│    └──► 循環至明天 08:00
```

---

## SSM 的關鍵優勢（實務場景）

### 場景 1：緊急需求變更

**問題：** 老闆要求 AirSync Dev 環境週五晚上保持運行（通宵測試）

**傳統方式（硬編碼）：**
```
1. 修改 Lambda 程式碼
2. 執行單元測試
3. 建立 Pull Request
4. Code Review
5. Merge & Deploy
6. 等待 CI/CD Pipeline
⏱️ 需時：30-60 分鐘
```

**使用 SSM：**
```bash
# 1. 取得配置
aws ssm get-parameter --name "/lights-out/dev/airsync" \
  --query 'Parameter.Value' --output text > config.yaml

# 2. 加入例外日期
echo "  exceptions:" >> config.yaml
echo "    - date: '2025-12-27'" >> config.yaml
echo "      keep_running: true" >> config.yaml

# 3. 上傳
aws ssm put-parameter --name "/lights-out/dev/airsync" \
  --value file://config.yaml --overwrite

⏱️ 需時：2 分鐘
```

**Why SSM 更好：**
- 無需重新部署 Lambda
- 無需 Code Review
- 配置變更立即生效（最多等 cache TTL 5 分鐘）

---

### 場景 2：多團隊協作

**問題：** AirSync 團隊和 VS Account 團隊有不同的工作時間

| 團隊 | 工作時段 | 假日處理 |
|------|----------|----------|
| AirSync | 09:00-18:00 | 假日關閉 |
| VS Account | 08:00-20:00 | 假日運行（客服需求） |

**使用 SSM：**
- 每個團隊擁有獨立的參數路徑
- 團隊自主管理自己的排程規則
- Lambda 程式碼通用，靠 SSM 參數區分行為

```
/lights-out/dev/airsync      ← AirSync 團隊管理
/lights-out/dev/vs-account   ← VS Account 團隊管理
```

**IAM 權限隔離：**
```json
{
  "Effect": "Allow",
  "Action": "ssm:PutParameter",
  "Resource": "arn:aws:ssm:*:*:parameter/lights-out/dev/airsync",
  "Principal": {
    "AWS": "arn:aws:iam::123456789012:role/AirSync-DevOps"
  }
}
```

**Why SSM 更好：**
- 配置分離：各團隊互不影響
- 權限控制：IAM 原生支援路徑級別權限
- 審計追蹤：CloudTrail 記錄誰改了什麼

---

### 場景 3：災難復原

**問題：** 配置被誤改，導致資源沒有正常關閉

**SSM 自動版本控制：**
```bash
# 1. 查看誰改了配置
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=/lights-out/dev/airsync \
  | jq '.Events[] | {time: .EventTime, user: .Username}'

# 輸出：
# {
#   "time": "2025-12-22T14:30:00Z",
#   "user": "john.doe@example.com"
# }

# 2. 查看歷史版本
aws ssm get-parameter-history \
  --name "/lights-out/dev/airsync" \
  --query 'Parameters[*].[Version,LastModifiedDate,Value]' \
  --output table

# 3. 一鍵回滾到前一個版本
aws ssm get-parameter --name "/lights-out/dev/airsync:2" \
  --query 'Parameter.Value' --output text | \
aws ssm put-parameter --name "/lights-out/dev/airsync" \
  --value file:///dev/stdin --overwrite
```

**Why SSM 更好：**
- 自動版本控制（無需手動備份）
- CloudTrail 審計日誌
- 一鍵回滾

---

## 成本分析：實際案例

**假設：**
- **AirSync Dev**: 1 個 ECS Service (Fargate) + 1 個 RDS db.t3.medium
- **VS Account Stage**: 2 個 ECS Services + 1 個 RDS db.t3.medium
- **工作時段**: 每天 08:00-20:00 (12 小時)
- **關閉時段**: 每天 20:00-08:00 (12 小時)

### 月度成本比較

#### AirSync Dev (ECS Fargate 0.25 vCPU, 0.5GB 記憶體)

| 資源 | 24/7 運行 | Lights-Out (12hr/day) | 節省 |
|------|-----------|------------------------|------|
| ECS Fargate | $14.60/月 | **$7.30/月** | **$7.30** (50%) |
| RDS db.t3.medium | $61.32/月 | **$30.66/月** | **$30.66** (50%) |
| **小計** | $75.92/月 | **$37.96/月** | **$37.96** (50%) |

#### VS Account Stage (2 個 ECS + 1 個 RDS)

| 資源 | 24/7 運行 | Lights-Out | 節省 |
|------|-----------|------------|------|
| ECS Fargate × 2 | $29.20/月 | **$14.60/月** | **$14.60** (50%) |
| RDS db.t3.medium | $61.32/月 | **$30.66/月** | **$30.66** (50%) |
| **小計** | $90.52/月 | **$45.26/月** | **$45.26** (50%) |

#### Lights-Out 基礎設施成本

| 項目 | 成本/月 |
|------|---------|
| SSM Parameters (4 個標準參數) | **$0** |
| EventBridge Rules (8 個規則) | **$0** |
| Lambda 執行 (120 次/月) | **$0** (免費配額內) |
| CloudWatch Logs (5GB/月) | **$2.51** |
| **總計** | **$2.51/月** |

### 總結

| 環境 | 原成本 | 使用 Lights-Out 後 | 月節省 | 年節省 |
|------|--------|-------------------|--------|--------|
| AirSync Dev + VS Account Stage | $166.44/月 | $85.73/月 | **$80.71** | **$968.52** |
| **投資報酬率 (ROI)** | - | - | - | **38,541%** |

**計算：**
- 基礎設施成本：$2.51/月 (一次性投入)
- 首月節省：$80.71 - $2.51 = **$78.20**
- ROI = ($968.52 / $2.51) × 100% = **38,541%**

---

## 總結：SSM 的價值

| 維度 | 傳統方式 | 使用 SSM |
|------|----------|----------|
| **配置更新速度** | 30-60 分鐘 (需部署) | 2 分鐘 (熱更新) |
| **團隊協作** | 需 Code Review | 自主管理配置 |
| **權限控制** | 程式碼級別 | IAM 路徑級別 |
| **審計追蹤** | Git log | CloudTrail |
| **災難復原** | Git revert + 重新部署 | 一鍵回滾 |
| **成本** | - | **免費** (標準參數) |
| **維護負擔** | 高 (每次改配置都需部署) | 低 (配置與程式碼分離) |

**核心理念：**
> 配置是「資料」，不是「程式碼」。資料應該存在「資料儲存系統」(SSM)，而非「程式碼儲存系統」(Git)。
