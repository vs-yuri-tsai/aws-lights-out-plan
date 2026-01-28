# ASG Handler 開發規劃

本文件說明 EC2 Auto Scaling Groups Handler 的開發規劃，採用 TDD（Test-Driven Development）方式進行。

## 1. 可行性分析

### 1.1 評估結論：✅ 完全可行

| 評估項目 | 結論    | 說明                                                |
| -------- | ------- | --------------------------------------------------- |
| API 支援 | ✅ 完整 | `UpdateAutoScalingGroup` 可直接設定 Min/Max/Desired |
| 權限需求 | ✅ 簡單 | 只需 `autoscaling:*` 相關權限                       |
| 恢復機制 | ✅ 明確 | 設回原本的 Min/Max/Desired 即可                     |
| 複雜度   | ⚠️ 中等 | 需處理 Scaling Processes 暫停/恢復                  |

### 1.2 技術挑戰與解決方案

| 挑戰                  | 問題描述                                              | 解決方案                                |
| --------------------- | ----------------------------------------------------- | --------------------------------------- |
| Scaling Policies 衝突 | ASG 可能有 Target Tracking Policy，會自動調整 Desired | 停止時先 Suspend 相關 Scaling Processes |
| 實例終止資料遺失      | EC2 終止後，Instance Store 資料遺失                   | 只適用於無狀態工作負載，或確保用 EBS    |
| 啟動時間較長          | EC2 啟動需 2-5 分鐘                                   | 採用 Fire-and-Forget 模式               |

---

## 2. 架構設計

### 2.1 新增檔案

```
src/functions/handler/handlers/
├── asgGroup.ts           # ASG Handler 實作
└── asgGroup.test.ts      # ASG Handler 測試
```

### 2.2 配置格式

```yaml
resource_defaults:
  autoscaling-group:
    # 是否暫停 Scaling Processes（預設 true）
    suspendProcesses: true

    # 要暫停的 processes 清單
    processesToSuspend:
      - Launch
      - Terminate
      - HealthCheck
      - ReplaceUnhealthy
      - AZRebalance
      - ScheduledActions

    # Fire-and-Forget 等待秒數（預設 30）
    waitAfterCommand: 30

    # 啟動配置
    start:
      minSize: 2
      maxSize: 10
      desiredCapacity: 2

    # 停止配置
    stop:
      minSize: 0
      maxSize: 0
      desiredCapacity: 0
```

### 2.3 類型定義

```typescript
/**
 * ASG action configuration for start or stop operations.
 */
export interface ASGActionConfig {
  minSize: number;
  maxSize: number;
  desiredCapacity: number;
}

/**
 * ASG resource defaults configuration.
 */
export interface ASGResourceDefaults {
  /**
   * Whether to suspend scaling processes during stop operation.
   * Default: true
   */
  suspendProcesses?: boolean;

  /**
   * List of scaling processes to suspend.
   * Default: ['Launch', 'Terminate', 'HealthCheck', 'ReplaceUnhealthy', 'AZRebalance', 'ScheduledActions']
   */
  processesToSuspend?: string[];

  /**
   * Seconds to wait after sending command before returning.
   * Default: 30
   */
  waitAfterCommand?: number;

  /**
   * Configuration for START operation.
   */
  start: ASGActionConfig;

  /**
   * Configuration for STOP operation.
   */
  stop: ASGActionConfig;
}
```

---

## 3. 開發階段（TDD）

### Phase 1：基礎架構與類型定義

**目標：** 建立 Handler 基礎架構和類型定義

**任務：**

1. 新增 `ASGActionConfig` 和 `ASGResourceDefaults` 類型到 `types.ts`
2. 建立 `asgGroup.ts` 基礎類別結構
3. 實作 constructor（解析 ARN、初始化 client）

**測試案例：**

- [ ] `should correctly parse ASG name from ARN`
- [ ] `should initialize AutoScalingClient with correct region`

**Commit:** `feat(handlers): add ASG handler base structure`

---

### Phase 2：getStatus 實作

**目標：** 實作 `getStatus()` 方法

**API 使用：**

```typescript
await autoScaling.describeAutoScalingGroups({
  AutoScalingGroupNames: [asgName],
});
```

**回傳格式：**

```typescript
{
  min_size: number,
  max_size: number,
  desired_capacity: number,
  instances: number,
  is_stopped: boolean,  // desired_capacity === 0
  suspended_processes: string[]
}
```

**測試案例：**

- [ ] `should return correct status for running ASG`
- [ ] `should return is_stopped=true when desired_capacity is 0`
- [ ] `should include suspended_processes in status`
- [ ] `should throw error when ASG not found`

**Commit:** `feat(handlers): implement ASG getStatus method`

---

### Phase 3：stop 實作

**目標：** 實作 `stop()` 方法

**流程：**

1. 取得當前狀態
2. 檢查冪等性（已經停止則直接返回）
3. Suspend Scaling Processes（如果 `suspendProcesses: true`）
4. 更新 ASG（MinSize=0, MaxSize=0, DesiredCapacity=0）
5. 等待指定秒數
6. 返回結果

**測試案例：**

- [ ] `should stop ASG successfully`
- [ ] `should suspend scaling processes when configured`
- [ ] `should return idempotent result when already stopped`
- [ ] `should handle API errors gracefully`

**Commit:** `feat(handlers): implement ASG stop method`

---

### Phase 4：start 實作

**目標：** 實作 `start()` 方法

**流程：**

