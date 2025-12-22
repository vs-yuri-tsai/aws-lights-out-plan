# Python → TypeScript 遷移計畫：PoC 完整驗證

## 概覽

將現有的 Python Lambda 函式完整遷移至 TypeScript，驗證技術可行性並進行效能比较。採用 TDD 方式確保功能對等。

**PoC 目標：**
- ✅ 驗證開關燈完整流程（discover → orchestrate → start/stop）
- ✅ 效能比较（cold start、warm execution、bundle size）
- ✅ 完整功能遷移（10 個模塊 + 對等測試）
- ✅ 為生產部署提供參考資料

**精簡設計原則：**
- **目錄結構：** 簡單的 `/typescript` 目錄（不需要複雜 monorepo）
- **部署方式：** 獨立 TypeScript 函式（不需要雙函式部署）
- **測試策略：** aws-sdk-client-mock + vitest（80% 覆蓋率）
- **時间策略：** 按模塊漸進式遷移，無固定截止日期

---

## 1. 精簡目錄結構（PoC 版本）

```
aws-lights-out-plan/
├── src/lambda_function/             # 保持現有 Python 程式碼不動
├── tests/                           # 現有 Python 測試
├── requirements.txt
├── pytest.ini
│
└── typescript/                      # 新建 TypeScript PoC
    ├── package.json                 # TS 專案相依套件
    ├── tsconfig.json                # Strict mode + path aliases
    ├── vitest.config.ts             # 覆蓋率 80% 門檻
    ├── serverless.yml               # 獨立部署設定
    ├── src/
    │   ├── index.ts                 # Lambda handler (原 app.py)
    │   ├── core/
    │   │   ├── config.ts
    │   │   ├── scheduler.ts
    │   │   └── orchestrator.ts
    │   ├── discovery/
    │   │   ├── base.ts
    │   │   └── tagDiscovery.ts
    │   ├── handlers/
    │   │   ├── base.ts
    │   │   ├── ecsService.ts
    │   │   └── factory.ts
    │   └── utils/
    │       └── logger.ts
    ├── tests/
    │   ├── unit/
    │   ├── integration/
    │   └── helpers.ts               # Mock 工具（替代 conftest.py）
    └── docs/
        ├── PERFORMANCE.md           # 效能測試報告
        └── MIGRATION-NOTES.md       # 遷移記錄

```

**為什么精簡：**
- ❌ 不移動 Python 程式碼（保持現有結構，减少風險）
- ❌ 不需要 monorepo（只有一個 TS 專案）
- ❌ 不需要 /shared 工具（PoC 階段手動驗證即可）
- ✅ 獨立的 TypeScript 目錄（清楚隔離）

---

## 2. Serverless Framework 設定（精簡版）

**關鍵文件：** `typescript/serverless.yml`

### 核心設計：獨立 TypeScript 函式

```yaml
service: lights-out-ts

provider:
  name: aws
  region: ${opt:region, 'ap-southeast-1'}
  stage: ${opt:stage, 'poc'}  # 使用獨立 stage 避免冲突

  iam:
    role:
      statements:
        - Effect: Allow
          Action: [ssm:GetParameter]
          Resource: arn:aws:ssm:${aws:region}:${aws:accountId}:parameter/lights-out/*
        - Effect: Allow
          Action: [tag:GetResources]
          Resource: '*'
        - Effect: Allow
          Action: [ecs:DescribeServices, ecs:UpdateService]
          Resource: '*'

  environment:
    CONFIG_PARAMETER_NAME: /lights-out/${self:provider.stage}/config
    LOG_LEVEL: ${opt:loglevel, 'INFO'}

functions:
  lights-out:
    handler: dist/index.handler
    runtime: nodejs20.x
    timeout: 300
    memorySize: 512
    tags:
      runtime: typescript
      version: poc

custom:
  esbuild:
    bundle: true
    minify: true
    sourcemap: true
    exclude: ['aws-sdk']
    target: node20
    platform: node

plugins:
  - serverless-esbuild
```

