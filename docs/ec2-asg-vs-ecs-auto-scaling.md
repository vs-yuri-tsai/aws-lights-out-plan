# EC2 Auto Scaling Groups vs ECS Service Auto Scaling

本文件完整說明 EC2 Auto Scaling Groups 與 ECS Service Auto Scaling 的運作機制、差異比較及使用情境。

## 1. 運作機制詳解

### 1.1 EC2 Auto Scaling Groups (ASG)

ASG 是管理 **EC2 實例生命週期** 的服務，負責自動啟動和終止虛擬機。

#### 架構圖

```
┌─────────────────────────────────────────────────────────┐
│                  Auto Scaling Group                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Min: 2    Desired: 3    Max: 10                │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│    ┌──────┐   ┌──────┐   ┌──────┐                       │
│    │ EC2  │   │ EC2  │   │ EC2  │   ← 實際運行的實例    │
│    │  #1  │   │  #2  │   │  #3  │                       │
│    └──────┘   └──────┘   └──────┘                       │
│       │          │          │                            │
│       └──────────┼──────────┘                            │
│                  ↓                                       │
│         Load Balancer (ALB/NLB)                         │
└─────────────────────────────────────────────────────────┘
```

#### 核心概念

| 參數                | 說明                           | 範例 |
| ------------------- | ------------------------------ | ---- |
| **MinSize**         | 最小實例數量，ASG 不會低於此數 | 2    |
| **MaxSize**         | 最大實例數量，ASG 不會超過此數 | 10   |
| **DesiredCapacity** | 目標實例數量，ASG 會維持此數   | 3    |

#### 生活化例子：餐廳服務生管理

想像你經營一家餐廳：

- **Min = 2**：至少要有 2 個服務生（營業基本需求）
- **Max = 10**：最多雇用 10 個服務生（場地限制）
- **Desired = 3**：目標是維持 3 個服務生在場

**自動擴展情境：**

```
平日午餐 → 客人少 → CPU 使用率 30% → 維持 3 人
週末晚餐 → 客人多 → CPU 使用率 80% → 自動增到 6 人
深夜時段 → 幾乎沒客人 → CPU 使用率 10% → 縮減到 2 人（Min）
```

#### Scaling Policies 類型

1. **Target Tracking Scaling**
   - 維持某個指標在目標值
   - 例如：維持 CPU 使用率在 50%

2. **Step Scaling**
   - 根據指標階梯式調整
   - 例如：CPU > 70% 增加 2 台，CPU > 90% 增加 4 台

3. **Simple Scaling**
   - 簡單的增減規則
   - 例如：CPU > 80% 增加 1 台

4. **Scheduled Scaling**
   - 定時調整容量
   - 例如：每天 9:00 設為 5 台，18:00 設為 2 台

#### Scaling Processes

ASG 有多個可獨立控制的 Scaling Processes：

| Process             | 說明                     |
| ------------------- | ------------------------ |
| `Launch`            | 啟動新實例               |
| `Terminate`         | 終止實例                 |
| `AddToLoadBalancer` | 將實例加入 Load Balancer |
| `AlarmNotification` | 處理 CloudWatch 告警     |
| `AZRebalance`       | 跨可用區重新平衡         |
| `HealthCheck`       | 執行健康檢查             |
| `ReplaceUnhealthy`  | 替換不健康的實例         |
| `ScheduledActions`  | 執行排程動作             |

**重要：** 在 lights-out 情境中，需要 **Suspend** 這些 processes 以防止 ASG 自動調整容量。

#### 核心 API

```typescript
// 更新 ASG 容量
await autoScaling.updateAutoScalingGroup({
  AutoScalingGroupName: 'my-asg',
  MinSize: 0,
  MaxSize: 0,
  DesiredCapacity: 0,
});

// 暫停 Scaling Processes
await autoScaling.suspendProcesses({
  AutoScalingGroupName: 'my-asg',
  ScalingProcesses: ['Launch', 'Terminate', 'HealthCheck', 'ReplaceUnhealthy', 'AZRebalance'],
});

// 恢復 Scaling Processes
await autoScaling.resumeProcesses({
  AutoScalingGroupName: 'my-asg',
  ScalingProcesses: ['Launch', 'Terminate', 'HealthCheck', 'ReplaceUnhealthy', 'AZRebalance'],
});
```