1. 取得當前狀態
2. 檢查冪等性（已經在目標狀態則直接返回）
3. 更新 ASG（MinSize=N, MaxSize=M, DesiredCapacity=D）
4. Resume Scaling Processes（如果之前有 suspend）
5. 等待指定秒數
6. 返回結果

**測試案例：**

- [ ] `should start ASG successfully`
- [ ] `should resume scaling processes when configured`
- [ ] `should return idempotent result when already at target`
- [ ] `should handle API errors gracefully`

**Commit:** `feat(handlers): implement ASG start method`

---

### Phase 5：isReady 實作

**目標：** 實作 `isReady()` 方法

**邏輯：**

- 當 `instances.length === desiredCapacity` 且所有 instances 都 InService 時返回 true

**測試案例：**

- [ ] `should return true when all instances are InService`
- [ ] `should return false when instances are still launching`
- [ ] `should return true when desiredCapacity is 0 and no instances`

**Commit:** `feat(handlers): implement ASG isReady method`

---

### Phase 6：Factory 整合

**目標：** 將 ASG Handler 整合到 factory

**任務：**

1. 在 `factory.ts` 新增 `autoscaling-group` handler 註冊
2. 更新 `index.ts` exports
3. 整合測試

**測試案例：**

- [ ] `should create ASGGroupHandler for autoscaling-group resource type`

**Commit:** `feat(handlers): integrate ASG handler into factory`

---

### Phase 7：Discovery 整合

**目標：** 擴展 tag discovery 支援 ASG

**任務：**

1. 在 `tagDiscovery.ts` 新增 `autoscaling:autoScalingGroup` 資源類型支援
2. 測試 discovery 功能

**測試案例：**

- [ ] `should discover ASG resources with lights-out tags`

**Commit:** `feat(discovery): add ASG resource type support`

---

### Phase 8：IAM 權限與文件更新

**目標：** 更新部署配置和文件

**任務：**

1. 更新 `serverless.yml` IAM 權限
2. 更新 `CLAUDE.md` 加入 ASG 配置說明
3. 更新 `config/` 範例配置

**Commit:** `docs(config): add ASG handler documentation and permissions`

---

## 4. IAM 權限需求

```yaml
# serverless.yml
iamRoleStatements:
  # 現有權限...

  # ASG 權限
  - Effect: Allow
    Action:
      - autoscaling:DescribeAutoScalingGroups
      - autoscaling:UpdateAutoScalingGroup
      - autoscaling:SuspendProcesses
      - autoscaling:ResumeProcesses
    Resource: '*'
```

---

## 5. 配置範例

### 5.1 完整配置

```yaml
# config/workshop.yml
version: '1.0'
environment: workshop

region_groups:
  asia:
    - ap-southeast-1

discovery:
  method: tags
  tags:
    lights-out:managed: 'true'
    lights-out:env: workshop
  resource_types:
    - ecs:service
    - rds:db
    - autoscaling:autoScalingGroup # 新增

resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      desiredCount: 1
    stop:
      desiredCount: 0

  rds-db:
    waitAfterCommand: 60
    skipSnapshot: true

  # 新增 ASG 配置
  autoscaling-group:
    suspendProcesses: true
    waitAfterCommand: 30
    start:
      minSize: 2
      maxSize: 10
      desiredCapacity: 2
    stop:
      minSize: 0
      maxSize: 0
      desiredCapacity: 0
```

### 5.2 Priority 建議

```yaml
# 在 AWS Console 設定 Tag
Tags:
  lights-out:managed: 'true'
  lights-out:env: workshop
  lights-out:priority: '50' # ASG 優先於 ECS，但在 RDS 之後
```

**建議 Priority 順序：**

| 資源類型 | 建議 Priority | 說明                         |
| -------- | ------------- | ---------------------------- |
| RDS      | 10            | 資料庫最慢，先啟動           |
| ASG      | 50            | 運算資源，中間啟動           |
| ECS      | 100           | 依賴 ASG（on EC2），最後啟動 |

---

## 6. 測試策略

### 6.1 單元測試

使用 `aws-sdk-client-mock` 模擬 AWS API：

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { AutoScalingClient } from '@aws-sdk/client-auto-scaling';

const autoScalingMock = mockClient(AutoScalingClient);

beforeEach(() => {
  autoScalingMock.reset();
});
```

### 6.2 測試覆蓋率目標

- Statements: > 90%
- Branches: > 85%
- Functions: > 90%
- Lines: > 90%

---

## 7. 風險評估

| 風險                | 影響 | 機率 | 緩解措施               |
| ------------------- | ---- | ---- | ---------------------- |
| ASG 實例資料遺失    | 高   | 低   | 文件說明只適用無狀態   |
| 啟動順序錯誤        | 中   | 中   | 使用 priority tag 控制 |
| Lambda 超時         | 中   | 中   | Fire-and-Forget 模式   |
| Scaling Policy 衝突 | 低   | 高   | 自動 Suspend Processes |

---

## 8. 時程估計

| Phase                   | 預估工時  |
| ----------------------- | --------- |
| Phase 1: 基礎架構       | 1h        |
| Phase 2: getStatus      | 1h        |
| Phase 3: stop           | 2h        |
| Phase 4: start          | 1.5h      |
| Phase 5: isReady        | 0.5h      |
| Phase 6: Factory 整合   | 0.5h      |
| Phase 7: Discovery 整合 | 1h        |
| Phase 8: 文件更新       | 1h        |
| **總計**                | **~8.5h** |