**部署策略：**
```bash
cd typescript
pnpm install
serverless deploy --stage poc
```

**精簡理由：**
- ❌ 不需要雙函式設定（Python 保持獨立部署）
- ❌ 不需要 runtime switching（PoC 使用獨立 stage）
- ✅ 簡單直接，專注於驗證 TypeScript 實作

---

## 3. 遷移策略：按複雜度分階段執行

### 3.1 模塊遷移顺序（从簡單到複雜）

| 階段 | 模塊 | LOC | 複雜度 | 關鍵挑战 | 優先順序級 |
|------|------|-----|--------|---------|--------|
| **Phase 0** | `utils/logger` | 167 | ★☆☆☆☆ | 无相依套件，建立測試模式 | **先做** |
| **Phase 1** | `discovery/base` | 34 | ★☆☆☆☆ | Dataclass → Interface | 2 |
| **Phase 1** | `handlers/base` | 159 | ★★☆☆☆ | Abstract class → TS abstract | 3 |
| **Phase 1** | `handlers/factory` | 74 | ★☆☆☆☆ | Dict → Map | 4 |
| **Phase 2** | `core/config` | 70 | ★★☆☆☆ | `@lru_cache` → LRU package | 5 |
| **Phase 2** | `core/scheduler` | 113 | ★★★☆☆ | `zoneinfo` → date-fns-tz | 6 |
| **Phase 3** | `discovery/tagDiscovery` | 224 | ★★★★☆ | boto3 pagination → SDK v3 | 7 |
| **Phase 3** | `handlers/ecsService` | 383 | ★★★★☆ | boto3 ECS → SDK v3, Waiters | **最難** |
| **Phase 4** | `core/orchestrator` | 151 | ★★★☆☆ | Type guards | 9 |
| **Phase 4** | `index.ts` (app.py) | 218 | ★★★☆☆ | Lambda handler entry | 10 |

**總計：** ~1,592 LOC Python → ~2,100 LOC TypeScript（預计 +32% 用于顯式类型）

### 3.2 TDD 工作流程（每個模塊）

1. **測試先行：** 將 Python 測試檔转写為 TypeScript/vitest
2. **實作：** 写 TypeScript 實作直到測試通过
3. **驗證覆蓋率：** 確保 TS 覆蓋率 ≥ Python（允许 ±5% 误差）
4. **提交：** 同時提交測試 + 實作

**關鍵原則：**
- 每個 Python 測試必須有 1:1 对應的 TS 測試
- `pytest.mark.parametrize` → `test.each()` 或 `describe.each()`
- Moto 狀態式 mock → aws-sdk-client-mock + 自定义狀態 helper

---

## 4. 技術挑战与解决方案

### 4.1 Python 特性遷移对照表

| Python 特性 | TypeScript 方案 | 套件 |
|------------|----------------|------|
| `@dataclass` | `interface` + `class` 或 `type` | 内建 |
| `@lru_cache` | LRU 快取 | `lru-cache` |
| `zoneinfo` (時區) | 時區處理 | `date-fns-tz` |
| `PyYAML` | YAML 解析 + Zod 驗證 | `js-yaml` + `zod` |
| `boto3.client('ecs')` | ECS Client | `@aws-sdk/client-ecs` |
| `boto3` pagination | Async iterator | `paginateXxx` 或手動 loop |
| `boto3` waiters | Waiters API | `waitUntilXxx` |

### 4.2 關鍵技術细節

#### A. LRU 快取實作（config.ts）

```typescript
import { LRUCache } from 'lru-cache';

const configCache = new LRUCache<string, Config>({ max: 128 });

export async function loadConfigFromSSM(parameterName: string): Promise<Config> {
  if (configCache.has(parameterName)) {
    return configCache.get(parameterName)!;
  }
  const config = await fetchFromSSM(parameterName);
  configCache.set(parameterName, config);
  return config;
}
```

#### B. 時區處理（scheduler.ts）

