# Test Suite Documentation

## Overview

完整的單元測試套件，涵蓋 TypeScript 遷移後的 orchestrator 和 Lambda handler。

## Test Structure

```
tests/
├── unit/
│   ├── core/
│   │   ├── orchestrator.test.ts  ✅ 新增：Orchestrator 測試
│   │   └── config.test.ts
│   ├── discovery/
│   │   └── tagDiscovery.test.ts
│   ├── handlers/
│   │   ├── factory.test.ts
│   │   ├── ecsService.test.ts
│   │   └── rdsInstance.test.ts
│   ├── utils/
│   │   └── logger.test.ts
│   └── index.test.ts             ✅ 新增：Lambda handler 測試
├── helpers/
│   ├── fixtures.ts               ✅ 新增：測試 fixtures
│   ├── assertions.ts             ✅ 新增：自訂 assertions
│   └── index.ts
├── setup.ts
└── README.md
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run tests with coverage
```bash
npm run test:coverage
```

### Run specific test file
```bash
npx vitest run tests/unit/core/orchestrator.test.ts
npx vitest run tests/unit/index.test.ts
```

### Run tests matching a pattern
```bash
npx vitest run -t "orchestrator"
npx vitest run -t "Lambda handler"
```

## Test Coverage

### Orchestrator Tests (`orchestrator.test.ts`)

✅ **Discovery**
- ✅ Should discover resources using TagDiscovery
- ✅ Should return empty array when no tag filters configured
- ✅ Should return empty array when no resource types configured
- ✅ Should handle missing tags or resource_types

✅ **Actions (start/stop/status)**
- ✅ Should execute start action on all resources
- ✅ Should execute stop action on all resources
- ✅ Should retrieve status for all resources
- ✅ Should handle multiple resources with mixed success/failure

✅ **Error Handling**
- ✅ Should handle missing handler gracefully
- ✅ Should handle handler execution errors gracefully
- ✅ Should continue processing after individual resource failures

✅ **Edge Cases**
- ✅ Should handle empty resource list
- ✅ Should handle all resources failing
- ✅ Should handle all resources succeeding

### Lambda Handler Tests (`index.test.ts`)

✅ **Discover Action**
- ✅ Should return discovered resources
- ✅ Should return empty list when no resources found

✅ **Start Action**
- ✅ Should execute start action and return results
- ✅ Should handle partial failures

✅ **Stop Action**
- ✅ Should execute stop action and return results

✅ **Status Action**
- ✅ Should execute status action and return results

✅ **Default Behavior**
- ✅ Should default to status action when no action specified

✅ **Validation**
- ✅ Should reject invalid action
- ✅ Should handle case-sensitive action validation

✅ **Error Handling**
- ✅ Should handle config loading errors
- ✅ Should handle orchestrator execution errors
- ✅ Should handle non-Error exceptions

✅ **Context Handling**
- ✅ Should use context request ID in response
- ✅ Should use default request ID if context is malformed

✅ **Environment Variables**
- ✅ Should use custom SSM parameter from environment variable
- ✅ Should use default SSM parameter when not set

## Test Helpers

### Fixtures (`tests/helpers/fixtures.ts`)

Provides factory functions for creating test data:

```typescript
import {
  createMockContext,
  createMockConfig,
  createMockResource,
  createMockHandlerResult,
  createMockOrchestrationResult,
  createMockResourceList,
  createMockError,
} from "../helpers";

// Example usage
const context = createMockContext({ awsRequestId: "custom-id" });
const config = createMockConfig({ environment: "prod" });
const resource = createMockResource("ecs-service");
const resources = createMockResourceList(5, "rds-instance");
```

### Assertions (`tests/helpers/assertions.ts`)

Provides domain-specific assertions:

```typescript
import {
  assertSuccessfulResult,
  assertFailedResult,
  assertOrchestrationCounts,
  assertLambdaResponse,
  assertValidExecutionResult,
  assertValidDiscoveryResult,
  assertErrorResponse,
  assertMixedResults,
} from "../helpers";

