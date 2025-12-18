# Test Fixes - app.py

## 問題描述

執行 `pytest tests/unit/test_app.py -v` 時，三個測試案例失敗：

```
FAILED test_handler_with_invalid_action_returns_error - TypeError: Object of type MagicMock is not JSON serializable
FAILED test_handler_with_config_load_failure - TypeError: Object of type MagicMock is not JSON serializable
FAILED test_handler_with_orchestrator_failure - TypeError: Object of type MagicMock is not JSON serializable
```

## 根本原因

### 問題 1: MagicMock 自動屬性生成

當使用 `getattr(context, 'aws_request_id', 'local-test')` 時：

```python
context = MagicMock()
request_id = getattr(context, 'aws_request_id', 'local-test')
# ❌ request_id 是一個新的 MagicMock 物件，而不是 'local-test'
```

**Why?** MagicMock 會自動為任何訪問的屬性創建新的 MagicMock 物件。

### 問題 2: JSON 序列化失敗

當 `request_id` 是 MagicMock 時：

```python
json.dumps({"request_id": request_id})
# ❌ TypeError: Object of type MagicMock is not JSON serializable
```

## 解決方案

### 方案 A: 明確設定 Mock 屬性（已採用）

在測試中明確設定 context 屬性為實際值：

```python
context = MagicMock()
context.aws_request_id = "test-request-123"  # ✅ 明確設定為字串
context.function_name = "test-function"      # ✅ 明確設定為字串
```

**修改檔案：**
- `tests/unit/test_app.py`: 為所有失敗測試新增 context 屬性

### 方案 B: 使用 Helper Function（推薦未來使用）

建立可重用的 helper：

```python
# tests/helpers.py
def create_mock_lambda_context(function_name="test", request_id="123"):
    context = MagicMock()
    context.aws_request_id = request_id
    context.function_name = function_name
    return context

# 在測試中使用
from tests.helpers import create_mock_lambda_context
context = create_mock_lambda_context()
```

**新增檔案：**
- `tests/helpers.py`: 可重用的測試輔助函數

### 方案 C: 修改程式碼防禦（已實作）

在 `app.py` 中新增防禦性錯誤處理：

```python
# src/lambda_function/app.py
try:
    request_id = getattr(context, 'aws_request_id', 'local-test')
    function_name = getattr(context, 'function_name', 'lights-out')
except Exception:
    # Fallback if context is malformed
    request_id = 'unknown'
    function_name = 'lights-out'
```

## 修正後的測試案例

### Before (❌ 失敗)

```python
def test_handler_with_invalid_action_returns_error(...):
    event = {"action": "invalid_action"}
    context = MagicMock()  # ❌ 沒有設定屬性

    response = handler(event, context)
    # TypeError: Object of type MagicMock is not JSON serializable
```

### After (✅ 成功)

```python
def test_handler_with_invalid_action_returns_error(...):
    event = {"action": "invalid_action"}
    context = MagicMock()
    context.aws_request_id = "test-request-123"  # ✅ 明確設定
    context.function_name = "test-function"      # ✅ 明確設定

    response = handler(event, context)
    assert response["statusCode"] == 400
```

## 驗證修正

```bash
# 在虛擬環境中執行
pytest tests/unit/test_app.py -v

# 預期結果：所有 10 個測試通過
# ===================== 10 passed in X.XXs =====================
```

## 學習要點

### 1. MagicMock 的行為

```python
mock = MagicMock()

# 自動屬性生成
mock.any_attribute  # 返回新的 MagicMock，不是 None

# 使用 getattr 的預設值不會生效
getattr(mock, 'attr', 'default')  # 返回 MagicMock，不是 'default'
```

### 2. 正確的 Mock 設定

```python
# ❌ 錯誤：期望預設值生效
context = MagicMock()
request_id = getattr(context, 'aws_request_id', 'default')
# request_id 是 MagicMock

# ✅ 正確：明確設定屬性
context = MagicMock()
context.aws_request_id = 'test-123'
request_id = getattr(context, 'aws_request_id', 'default')
# request_id 是 'test-123'
```

### 3. JSON 序列化檢查

在測試中驗證回傳值可被序列化：

```python
response = handler(event, context)
body = json.loads(response["body"])  # ✅ 確保能被解析
```

## 最佳實踐

### 測試編寫

1. **明確設定 Mock 屬性**
   ```python
   context = MagicMock()
   context.aws_request_id = "actual-value"  # 不依賴自動生成
   ```

2. **使用 Helper Functions**
   ```python
   from tests.helpers import create_mock_lambda_context
   context = create_mock_lambda_context(request_id="custom-id")
   ```

3. **驗證 JSON 可序列化**
   ```python
   response = handler(event, context)
   # 驗證可以被解析（隱式驗證可序列化）
   body = json.loads(response["body"])
   ```

### 程式碼防禦

1. **安全的屬性存取**
   ```python
   try:
       value = getattr(obj, 'attr', 'default')
   except Exception:
       value = 'fallback'
   ```

2. **型別檢查**
   ```python
   if not isinstance(request_id, str):
       request_id = str(request_id) if request_id else 'unknown'
   ```

## 相關文件

- [Testing Guide](./app-testing-guide.md)
- [Test Helpers](../tests/helpers.py)
- [unittest.mock Documentation](https://docs.python.org/3/library/unittest.mock.html)
