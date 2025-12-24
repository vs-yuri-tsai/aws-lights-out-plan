/**
 * Unit tests for handlers/ecsService.ts
 *
 * Tests ECS Service Handler implementation using aws-sdk-client-mock
 * to mock AWS SDK v3 calls.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  ECSClient,
  DescribeServicesCommand,
  UpdateServiceCommand,
} from "@aws-sdk/client-ecs";
import { ECSServiceHandler } from "@handlers/ecsService";
import type { DiscoveredResource, Config } from "@/types";

const ecsMock = mockClient(ECSClient);

describe("ECSServiceHandler", () => {
  let sampleResource: DiscoveredResource;
  let sampleConfig: Config;

  beforeEach(() => {
    ecsMock.reset();

    sampleResource = {
      resourceType: "ecs-service",
      arn: "arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service",
      resourceId: "test-cluster/test-service",
      priority: 50,
      group: "default",
      tags: {
        "lights-out:managed": "true",
      },
      metadata: {
        cluster_name: "test-cluster",
      },
    };

    sampleConfig = {
      version: "1.0",
      environment: "test",
      discovery: {
        method: "tags",
      },
      resource_defaults: {
        "ecs-service": {
          wait_for_stable: false, // Disable for faster tests
          stable_timeout_seconds: 300,
          default_desired_count: 1,
        },
      },
    };
  });

  describe("constructor", () => {
    it("should extract region from ARN", async () => {
      const handler = new ECSServiceHandler(sampleResource, sampleConfig);

      expect(handler).toBeDefined();
      expect(await handler["ecsClient"].config.region()).toBe("us-east-1");
    });

    it("should extract cluster and service names correctly", () => {
      const handler = new ECSServiceHandler(sampleResource, sampleConfig);

      expect(handler["clusterName"]).toBe("test-cluster");
      expect(handler["serviceName"]).toBe("test-service");
    });

    it("should handle resource_id without cluster prefix", () => {
      const resourceWithoutCluster: DiscoveredResource = {
        ...sampleResource,
        resourceId: "my-service",
        metadata: {},
      };

      const handler = new ECSServiceHandler(
        resourceWithoutCluster,
        sampleConfig
      );

      expect(handler["clusterName"]).toBe("default");
      expect(handler["serviceName"]).toBe("my-service");
    });

    it("should use default region when ARN is missing", async () => {
      const resourceWithoutArn: DiscoveredResource = {
        ...sampleResource,
        arn: '',
      };

      const handler = new ECSServiceHandler(resourceWithoutArn, sampleConfig);
      // Client should be initialized, though we can't easily check region if it falls back to env var/default
      // But we can check it didn't crash
      expect(handler).toBeDefined();
    });
  });

  describe("getStatus", () => {
    it("should return service status with running tasks", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: "test-service",
            desiredCount: 2,
            runningCount: 2,
            status: "ACTIVE",
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status).toEqual({
        desired_count: 2,
        running_count: 2,
        status: "ACTIVE",
        is_stopped: false,
      });
    });

    it("should handle missing fields in service response", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: "test-service",
            // Missing counts and status
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status).toEqual({
        desired_count: 0,
        running_count: 0,
        status: "UNKNOWN",
        is_stopped: true, // 0 === 0
      });
    });

    it("should return status with is_stopped=true when desiredCount is 0", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: "test-service",
            desiredCount: 0,
            runningCount: 0,
            status: "ACTIVE",
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status.is_stopped).toBe(true);
      expect(status.desired_count).toBe(0);
    });

    it("should throw error when service not found", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);

      await expect(handler.getStatus()).rejects.toThrow(
        "Service test-service not found in cluster test-cluster"
      );
    });

    it("should call DescribeServicesCommand with correct parameters", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: "test-service",
            desiredCount: 1,
            runningCount: 1,
            status: "ACTIVE",
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      await handler.getStatus();

      expect(ecsMock.calls()).toHaveLength(1);
      expect(ecsMock.call(0).args[0].input).toEqual({
        cluster: "test-cluster",
        services: ["test-service"],
      });
    });
  });

  describe("stop", () => {
    it("should stop service by setting desiredCount to 0", async () => {
      // First call: getStatus (service is running)
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: "test-service",
            desiredCount: 2,
            runningCount: 2,
            status: "ACTIVE",
          },
        ],
      });

      ecsMock.on(UpdateServiceCommand).resolves({
        service: {
          serviceName: "test-service",
          desiredCount: 0,
        },
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.action).toBe("stop");
      expect(result.message).toContain("Service scaled to 0 (was 2)");
      expect(result.previousState).toMatchObject({
        desired_count: 2,
        running_count: 2,
      });

      // Verify UpdateServiceCommand was called
      const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[0].input).toEqual({
        cluster: "test-cluster",
        service: "test-service",
        desiredCount: 0,
      });
    });

    it("should wait for stable when configured", async () => {
      const configWithWait: Config = {
        ...sampleConfig,
        resource_defaults: {
          "ecs-service": {
            wait_for_stable: true,
            stable_timeout_seconds: 20, // Must be > minDelay (15s)
          },
        },
      };

      // 1. Initial status check
      ecsMock
        .on(DescribeServicesCommand)
        .resolvesOnce({
          services: [
            {
              serviceName: "test-service",
              desiredCount: 2,
              runningCount: 2,
              status: "ACTIVE",
            },
          ],
        })
        // 2. Waiter checks (multiple calls possible)
        .resolves({
          services: [
            {
              serviceName: "test-service",
              desiredCount: 0,
              runningCount: 0, // Matched desiredCount
              status: "ACTIVE",
              deployments: [
                {
                  status: "PRIMARY",
                  desiredCount: 0,
                  runningCount: 0,
                  pendingCount: 0,
                },
              ],
            },
          ],
        });

      ecsMock.on(UpdateServiceCommand).resolves({
        service: { serviceName: "test-service", desiredCount: 0 },
      });

      const handler = new ECSServiceHandler(sampleResource, configWithWait);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.message).toContain("Service scaled to 0");
      // Verify waiter was engaged (DescribeServicesCommand called more than once)
      expect(
        ecsMock.commandCalls(DescribeServicesCommand).length
      ).toBeGreaterThan(1);
    });

    it("should be idempotent - return success if already stopped", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: "test-service",
            desiredCount: 0,
            runningCount: 0,
            status: "ACTIVE",
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.message).toBe("Service already stopped");

      // UpdateServiceCommand should NOT be called
      const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
      expect(updateCalls).toHaveLength(0);
    });

    it("should return failure result on error", async () => {
      ecsMock.on(DescribeServicesCommand).rejects(new Error("Network error"));

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(false);
      expect(result.action).toBe("stop");
      expect(result.message).toBe("Stop operation failed");
      expect(result.error).toContain("Network error");
    });
  });

  describe("start", () => {
    it("should start service by setting desiredCount to configured value", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: "test-service",
            desiredCount: 0,
            runningCount: 0,
            status: "ACTIVE",
          },
        ],
      });

      ecsMock.on(UpdateServiceCommand).resolves({
        service: {
          serviceName: "test-service",
          desiredCount: 1,
        },
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.action).toBe("start");
      expect(result.message).toBe("Service scaled to 1");

      const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[0].input).toMatchObject({
        cluster: "test-cluster",
        service: "test-service",
        desiredCount: 1,
      });
    });

    it("should wait for stable when configured", async () => {
      const configWithWait: Config = {
        ...sampleConfig,
        resource_defaults: {
          "ecs-service": {
            wait_for_stable: true,
            stable_timeout_seconds: 20, // Must be > minDelay (15s)
            default_desired_count: 1,
          },
        },
      };

      // 1. Initial status check
      ecsMock
        .on(DescribeServicesCommand)
        .resolvesOnce({
          services: [
            {
              serviceName: "test-service",
              desiredCount: 0,
              runningCount: 0,
              status: "ACTIVE",
            },
          ],
        })
        // 2. Waiter checks
        .resolves({
          services: [
            {
              serviceName: "test-service",
              desiredCount: 1,
              runningCount: 1, // Matched target count
              status: "ACTIVE",
              deployments: [
                {
                  status: "PRIMARY",
                  desiredCount: 1,
                  runningCount: 1,
                  pendingCount: 0,
                },
              ],
            },
          ],
        });

      ecsMock.on(UpdateServiceCommand).resolves({
        service: { desiredCount: 1 },
      });

      const handler = new ECSServiceHandler(sampleResource, configWithWait);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(
        ecsMock.commandCalls(DescribeServicesCommand).length
      ).toBeGreaterThan(1);
    });

    it("should use configured default_desired_count", async () => {
      const configWithCount: Config = {
        ...sampleConfig,
        resource_defaults: {
          "ecs-service": {
            wait_for_stable: false,
            stable_timeout_seconds: 300,
            default_desired_count: 3,
          },
        },
      };

      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: "test-service",
            desiredCount: 0,
            runningCount: 0,
            status: "ACTIVE",
          },
        ],
      });

      ecsMock.on(UpdateServiceCommand).resolves({
        service: { desiredCount: 3 },
      });

      const handler = new ECSServiceHandler(sampleResource, configWithCount);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.message).toBe("Service scaled to 3");

      const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
      expect(updateCalls[0].args[0].input.desiredCount).toBe(3);
    });

    it("should be idempotent - return success if already at target count", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: "test-service",
            desiredCount: 1,
            runningCount: 1,
            status: "ACTIVE",
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.message).toContain("Service already at desired count 1");

      const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
      expect(updateCalls).toHaveLength(0);
    });

    it("should return failure result on error", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [{ desiredCount: 0, runningCount: 0, status: "ACTIVE" }],
      });

      ecsMock.on(UpdateServiceCommand).rejects(new Error("Permission denied"));

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.message).toBe("Start operation failed");
      expect(result.error).toContain("Permission denied");
    });
  });

  describe("isReady", () => {
    it("should return true when desired_count equals running_count", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            desiredCount: 2,
            runningCount: 2,
            status: "ACTIVE",
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(true);
    });

    it("should return false when counts do not match", async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            desiredCount: 2,
            runningCount: 1,
            status: "ACTIVE",
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });

    it("should return false on error", async () => {
      ecsMock.on(DescribeServicesCommand).rejects(new Error("API Error"));

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });
  });
});
