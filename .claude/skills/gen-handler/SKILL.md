---
name: gen-handler
description: 建立新的 AWS 資源 handler（如 EC2、ElastiCache 等）
disable-model-invocation: true
---

# Generate Handler Skill

根據專案架構建立新的 AWS 資源 handler。

## 使用方式

```
/gen-handler <resource-type>
```

例如：`/gen-handler ec2-instance`

## 產生的檔案

1. **Handler 實作**
   - 路徑：`src/functions/handler/handlers/<resourceType>.ts`
   - 繼承 `ResourceHandler` 介面

2. **單元測試**
   - 路徑：`tests/unit/functions/handler/handlers/<resourceType>.test.ts`
   - 使用 `aws-sdk-client-mock` 模擬 AWS SDK

3. **更新 Factory**
   - 修改 `src/functions/handler/handlers/factory.ts` 註冊新 handler

## Handler 範本結構

```typescript
import { ResourceHandler, ResourceInfo, OperationResult } from './base';

export class <ResourceType>Handler implements ResourceHandler {
  readonly resourceType = '<resource-type>';

  async start(resource: ResourceInfo, config: ResourceConfig): Promise<OperationResult> {
    // 實作啟動邏輯
  }

  async stop(resource: ResourceInfo, config: ResourceConfig): Promise<OperationResult> {
    // 實作停止邏輯
  }

  async getStatus(resource: ResourceInfo): Promise<ResourceStatus> {
    // 實作狀態查詢
  }
}
```

## 參考現有實作

- ECS Service Handler: `src/functions/handler/handlers/ecsService.ts`
- RDS Instance Handler: `src/functions/handler/handlers/rdsInstance.ts`

## 必要的 Tags

新資源需要以下 tags 才能被 lights-out 管理：

```ini
lights-out:managed  = true
lights-out:env      = workshop | dev | staging
lights-out:priority = 100
```

## 注意事項

- 遵循 fail-fast: false 原則，單一資源失敗不中斷整體流程
- 使用 Zod 驗證配置
- 使用 Pino logger 記錄操作
- 考慮 AWS API rate limiting