```typescript
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { isWithinInterval } from 'date-fns';

export function isWorkingHours(date: Date, timezone: string, workStart: number, workEnd: number): boolean {
  const zonedTime = utcToZonedTime(date, timezone);
  const hour = zonedTime.getHours();
  return hour >= workStart && hour < workEnd;
}
```

#### C. ECS Waiter（ecsService.ts）

```typescript
import { waitUntilServicesStable } from '@aws-sdk/client-ecs';

await waitUntilServicesStable(
  {
    client: ecsClient,
    maxWaitTime: 300,
    minDelay: 10,
  },
  {
    cluster: clusterName,
    services: [serviceName],
  }
);
```

#### D. AWS SDK v3 Pagination

```typescript
import { paginateGetResources } from '@aws-sdk/client-resource-groups-tagging-api';

const paginator = paginateGetResources(
  { client: taggingClient },
  { TagFilters: [...] }
);

for await (const page of paginator) {
  for (const resource of page.ResourceTagMappingList ?? []) {
    // 處理資源
  }
}
```

---

## 5. 測試策略：Moto → aws-sdk-client-mock

### 5.1 Vitest 設定

**關鍵文件：** `typescript/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': './src',
      '@core': './src/core',
      '@handlers': './src/handlers',
    },
  },
});
```

### 5.2 Mock 策略差异

**Python (moto - 狀態式):**
```python
@mock_aws
def test_ecs_start():
    ecs = boto3.client('ecs')
    ecs.create_cluster(clusterName='test')
    ecs.create_service(cluster='test', serviceName='my-service', desiredCount=0)
    # 狀態会被保留
```

**TypeScript (aws-sdk-client-mock - 无狀態):**
```typescript
import { mockClient } from 'aws-sdk-client-mock';

const ecsMock = mockClient(ECSClient);

it('should start ECS service', async () => {
  // 需要明确定义每個 command 的回传值
  ecsMock.on(DescribeServicesCommand).resolves({
    services: [{ desiredCount: 0, runningCount: 0 }]
  });

  ecsMock.on(UpdateServiceCommand).resolves({
    service: { desiredCount: 1 }
  });

  // 測試程式碼
});
```

### 5.3 狀態式 Mock Helper

**關鍵文件：** `typescript/tests/helpers.ts`

```typescript
/**
 * 模拟 ECS 服务狀態（替代 moto 的狀態保留功能）
 */
export class MockECSState {
  private services = new Map<string, any>();

  createService(cluster: string, service: string, desiredCount: number) {
    this.services.set(`${cluster}/${service}`, { desiredCount, runningCount: desiredCount });
  }

  updateService(cluster: string, service: string, desiredCount: number) {
    const key = `${cluster}/${service}`;
    const current = this.services.get(key);
    this.services.set(key, { ...current, desiredCount });
  }

  mockDescribeServices(mock: any) {
    mock.on(DescribeServicesCommand).callsFake((input) => {
      const key = `${input.cluster}/${input.services[0]}`;
      return { services: [this.services.get(key)] };
    });
  }
}
```

---

## 6. 效能測試方案（PoC 關鍵驗證）

### 6.1 測試指標

| 指標 | Python 基准 | TypeScript 目標 | 测量方法 |
|------|-------------|----------------|----------|
| **Cold Start** | TBD | < 3 秒 | CloudWatch Logs (Init Duration) |
| **Warm Execution** | TBD | < 500 ms | CloudWatch Logs (Duration) |
| **Bundle Size** | N/A (解释型) | < 5 MB | `du -h dist/` |
| **Memory Usage** | 512 MB | 512 MB | CloudWatch Metrics (Max Memory Used) |

### 6.2 效能測試腳本

**關鍵文件：** `typescript/scripts/performance-test.sh`