// Example usage
assertSuccessfulResult(result, "start", "cluster/service");
assertOrchestrationCounts(result, { total: 2, succeeded: 1, failed: 1 });
assertLambdaResponse(response, 200);
assertValidExecutionResult(body, "start");
```

## Mocking Strategy

### External Dependencies

All external dependencies are mocked:

```typescript
vi.mock("@discovery/tagDiscovery");
vi.mock("@handlers/factory");
vi.mock("@core/config");
vi.mock("@core/orchestrator");
vi.mock("@utils/logger");
```

### Mock Implementation

Use Vitest's `vi.mocked()` for type-safe mocking:

```typescript
vi.mocked(TagDiscovery).mockImplementation(() => ({
  discover: vi.fn().mockResolvedValue(mockResources),
}));

vi.mocked(getHandler).mockReturnValue(mockHandler);
vi.mocked(loadConfigFromSsm).mockResolvedValue(mockConfig);
```

## Best Practices

### 1. Use Fixtures
Always use fixtures from `tests/helpers/fixtures.ts` instead of creating test data inline:

```typescript
// ✅ Good
const resource = createMockResource("ecs-service");

// ❌ Bad
const resource = {
  resourceType: "ecs-service",
  arn: "...",
  // ... many fields
};
```

### 2. Use Custom Assertions
Use domain-specific assertions for clearer test intent:

```typescript
// ✅ Good
assertOrchestrationCounts(result, { total: 2, succeeded: 1, failed: 1 });

// ❌ Verbose
expect(result.total).toBe(2);
expect(result.succeeded).toBe(1);
expect(result.failed).toBe(1);
```

### 3. Clear Test Names
Use descriptive test names that explain what is being tested:

```typescript
// ✅ Good
it("should handle multiple resources with mixed success/failure", ...)

// ❌ Bad
it("test orchestrator", ...)
```

### 4. AAA Pattern
Follow Arrange-Act-Assert pattern:

```typescript
it("should execute start action", async () => {
  // Arrange
  const mockResources = [...];
  vi.mocked(TagDiscovery).mockImplementation(...);

  // Act
  const result = await orchestrator.run("start");

  // Assert
  expect(result.succeeded).toBe(1);
});
```

### 5. Mock Cleanup
Mocks are automatically cleaned up after each test via `tests/setup.ts`:

```typescript
// tests/setup.ts
afterEach(() => {
  vi.restoreAllMocks();
});
```

## Coverage Thresholds

Minimum coverage thresholds (configured in `vitest.config.ts`):

- Lines: 80%
- Functions: 80%
- Branches: 80%
- Statements: 80%

## Continuous Integration

Tests should be run in CI/CD pipeline:

```yaml
# Example GitHub Actions
- name: Run tests
  run: npm test

- name: Check coverage
  run: npm run test:coverage
```

## Debugging Tests

### Run single test in watch mode
```bash
npx vitest watch -t "should execute start action"
```

### Enable verbose logging
```bash
DEBUG=* npx vitest run
```

### Use Vitest UI
```bash
npx vitest --ui
```

## Migration Notes

### KISS Optimizations Reflected in Tests

1. **No Schedule Tag Checking**
   - Tests do NOT check for schedule tag logic (removed per KISS)
   - Orchestrator processes all discovered resources directly

2. **Simplified Discovery**
   - Tests only cover TagDiscovery (no strategy selection)
   - Reflects PoC-stage simplification

3. **Type Safety**
   - All tests leverage TypeScript type safety
   - Compile-time errors caught before runtime

4. **No Result Serialization**
   - Tests don't check for serialization helpers (not needed in TS)
   - Direct object assertions

## Troubleshooting

### Mock not working
Ensure mock is defined before the test:
```typescript
vi.mock("@module/path"); // Must be at top level
```

### Type errors in mocks
Use `vi.mocked()` for type-safe mocking:
```typescript
vi.mocked(myFunction).mockReturnValue(...);
```

### Tests timing out
Increase timeout in specific test:
```typescript
it("slow test", async () => {
  // ...
}, 10000); // 10 second timeout
```