---

### 1.2 ECS Service Auto Scaling

ECS Service Auto Scaling 是 **Application Auto Scaling** 的一部分，管理的是 **容器任務數量**，而非 EC2 實例。

#### 架構圖

```
┌─────────────────────────────────────────────────────────┐
│                    ECS Cluster                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │           ECS Service (my-api)                   │    │
│  │  Scalable Target: Min=2, Max=10                  │    │
│  │  Desired Count: 4                                │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│    ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                  │
│    │ Task │ │ Task │ │ Task │ │ Task │  ← 容器任務      │
│    │  #1  │ │  #2  │ │  #3  │ │  #4  │                  │
│    └──────┘ └──────┘ └──────┘ └──────┘                  │
│       ↑        ↑        ↑        ↑                      │
│    ┌──────────────────────────────────┐                 │
│    │  EC2 實例 或 Fargate (運算資源)   │                 │
│    └──────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

#### 核心概念

| 概念                | 說明                            |
| ------------------- | ------------------------------- |
| **Scalable Target** | 定義 MinCapacity 和 MaxCapacity |
| **Desired Count**   | ECS Service 的目標任務數量      |
| **Scaling Policy**  | 定義何時及如何擴展              |

#### 生活化例子：便利商店收銀台

想像 7-11 的收銀系統：

- 每個 **Task** = 一個收銀台（軟體程式）
- 收銀台可以快速開啟/關閉（容器啟動只需幾秒）
- 不需要蓋新店面（不用啟動新 EC2，Fargate 模式）

```
清晨 5 點 → 1 個客人 → 開 2 個收銀台（Min）
中午尖峰 → 排隊人潮 → 自動開到 8 個收銀台
凌晨 2 點 → 沒人 → 縮到 2 個收銀台（Min）
```

#### 兩層架構（ECS on EC2 模式）

當 ECS 運行在 EC2 上時，會有兩層 Auto Scaling：

```
Layer 1: EC2 Auto Scaling Group (管理 EC2 實例)
    ↓
Layer 2: ECS Service Auto Scaling (管理容器任務)
```

**重要考量：**

- 先有足夠的 EC2 實例，才能運行 ECS 任務
- 啟動順序：先啟動 ASG，再啟動 ECS Services
- 停止順序：先停止 ECS Services，再停止 ASG

#### 核心 API

```typescript
// 調整 Scalable Target（影響 Min/Max）
await appAutoScaling.registerScalableTarget({
  ServiceNamespace: 'ecs',
  ResourceId: 'service/my-cluster/my-service',
  ScalableDimension: 'ecs:service:DesiredCount',
  MinCapacity: 0,
  MaxCapacity: 0,
});