```bash
#!/bin/bash
# 效能測試腳本

FUNCTION_NAME="lights-out-ts-poc"
ITERATIONS=10

echo "Testing Cold Start..."
for i in $(seq 1 $ITERATIONS); do
  aws lambda invoke --function-name $FUNCTION_NAME --payload '{"action":"status"}' /tmp/out.json
  sleep 60  # 等待 Lambda cold start
done

echo "Testing Warm Execution..."
for i in $(seq 1 $ITERATIONS); do
  aws lambda invoke --function-name $FUNCTION_NAME --payload '{"action":"status"}' /tmp/out.json
  sleep 1  # 保持 warm
done

echo "Analyzing results..."
aws logs tail /aws/lambda/$FUNCTION_NAME --format short --since 1h | grep "REPORT"
```

### 6.3 效能報告模板

**關鍵文件：** `typescript/docs/PERFORMANCE.md`

```markdown
# TypeScript vs Python 效能比较

## 測試環境
- Region: ap-southeast-1
- Memory: 512 MB
- Payload: {"action": "status"}

## 结果

| 指標 | Python | TypeScript | 差异 |
|------|--------|-----------|------|
| Cold Start (avg) | X ms | Y ms | +Z% |
| Warm Execution (avg) | X ms | Y ms | +Z% |
| Bundle Size | N/A | X MB | - |
| Memory Used (max) | X MB | Y MB | +Z% |

## 结论
[待填写]
```

---

## 7. 相依套件安装清單

### 7.1 TypeScript 运行時相依套件

**關鍵文件：** `typescript/package.json`

```json
{
  "name": "lights-out-typescript",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "build": "tsc && esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@aws-sdk/client-ssm": "^3.540.0",
    "@aws-sdk/client-resource-groups-tagging-api": "^3.540.0",
    "@aws-sdk/client-ecs": "^3.540.0",
    "date-fns": "^3.0.0",
    "date-fns-tz": "^2.0.0",
    "js-yaml": "^4.1.0",
    "lru-cache": "^10.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.133",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.11.0",
    "@vitest/coverage-v8": "^1.2.0",
    "aws-sdk-client-mock": "^3.0.1",
    "esbuild": "^0.19.0",
    "typescript": "^5.3.0",
    "vitest": "^1.2.0"
  }
}
```

