/**
 * Unit tests for handlers/factory.ts
 *
 * Tests handler factory function.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getHandler } from "@handlers/factory";
import { ECSServiceHandler } from "@handlers/ecsService";
import { RDSInstanceHandler } from "@handlers/rdsInstance";
import type { Config, DiscoveredResource } from "@/types";

describe("Handler Factory", () => {
  let sampleConfig: Config;

  beforeEach(() => {
    sampleConfig = {
      version: "1.0",
      environment: "test",
      discovery: { method: "tags" },
      resource_defaults: {
        "ecs-service": {
          waitForStable: false,
          stableTimeoutSeconds: 300,
          defaultDesiredCount: 1,
        },
        "rds-db": {
          waitForStable: false,
          stableTimeoutSeconds: 600,
        },
      },
    };
  });

  describe("getHandler", () => {
    it("should return ECSServiceHandler for ecs-service resource type", () => {
      const resource: DiscoveredResource = {
        resourceType: "ecs-service",
        arn: "arn:aws:ecs:us-east-1:123456:service/cluster/service",
        resourceId: "cluster/service",
        priority: 50,
        group: "default",
        tags: {},
        metadata: { cluster_name: "cluster" },
      };

      const handler = getHandler("ecs-service", resource, sampleConfig);

      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(ECSServiceHandler);
    });

    it("should return RDSInstanceHandler for rds-db resource type", () => {
      const resource: DiscoveredResource = {
        resourceType: "rds-db",
        arn: "arn:aws:rds:us-east-1:123456:db:my-database",
        resourceId: "my-database",
        priority: 100,
        group: "default",
        tags: {},
        metadata: {},
      };

      const handler = getHandler("rds-db", resource, sampleConfig);

      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(RDSInstanceHandler);
    });

    it("should return null for unknown resource type", () => {
      const resource: DiscoveredResource = {
        resourceType: "unknown-type",
        arn: "arn:aws:unknown:us-east-1:123456:resource/id",
        resourceId: "id",
        priority: 50,
        group: "default",
        tags: {},
        metadata: {},
      };

      const handler = getHandler("unknown-type", resource, sampleConfig);

      expect(handler).toBeNull();
    });

    it("should create handler with correct resource and config", () => {
      const resource: DiscoveredResource = {
        resourceType: "ecs-service",
        arn: "arn:aws:ecs:us-east-1:123456:service/test/test",
        resourceId: "test/test",
        priority: 50,
        group: "default",
        tags: { env: "test" },
        metadata: { cluster_name: "test" },
      };

      const handler = getHandler("ecs-service", resource, sampleConfig);

      expect(handler).toBeDefined();
      // Verify handler is created and can be used (test through public interface)
      expect(handler).toBeInstanceOf(ECSServiceHandler);
      expect(typeof handler!.getStatus).toBe("function");
      expect(typeof handler!.start).toBe("function");
      expect(typeof handler!.stop).toBe("function");
    });
  });

  describe("Factory with multiple handlers", () => {
    it("should create different handler instances for different resource types", () => {
      const ecsResource: DiscoveredResource = {
        resourceType: "ecs-service",
        arn: "arn:aws:ecs:us-east-1:123456:service/c/s",
        resourceId: "c/s",
        priority: 50,
        group: "default",
        tags: {},
        metadata: { cluster_name: "c" },
      };

      const rdsResource: DiscoveredResource = {
        resourceType: "rds-db",
        arn: "arn:aws:rds:us-east-1:123456:db:db",
        resourceId: "db",
        priority: 100,
        group: "default",
        tags: {},
        metadata: {},
      };

      const ecsHandler = getHandler("ecs-service", ecsResource, sampleConfig);
      const rdsHandler = getHandler("rds-db", rdsResource, sampleConfig);

      expect(ecsHandler).toBeInstanceOf(ECSServiceHandler);
      expect(rdsHandler).toBeInstanceOf(RDSInstanceHandler);
      expect(ecsHandler).not.toBe(rdsHandler);
    });

    it("should handle list of mixed resource types", () => {
      const resources: DiscoveredResource[] = [
        {
          resourceType: "ecs-service",
          arn: "arn:aws:ecs:us-east-1:123456:service/c1/s1",
          resourceId: "c1/s1",
          priority: 50,
          group: "default",
          tags: {},
          metadata: { cluster_name: "c1" },
        },
        {
          resourceType: "rds-db",
          arn: "arn:aws:rds:us-east-1:123456:db:db1",
          resourceId: "db1",
          priority: 100,
          group: "default",
          tags: {},
          metadata: {},
        },
        {
          resourceType: "unknown-type",
          arn: "arn:aws:unknown:us-east-1:123456:resource/r1",
          resourceId: "r1",
          priority: 150,
          group: "default",
          tags: {},
          metadata: {},
        },
      ];

      const handlers = resources.map((res) =>
        getHandler(res.resourceType, res, sampleConfig)
      );

      expect(handlers[0]).toBeInstanceOf(ECSServiceHandler);
      expect(handlers[1]).toBeInstanceOf(RDSInstanceHandler);
      expect(handlers[2]).toBeNull();
    });
  });
});