// 調整 ECS Service 的 desiredCount
await ecs.updateService({
  cluster: 'my-cluster',
  service: 'my-service',
  desiredCount: 0,
});
```

---

## 2. 差異比較表

| 面向                  | EC2 Auto Scaling Groups         | ECS Service Auto Scaling                   |
| --------------------- | ------------------------------- | ------------------------------------------ |
| **管理對象**          | EC2 實例（虛擬機）              | ECS Tasks（容器）                          |
| **使用的 API**        | `@aws-sdk/client-auto-scaling`  | `@aws-sdk/client-application-auto-scaling` |
| **擴展粒度**          | 整台機器（vCPU + RAM 整組）     | 單個容器（可精細控制資源）                 |
| **啟動時間**          | 2-5 分鐘（需開機、初始化）      | 10-60 秒（容器啟動）                       |
| **成本單位**          | EC2 實例時數                    | Fargate: vCPU + 記憶體秒數                 |
| **終止時行為**        | 實例被終止，EBS 可選保留        | 容器停止，無狀態                           |
| **底層基礎設施**      | 自己管理 EC2                    | Fargate 完全託管 / EC2 自管                |
| **資料持久性**        | Instance Store 會遺失，EBS 保留 | 無狀態，需外部儲存                         |
| **Scaling Processes** | 有（需手動暫停/恢復）           | 無（透過調整 Min/Max 即可）                |

---

## 3. 使用情境

### 3.1 選擇 EC2 ASG 的情境

```
✓ 需要 GPU 實例（ML 訓練、推論）
✓ 需要特殊網路配置（ENI、固定 IP）
✓ 傳統應用程式（非容器化）
✓ 需要存取本地磁碟（高 IOPS）
✓ License 綁定實例（某些企業軟體）
✓ 需要完整作業系統控制權
✓ 長時間運行的批次任務
```

### 3.2 選擇 ECS Service Auto Scaling 的情境

```
✓ 微服務架構
✓ 需要快速擴展（秒級回應）
✓ 容器化應用程式
✓ 無狀態服務
✓ 想要精細的資源分配（0.25 vCPU, 512MB RAM）
✓ 希望降低運維負擔（Fargate）
✓ 需要頻繁部署更新
```

### 3.3 混合架構

在實際環境中，經常會同時使用兩者：

```
┌─────────────────────────────────────────────────────────┐
│                    Production Environment                │
│                                                          │
│  ┌─────────────────────┐   ┌─────────────────────┐      │
│  │   EC2 ASG (GPU)     │   │   ECS on Fargate    │      │
│  │   ┌─────┐ ┌─────┐   │   │   ┌────┐ ┌────┐    │      │
│  │   │ ML  │ │ ML  │   │   │   │API │ │API │    │      │
│  │   │ GPU │ │ GPU │   │   │   │    │ │    │    │      │
│  │   └─────┘ └─────┘   │   │   └────┘ └────┘    │      │
│  └─────────────────────┘   └─────────────────────┘      │
│           ↑                          ↑                   │
│           │                          │                   │
│     ML 推論任務                 API 服務               │
│     （需要 GPU）               （無狀態）               │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Lights-Out 情境下的特殊考量

### 4.1 啟動/停止順序

在 ECS on EC2 架構中，必須注意資源的依賴關係：

**停止順序（高 priority 數字先停）：**

1. ECS Services（priority: 100）
2. EC2 ASG（priority: 50）
3. RDS Instances（priority: 10）

**啟動順序（低 priority 數字先啟）：**

1. RDS Instances（priority: 10）
2. EC2 ASG（priority: 50）
3. ECS Services（priority: 100）

### 4.2 等待時間

| 資源類型     | 停止時間  | 啟動時間  | 建議策略        |
| ------------ | --------- | --------- | --------------- |
| ECS Service  | 30-60 秒  | 30-60 秒  | 等待穩定        |
| EC2 ASG      | 1-3 分鐘  | 2-5 分鐘  | Fire-and-Forget |
| RDS Instance | 5-10 分鐘 | 5-10 分鐘 | Fire-and-Forget |

### 4.3 成本節省效益

| 資源          | 停止時是否計費 | 說明                               |
| ------------- | -------------- | ---------------------------------- |
| EC2 On-Demand | 否             | 實例終止後不計費                   |
| EC2 Reserved  | 是             | 預留容量仍計費（但可用於其他帳號） |
| ECS Fargate   | 否             | 任務停止後不計費                   |
| RDS           | 否             | 停止後不計費（7 天後自動啟動）     |

---

## 5. 參考資源

- [AWS Auto Scaling Documentation](https://docs.aws.amazon.com/autoscaling/)
- [Application Auto Scaling Documentation](https://docs.aws.amazon.com/autoscaling/application/userguide/)
- [ECS Service Auto Scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)
