/**
 * Unit tests for handlers/base.ts
 *
 * Tests base types and utility functions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getResourceDefaults } from "@handlers/base";
import { Config, HandlerResult } from "@/types";

describe("getResourceDefaults utility", () => {
  let sampleConfig: Config;

  beforeEach(() => {
    sampleConfig = {
      version: "1.0",
      environment: "test",
      discovery: { method: "tags" },
      resource_defaults: {
        "test-resource": {
          wait_for_stable: true,
          stable_timeout_seconds: 300,
        },
      },
    };
  });

  it("should extract resource-type-specific defaults from config", () => {
    const defaults = getResourceDefaults(sampleConfig, "test-resource");

    expect(defaults).toEqual({
      wait_for_stable: true,
      stable_timeout_seconds: 300,
    });
  });

  it("should return empty object when resource type not in config", () => {
    const defaults = getResourceDefaults(sampleConfig, "unknown-type");

    expect(defaults).toEqual({});
  });

  it("should return empty object when resource_defaults is missing", () => {
    const configWithoutDefaults: Config = {
      version: "1.0",
      environment: "test",
      discovery: { method: "tags" },
    };

    const defaults = getResourceDefaults(
      configWithoutDefaults,
      "test-resource"
    );

    expect(defaults).toEqual({});
  });
});

describe("HandlerResult interface", () => {
  it("should support success result with all fields", () => {
    const result: HandlerResult = {
      success: true,
      action: "start",
      resourceType: "ecs-service",
      resourceId: "my-cluster/my-service",
      message: "Service started successfully",
      previousState: {
        desired_count: 0,
        running_count: 0,
      },
    };

    expect(result.success).toBe(true);
    expect(result.action).toBe("start");
    expect(result.resourceType).toBe("ecs-service");
    expect(result.resourceId).toBe("my-cluster/my-service");
    expect(result.message).toBe("Service started successfully");
    expect(result.previousState).toEqual({
      desired_count: 0,
      running_count: 0,
    });
  });

  it("should support error result with error field", () => {
    const result: HandlerResult = {
      success: false,
      action: "stop",
      resourceType: "rds-instance",
      resourceId: "my-database",
      message: "Stop operation failed",
      error: "DB instance not found",
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe("DB instance not found");
  });

  it("should allow optional fields to be undefined", () => {
    const result: HandlerResult = {
      success: true,
      action: "status",
      resourceType: "test",
      resourceId: "test-id",
      message: "Status retrieved",
    };

    expect(result.previousState).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});

describe("Config interface", () => {
  it("should support full configuration structure", () => {
    const config: Config = {
      version: "1.0",
      environment: "production",
      discovery: {
        method: "tags",
        tag_filters: {
          "lights-out:managed": "true",
        },
      },
      settings: {
        schedule_tag: "lights-out:schedule",
      },
      resource_defaults: {
        "ecs-service": {
          wait_for_stable: true,
          stable_timeout_seconds: 300,
          default_desired_count: 2,
        },
        "rds-instance": {
          wait_for_stable: false,
          stable_timeout_seconds: 600,
        },
      },
    };

    expect(config.version).toBe("1.0");
    expect(config.environment).toBe("production");
    expect(config.discovery.method).toBe("tags");
    expect(
      config.resource_defaults?.["ecs-service"]?.default_desired_count
    ).toBe(2);
    expect(config.resource_defaults?.["rds-instance"]?.wait_for_stable).toBe(
      false
    );
  });

  it("should allow minimal configuration", () => {
    const minimalConfig: Config = {
      version: "1.0",
      environment: "test",
      discovery: { method: "tags" },
    };

    expect(minimalConfig.resource_defaults).toBeUndefined();
  });
});
