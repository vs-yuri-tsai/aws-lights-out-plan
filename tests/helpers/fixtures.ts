/**
 * Test fixtures and mock data factories.
 *
 * Provides reusable test data for unit tests.
 */

import type { Context } from "aws-lambda";
import type {
  Config,
  DiscoveredResource,
  HandlerResult,
  OrchestrationResult,
} from "@/types";

/**
 * Creates a mock AWS Lambda Context.
 *
 * @param overrides - Optional overrides for specific context properties
 * @returns Mock Lambda Context
 */
export function createMockContext(
  overrides: Partial<Context> = {}
): Context {
  const defaultContext: Context = {
    callbackWaitsForEmptyEventLoop: true,
    functionName: "lights-out-test",
    functionVersion: "1",
    invokedFunctionArn:
      "arn:aws:lambda:us-east-1:123456:function:lights-out-test",
    memoryLimitInMB: "512",
    awsRequestId: "test-request-id-123",
    logGroupName: "/aws/lambda/lights-out-test",
    logStreamName: "2024/12/22/[$LATEST]abc123",
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };

  return { ...defaultContext, ...overrides };
}

/**
 * Creates a mock Config object.
 *
 * @param overrides - Optional overrides for specific config properties
 * @returns Mock Config
 */
export function createMockConfig(overrides: Partial<Config> = {}): Config {
  const defaultConfig: Config = {
    version: "1.0",
    environment: "test",
    discovery: {
      method: "tags",
      tags: {
        "lights-out:managed": "true",
      },
      resource_types: ["ecs:service", "rds:db"],
    },
    settings: {
      schedule_tag: "lights-out:schedule",
    },
    resource_defaults: {
      "ecs-service": {
        wait_for_stable: false,
        stable_timeout_seconds: 300,
        default_desired_count: 1,
      },
      "rds-instance": {
        wait_for_stable: false,
        stable_timeout_seconds: 600,
      },
    },
  };

  return { ...defaultConfig, ...overrides };
}

/**
 * Creates a mock DiscoveredResource.
 *
 * @param resourceType - Type of resource (e.g., "ecs-service", "rds-instance")
 * @param overrides - Optional overrides for specific properties
 * @returns Mock DiscoveredResource
 */
export function createMockResource(
  resourceType: string,
  overrides: Partial<DiscoveredResource> = {}
): DiscoveredResource {
  const resourceDefaults: Record<string, Partial<DiscoveredResource>> = {
    "ecs-service": {
      arn: "arn:aws:ecs:us-east-1:123456:service/test-cluster/test-service",
      resourceId: "test-cluster/test-service",
      metadata: { cluster_name: "test-cluster" },
    },
    "rds-instance": {
      arn: "arn:aws:rds:us-east-1:123456:db:test-database",
      resourceId: "test-database",
      metadata: {},
    },
    "rds-cluster": {
      arn: "arn:aws:rds:us-east-1:123456:cluster:test-cluster",
      resourceId: "test-cluster",
      metadata: {},
    },
  };

  const defaults = resourceDefaults[resourceType] || {};

  return {
    resourceType,
    arn: defaults.arn || `arn:aws:${resourceType}:us-east-1:123456:resource/test`,
    resourceId: defaults.resourceId || "test-resource",
    priority: 50,
    group: "default",
    tags: {
      "lights-out:managed": "true",
    },
    metadata: defaults.metadata || {},
    ...overrides,
  };
}

/**
 * Creates a mock HandlerResult.
 *
 * @param action - Action performed ("start", "stop", "status")
 * @param success - Whether the operation succeeded
 * @param overrides - Optional overrides for specific properties
 * @returns Mock HandlerResult
 */
export function createMockHandlerResult(
  action: string,
  success: boolean,
  overrides: Partial<HandlerResult> = {}
): HandlerResult {
  const defaultResult: HandlerResult = {
    success,
    action,
    resourceType: "ecs-service",
    resourceId: "test-cluster/test-service",
    message: success
      ? `${action.charAt(0).toUpperCase() + action.slice(1)} successful`
      : `${action.charAt(0).toUpperCase() + action.slice(1)} failed`,
  };

  if (!success) {
    defaultResult.error = "Operation failed";
  }

  return { ...defaultResult, ...overrides };
}

/**
 * Creates a mock OrchestrationResult.
 *
 * @param total - Total number of resources
 * @param succeeded - Number of successful operations
 * @param failed - Number of failed operations
 * @param results - Optional array of HandlerResults
 * @returns Mock OrchestrationResult
 */
export function createMockOrchestrationResult(
  total: number,
  succeeded: number,
  failed: number,
  results?: HandlerResult[]
): OrchestrationResult {
  return {
    total,
    succeeded,
    failed,
    results: results || [],
  };
}

/**
 * Creates an array of mock DiscoveredResources.
 *
 * @param count - Number of resources to create
 * @param resourceType - Type of resource
 * @returns Array of mock resources
 */
export function createMockResourceList(
  count: number,
  resourceType: string = "ecs-service"
): DiscoveredResource[] {
  return Array.from({ length: count }, (_, index) =>
    createMockResource(resourceType, {
      resourceId: `${resourceType}-${index + 1}`,
      arn: `arn:aws:${resourceType}:us-east-1:123456:resource/${index + 1}`,
      priority: 50 + index * 10,
    })
  );
}

/**
 * Creates a mock error with specific message.
 *
 * @param message - Error message
 * @param code - Optional error code
 * @returns Error instance
 */
export function createMockError(message: string, code?: string): Error {
  const error = new Error(message);
  if (code) {
    (error as any).code = code;
  }
  return error;
}
