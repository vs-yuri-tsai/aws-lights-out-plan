/**
 * Unit tests for Lambda handler (index.ts)
 *
 * Tests the main Lambda entry point function.
 * Uses Vitest hoisted mocks for proper module mocking.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Context } from "aws-lambda";
import type {
  Config,
  DiscoveredResource,
  OrchestrationResult,
} from "@/types";

// ============================================================================
// HOISTED MOCKS - Must be defined before imports
// ============================================================================

const { mockLoadConfigFromSsm, mockOrchestratorClass, mockDiscoverResourcesFn, mockRunFn } = vi.hoisted(() => {
  const mockLoadConfigFromSsm = vi.fn();
  const mockDiscoverResourcesFn = vi.fn();
  const mockRunFn = vi.fn();

  // Mock the Orchestrator class constructor
  const MockOrchestratorClass = vi.fn(function (this: any, config: Config) {
    this.discoverResources = mockDiscoverResourcesFn;
    this.run = mockRunFn;
  });

  return {
    mockLoadConfigFromSsm,
    mockOrchestratorClass: MockOrchestratorClass, // Export the mocked constructor
    mockDiscoverResourcesFn, // Expose the mock function
    mockRunFn, // Expose the mock function
  };
});

// Mock the modules using hoisted factories
vi.mock("@core/config", () => ({
  loadConfigFromSsm: mockLoadConfigFromSsm,
}));

vi.mock("@core/orchestrator", () => ({
  Orchestrator: mockOrchestratorClass, // Export the mocked constructor
}));

vi.mock("@utils/logger", () => ({
  setupLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import AFTER mocks are defined
import { main } from "@/index";

// ============================================================================
// TESTS
// ============================================================================

describe("Lambda Handler (main)", () => {
  let mockContext: Context;
  let mockConfig: Config;

  beforeEach(() => {
    // Create mock Lambda context
    mockContext = {
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
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
    };

    // Create mock config
    mockConfig = {
      version: "1.0",
      environment: "test",
      discovery: {
        method: "tags",
        tags: { "lights-out:managed": "true" },
        resource_types: ["ecs:service"],
      },
      settings: {
        schedule_tag: "lights-out:schedule",
      },
      resource_defaults: {},
    };

    // Reset all mocks
    vi.clearAllMocks();
  });

  describe("discover action", () => {
    it("should return discovered resources", async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: "ecs-service",
          arn: "arn:aws:ecs:us-east-1:123456:service/cluster/service",
          resourceId: "cluster/service",
          priority: 50,
          group: "default",
          tags: { "lights-out:managed": "true" },
          metadata: { cluster_name: "cluster" },
        },
        {
          resourceType: "rds-instance",
          arn: "arn:aws:rds:us-east-1:123456:db:my-database",
          resourceId: "my-database",
          priority: 100,
          group: "default",
          tags: { "lights-out:managed": "true" },
          metadata: {},
        },
      ];

      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockDiscoverResourcesFn.mockResolvedValue(mockResources);

      const event = { action: "discover" };
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.action).toBe("discover");
      expect(body.discovered_count).toBe(2);
      expect(body.resources).toHaveLength(2);
      expect(body.resources[0].resource_type).toBe("ecs-service");
      expect(body.resources[1].resource_type).toBe("rds-instance");
      expect(body.request_id).toBe("test-request-id-123");
      expect(body.timestamp).toBeDefined();

      expect(mockDiscoverResourcesFn).toHaveBeenCalledTimes(1);
      expect(mockRunFn).not.toHaveBeenCalled();
    });

    it("should return empty list when no resources found", async () => {
      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockDiscoverResourcesFn.mockResolvedValue([]);

      const event = { action: "discover" };
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.discovered_count).toBe(0);
      expect(body.resources).toHaveLength(0);
    });
  });

  describe("start action", () => {
    it("should execute start action and return results", async () => {
      const mockResult: OrchestrationResult = {
        total: 2,
        succeeded: 2,
        failed: 0,
        results: [
          {
            success: true,
            action: "start",
            resourceType: "ecs-service",
            resourceId: "cluster/service",
            message: "Started successfully",
          },
          {
            success: true,
            action: "start",
            resourceType: "rds-instance",
            resourceId: "my-database",
            message: "Started successfully",
          },
        ],
      };

      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockRunFn.mockResolvedValue(mockResult);

      const event = { action: "start" };
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.action).toBe("start");
      expect(body.total).toBe(2);
      expect(body.succeeded).toBe(2);
      expect(body.failed).toBe(0);
      expect(body.results).toHaveLength(2);
      expect(body.request_id).toBe("test-request-id-123");

      expect(mockRunFn).toHaveBeenCalledWith("start");
    });

    it("should handle partial failures", async () => {
      const mockResult: OrchestrationResult = {
        total: 2,
        succeeded: 1,
        failed: 1,
        results: [
          {
            success: true,
            action: "start",
            resourceType: "ecs-service",
            resourceId: "cluster/service",
            message: "Started successfully",
          },
          {
            success: false,
            action: "start",
            resourceType: "rds-instance",
            resourceId: "my-database",
            message: "Failed to start",
            error: "Database is in invalid state",
          },
        ],
      };

      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockRunFn.mockResolvedValue(mockResult);

      const event = { action: "start" };
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.total).toBe(2);
      expect(body.succeeded).toBe(1);
      expect(body.failed).toBe(1);
    });
  });

  describe("stop action", () => {
    it("should execute stop action and return results", async () => {
      const mockResult: OrchestrationResult = {
        total: 1,
        succeeded: 1,
        failed: 0,
        results: [
          {
            success: true,
            action: "stop",
            resourceType: "ecs-service",
            resourceId: "cluster/service",
            message: "Stopped successfully",
          },
        ],
      };

      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockRunFn.mockResolvedValue(mockResult);

      const event = { action: "stop" };
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.action).toBe("stop");
      expect(body.total).toBe(1);
      expect(body.succeeded).toBe(1);
      expect(body.failed).toBe(0);

      expect(mockRunFn).toHaveBeenCalledWith("stop");
    });
  });

  describe("status action", () => {
    it("should execute status action and return results", async () => {
      const mockResult: OrchestrationResult = {
        total: 1,
        succeeded: 1,
        failed: 0,
        results: [
          {
            success: true,
            action: "status",
            resourceType: "ecs-service",
            resourceId: "cluster/service",
            message: "Status retrieved successfully",
            previousState: {
              desired_count: 1,
              running_count: 1,
              status: "ACTIVE",
            },
          },
        ],
      };

      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockRunFn.mockResolvedValue(mockResult);

      const event = { action: "status" };
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.action).toBe("status");
      expect(body.results[0].previousState).toEqual({
        desired_count: 1,
        running_count: 1,
        status: "ACTIVE",
      });

      expect(mockRunFn).toHaveBeenCalledWith("status");
    });
  });

  describe("default action", () => {
    it("should default to status action when no action specified", async () => {
      const mockResult: OrchestrationResult = {
        total: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };

      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockRunFn.mockResolvedValue(mockResult);

      const event = {}; // No action specified
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.action).toBe("status");

      expect(mockRunFn).toHaveBeenCalledWith("status");
    });
  });

  describe("validation", () => {
    it("should reject invalid action", async () => {
      const event = { action: "invalid-action" };
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toContain("Invalid action 'invalid-action'");
      expect(body.error).toContain("start, stop, status, discover");
      expect(body.request_id).toBe("test-request-id-123");

      expect(mockLoadConfigFromSsm).not.toHaveBeenCalled();
    });

    it("should handle case-sensitive action validation", async () => {
      const event = { action: "START" }; // Uppercase
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(400);
      expect(mockLoadConfigFromSsm).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle config loading errors", async () => {
      mockLoadConfigFromSsm.mockRejectedValue(
        new Error("SSM parameter not found")
      );

      const event = { action: "start" };
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("SSM parameter not found");
      expect(body.request_id).toBe("test-request-id-123");
      expect(body.timestamp).toBeDefined();
    });

    it("should handle orchestrator execution errors", async () => {
      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockRunFn.mockRejectedValue(new Error("Orchestration failed"));

      const event = { action: "start" };
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("Orchestration failed");
    });

    it("should handle non-Error exceptions", async () => {
      mockLoadConfigFromSsm.mockRejectedValue("String error");

      const event = { action: "start" };
      const response = await main(event, mockContext);

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("String error");
    });
  });

  describe("context handling", () => {
    it("should use context request ID in response", async () => {
      const mockResult: OrchestrationResult = {
        total: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };

      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockRunFn.mockResolvedValue(mockResult);

      const customContext = {
        ...mockContext,
        awsRequestId: "custom-request-id-456",
      };

      const event = { action: "status" };
      const response = await main(event, customContext);

      const body = JSON.parse(response.body);
      expect(body.request_id).toBe("custom-request-id-456");
    });

    it("should use default request ID if context is malformed", async () => {
      const mockResult: OrchestrationResult = {
        total: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };

      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockRunFn.mockResolvedValue(mockResult);

      const malformedContext = {
        ...mockContext,
        awsRequestId: undefined,
      } as any;

      const event = { action: "status" };
      const response = await main(event, malformedContext);

      const body = JSON.parse(response.body);
      expect(body.request_id).toBe("local-test");
    });
  });

  describe("environment variable", () => {
    it("should use custom SSM parameter from environment variable", async () => {
      const originalEnv = process.env.CONFIG_PARAMETER_NAME;
      process.env.CONFIG_PARAMETER_NAME = "/custom/lights-out/config";

      const mockResult: OrchestrationResult = {
        total: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };

      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockRunFn.mockResolvedValue(mockResult);

      const event = { action: "status" };
      await main(event, mockContext);

      expect(mockLoadConfigFromSsm).toHaveBeenCalledWith(
        "/custom/lights-out/config"
      );

      // Restore
      if (originalEnv) {
        process.env.CONFIG_PARAMETER_NAME = originalEnv;
      } else {
        delete process.env.CONFIG_PARAMETER_NAME;
      }
    });

    it("should use default SSM parameter when environment variable not set", async () => {
      const originalEnv = process.env.CONFIG_PARAMETER_NAME;
      delete process.env.CONFIG_PARAMETER_NAME;

      const mockResult: OrchestrationResult = {
        total: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };

      mockLoadConfigFromSsm.mockResolvedValue(mockConfig);

      mockRunFn.mockResolvedValue(mockResult);

      const event = { action: "status" };
      await main(event, mockContext);

      expect(mockLoadConfigFromSsm).toHaveBeenCalledWith("/lights-out/config");

      // Restore
      if (originalEnv) {
        process.env.CONFIG_PARAMETER_NAME = originalEnv;
      }
    });
  });
});