### 7.2 NPM Scripts（常用指令）

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "build": "tsc && esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js",
    "deploy": "serverless deploy --stage poc",
    "deploy:prod": "serverless deploy --stage prod",
    "perf-test": "bash scripts/performance-test.sh",
    "lint": "eslint src --ext .ts"
  }
}
```

**精簡理由：**
- ❌ 不需要 monorepo 設定（pnpm-workspace.yaml）
- ❌ 不需要 verify-parity 腳本（PoC 手動驗證即可）
- ✅ 專注於開發、測試、部署流程

---

## 8. PoC 成功標準

### 完成檢查清單

- [ ] **程式碼對等**
  - [ ] 10 個 Python 模塊都有 TS 对應實作
  - [ ] 所有模塊通过 TypeScript strict mode 编译

- [ ] **測試對等**
  - [ ] 10 個測試檔案 1:1 对應遷移
  - [ ] 測試覆蓋率：TypeScript ≥ 80%（与 Python 對等）
  - [ ] 所有單元測試通过
  - [ ] 集成測試通过

- [ ] **功能驗證**
  - [ ] 部署至 `poc` stage 成功
  - [ ] 手動測試 4 個 actions (start/stop/status/discover)
  - [ ] 驗證与 Python 版本功能對等（相同 payload → 相同结果）

- [ ] **效能驗證（關鍵）**
  - [ ] Cold Start < 3 秒
  - [ ] Warm Execution < 500 ms
  - [ ] Bundle Size < 5 MB
  - [ ] 完成效能比较報告（PERFORMANCE.md）

- [ ] **文檔**
  - [ ] `PERFORMANCE.md` (效能測試報告)
  - [ ] `MIGRATION-NOTES.md` (遷移过程与技術挑战記錄)
  - [ ] 更新 `CLAUDE.md` 添加 TypeScript PoC 說明

---

## 9. PoC 風險与緩解

| 風險 | 机率 | 影響 | 緩解措施 |
|------|------|------|----------|
| AWS SDK v3 API 差异导致行為不一致 | 高 | 高 | 詳細對比測試，必要時建立 adapter layer |
| 測試覆蓋率低于 80% | 中 | 中 | 严格遵循 TDD，每個模塊完成后檢查覆蓋率 |
| 時區计算差异（zoneinfo vs date-fns-tz） | 中 | 高 | 使用 parametrized 測試驗證边界情况 |
| 效能不如預期（Cold Start > 3s） | 中 | 低 | PoC 重点在驗證，效能可后續優化（如使用 Lambda SnapStart） |
| ECS Waiter 行為差异 | 低 | 中 | 詳細測試 `waitUntilServicesStable` 超時和重试逻辑 |

**PoC 失败處理：**
- TypeScript PoC 獨立于生產環境 Python 版本
- 失败時可直接废弃 `/typescript` 目錄
- 成本仅為開發時间投入，无生產影響

---

## 10. 關鍵檔案清單（執行時參考）

| 優先順序級 | 檔案路径 | 用途 |
|-------|---------|------|
| **P0** | `typescript/serverless.yml` | 獨立 TypeScript 函式部署設定 |
| **P0** | `typescript/package.json` | TS 相依套件清單 + npm scripts |
| **P0** | `typescript/tsconfig.json` | Strict mode 設定 + path aliases |
| **P0** | `typescript/vitest.config.ts` | 測試設定（80% 門檻） |
| **P1** | `typescript/tests/helpers.ts` | Mock 工具（狀態式 ECS mock） |
| **P1** | `typescript/scripts/performance-test.sh` | 效能測試腳本 |
| **P2** | `typescript/src/handlers/ecsService.ts` | 最複雜模塊（383 LOC） |
| **P2** | `typescript/src/core/config.ts` | LRU cache + SSM 整合 |
| **P2** | `typescript/src/core/scheduler.ts` | 時區處理逻辑 |
| **P3** | `typescript/docs/PERFORMANCE.md` | 效能測試報告模板 |

---

## 11. 下一步行動（立即可开始）

### Phase 0：初始化 TypeScript PoC（30 分钟）

```bash
# 1. 建立 TypeScript 目錄
mkdir -p typescript/{src,tests,scripts,docs}

# 2. 初始化專案
cd typescript
pnpm init

# 3. 安装核心相依套件
pnpm add @aws-sdk/client-ssm @aws-sdk/client-ecs @aws-sdk/client-resource-groups-tagging-api
pnpm add date-fns date-fns-tz js-yaml lru-cache zod

# 4. 安装開發相依套件
pnpm add -D typescript @types/node @types/aws-lambda @types/js-yaml
pnpm add -D vitest @vitest/coverage-v8 aws-sdk-client-mock
pnpm add -D esbuild serverless serverless-esbuild

# 5. 建立設定文件
# - tsconfig.json（參考第 7.1 節）
# - vitest.config.ts（參考第 5.1 節）
# - serverless.yml（參考第 2 節）
```

### Phase 1：第一個模塊驗證（建立 TDD 流程）

**目標：遷移 `utils/logger.ts` 驗證整體流程**

1. 建立 `src/utils/logger.ts`
2. 建立 `tests/unit/utils/logger.test.ts`
3. 运行 `pnpm test` 确认測試通过
4. 运行 `pnpm test:coverage` 确认覆蓋率 ≥ 80%

### Phase 2-4：按模塊複雜度遷移

參考第 3.1 節顺序，逐步遷移剩余 9 個模塊。

### Phase 5：效能驗證

1. 部署至 `poc` stage
2. 运行 `pnpm perf-test`
3. 完成 `docs/PERFORMANCE.md` 報告

**關鍵原則：每完成一個模塊,立即驗證測試和覆蓋率，確保流程顺畅再繼續下一個。**
