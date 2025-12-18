# app.py Testing Guide

## Overview

`app.py` 是 Lambda 函數的入口點，負責：
1. 接收 Lambda event
2. 載入 SSM 配置
3. 執行 Orchestrator
4. 回傳標準化響應

## Test Coverage

### Unit Tests (`tests/unit/test_app.py`)

所有測試使用 Mock，**不需要 AWS 資源**。

| 測試案例 | 驗證內容 |
|---------|---------|
| `test_handler_with_stop_action` | 執行 stop 動作並回傳正確結果 |
| `test_handler_with_start_action` | 執行 start 動作並回傳正確結果 |
| `test_handler_with_status_action` | 執行 status 動作並回傳正確結果 |
| `test_handler_with_discover_action` | 執行 discover 動作並列出資源 |
| `test_handler_without_action_defaults_to_status` | 缺少 action 時預設為 status |
| `test_handler_with_invalid_action_returns_error` | 無效 action 回傳 400 錯誤 |
| `test_handler_with_config_load_failure` | SSM 載入失敗時回傳 500 錯誤 |
| `test_handler_with_orchestrator_failure` | Orchestrator 失敗時回傳 500 錯誤 |
| `test_handler_uses_custom_ssm_parameter_name` | 支援自訂 SSM 參數名稱 |
| `test_handler_response_includes_metadata` | 回傳包含 timestamp 和 request_id |

### Running Unit Tests

```bash
# 在虛擬環境中執行
pytest tests/unit/test_app.py -v

# 查看覆蓋率
pytest tests/unit/test_app.py --cov=src.lambda_function.app --cov-report=term-missing
```

## Lambda Event Schema

### Input Event

```json
{
  "action": "start|stop|status|discover"
}
```

- **action** (可選，預設 `status`): 要執行的操作
  - `start`: 啟動資源
  - `stop`: 停止資源
  - `status`: 查詢資源狀態
  - `discover`: 列出所有被管理的資源

### Success Response

**Stop/Start/Status Actions:**
```json
{
  "statusCode": 200,
  "body": "{
    \"action\": \"stop\",
    \"total\": 10,
    \"succeeded\": 9,
    \"failed\": 1,
    \"results\": [...],
    \"timestamp\": \"2024-12-17T10:30:00Z\",
    \"request_id\": \"abc-123\"
  }"
}
```

**Discover Action:**
```json
{
  "statusCode": 200,
  "body": "{
    \"action\": \"discover\",
    \"discovered_count\": 10,
    \"resources\": [
      {
        \"resource_type\": \"ecs-service\",
        \"resource_id\": \"cluster/service\",
        \"arn\": \"arn:aws:ecs:...\",
        \"priority\": 50,
        \"group\": \"default\"
      }
    ],
    \"timestamp\": \"2024-12-17T10:30:00Z\",
    \"request_id\": \"abc-123\"
  }"
}
```

### Error Response

```json
{
  "statusCode": 400|500,
  "body": "{
    \"error\": \"Error message\",
    \"timestamp\": \"2024-12-17T10:30:00Z\",
    \"request_id\": \"abc-123\"
  }"
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_PARAMETER_NAME` | `/lights-out/config` | SSM 參數名稱 |

## Local Testing

### Option 1: Unit Tests (推薦)

```bash
# 執行所有 app.py 單元測試
pytest tests/unit/test_app.py -v
```

優點：
- 快速執行
- 不需要 AWS 資源
- 適合 CI/CD

### Option 2: Local Script

```bash
# 執行本地測試腳本
python examples/lambda_local_test.py
```

優點：
- 模擬真實 Lambda 執行
- 可測試與 AWS 的整合

缺點：
- 需要 AWS 憑證
- 需要 SSM 參數存在

## Integration Testing

完整整合測試請參考：
```bash
pytest tests/integration/test_orchestrator_with_handlers.py -v
```

## Error Handling

Handler 的錯誤處理策略：

| 錯誤類型 | Status Code | 行為 |
|---------|-------------|------|
| 無效 action | 400 | 回傳錯誤訊息，列出有效 action |
| SSM 載入失敗 | 500 | 記錄錯誤，回傳錯誤訊息 |
| Orchestrator 失敗 | 500 | 記錄錯誤，回傳錯誤訊息 |
| 未預期錯誤 | 500 | 記錄完整 traceback，回傳錯誤訊息 |

所有錯誤都會：
1. 記錄到 CloudWatch Logs（包含 traceback）
2. 回傳標準化錯誤響應
3. 包含 request_id 便於追蹤

## Logging

Handler 會記錄以下事件：

| Event | Level | 內容 |
|-------|-------|------|
| Lambda invoked | INFO | action, request_id, function_name |
| Config loaded | INFO | parameter_name |
| Invalid action | WARNING | action, valid_actions |
| Execution completed | INFO | action, total, request_id |
| Execution failed | ERROR | action, error, traceback |

日誌格式為結構化 JSON，方便 CloudWatch Insights 查詢。

## Best Practices

### 1. 使用環境變數控制配置

```python
# 在 Lambda 環境變數中設定
CONFIG_PARAMETER_NAME=/custom/path/config
```

### 2. 監控 CloudWatch Metrics

建議監控：
- Invocation count
- Error rate
- Duration
- Concurrent executions

### 3. 設定 Lambda Timeout

建議值：
- `discover` action: 30 秒
- `status` action: 60 秒
- `start/stop` action: 300 秒（如果啟用 wait_for_stable）

### 4. 設定 Lambda Memory

建議值：128-256 MB（根據資源數量調整）

## Troubleshooting

### 問題：Handler 回傳 500 錯誤

**解決方法：**
1. 檢查 CloudWatch Logs 中的完整 traceback
2. 確認 SSM 參數存在且格式正確
3. 確認 Lambda 有權限讀取 SSM

### 問題：discover 回傳空資源列表

**解決方法：**
1. 檢查資源是否有正確的 tags
2. 檢查 Lambda 是否有 Resource Groups Tagging API 權限
3. 確認配置中的 tag_filters 正確

### 問題：單元測試失敗

**解決方法：**
1. 確認虛擬環境已啟動
2. 確認所有依賴已安裝（`pip install -r requirements.txt`）
3. 檢查 Python 版本是否為 3.11

## Related Documentation

- [Orchestrator Testing](../tests/integration/test_orchestrator_with_handlers.py)
- [Handler Base Class](../src/lambda_function/handlers/base.py)
- [Configuration Guide](./tagging-guide.md)
