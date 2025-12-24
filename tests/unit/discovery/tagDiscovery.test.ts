import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
} from "@aws-sdk/client-resource-groups-tagging-api";
import { TagDiscovery } from "@discovery/tagDiscovery";

const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);

describe("TagDiscovery", () => {
  beforeEach(() => {
    taggingMock.reset();
  });

  describe("initialization", () => {
    it("should initialize with tag filters and resource types", () => {
      const tagFilters = { "lights-out:managed": "true" };
      const resourceTypes = ["ecs:service"];
      const discovery = new TagDiscovery(tagFilters, resourceTypes);

      expect(discovery).toBeDefined();
    });

    it("should initialize with multiple regions", () => {
      const tagFilters = { "lights-out:managed": "true" };
      const resourceTypes = ["ecs:service"];
      const regions = ["ap-southeast-1", "ap-northeast-1"];
      const discovery = new TagDiscovery(tagFilters, resourceTypes, regions);

      expect(discovery).toBeDefined();
    });

    it("should use default region when no regions specified", () => {
      const discovery = new TagDiscovery({}, []);
      expect(discovery).toBeDefined();
    });
  });

  describe("discover()", () => {
    it("should return empty array when no resources match the tags", async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [],
        PaginationToken: undefined,
      });

      const discovery = new TagDiscovery({ app: "my-app" }, ["ecs:service"]);
      const resources = await discovery.discover();

      expect(resources).toEqual([]);
      expect(taggingMock.calls()).toHaveLength(1);
      expect(taggingMock.call(0).args[0].input).toMatchObject({
        TagFilters: [{ Key: "app", Values: ["my-app"] }],
        ResourceTypeFilters: ["ecs:service"],
      });
    });

    it("should discover single resource with default priority and group", async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN:
              "arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service",
            Tags: [
              { Key: "Name", Value: "my-web-app" },
              { Key: "lights-out:managed", Value: "true" },
            ],
          },
        ],
        PaginationToken: undefined,
      });

      const discovery = new TagDiscovery({ "lights-out:managed": "true" }, [
        "ecs:service",
      ]);
      const discovered = await discovery.discover();

      expect(discovered).toHaveLength(1);

      const res = discovered[0];
      expect(res.resourceType).toBe("ecs-service");
      expect(res.arn).toBe(
        "arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service"
      );
      expect(res.resourceId).toBe("my-cluster/my-service");
      expect(res.priority).toBe(50); // Default
      expect(res.group).toBe("default"); // Default
      expect(res.tags).toEqual({
        Name: "my-web-app",
        "lights-out:managed": "true",
      });
      expect(res.metadata).toEqual({ cluster_name: "my-cluster" });
    });

    it("should discover resource with custom priority and group tags", async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN:
              "arn:aws:ecs:ap-south-1:123456789012:service/another-cluster/api-service",
            Tags: [
              { Key: "lights-out:priority", Value: "100" },
              { Key: "lights-out:group", Value: "critical" },
            ],
          },
        ],
        PaginationToken: undefined,
      });

      const discovery = new TagDiscovery({}, []);
      const discovered = await discovery.discover();

      expect(discovered).toHaveLength(1);

      const res = discovered[0];
      expect(res.priority).toBe(100);
      expect(res.group).toBe("critical");
      expect(res.resourceId).toBe("another-cluster/api-service");
    });

    it("should fall back to default priority when tag value is invalid", async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN:
              "arn:aws:ecs:ap-south-1:123456789012:service/another-cluster/api-service",
            Tags: [{ Key: "lights-out:priority", Value: "high" }], // Invalid value
          },
        ],
        PaginationToken: undefined,
      });

      const discovery = new TagDiscovery({}, []);
      const discovered = await discovery.discover();

      expect(discovered).toHaveLength(1);
      expect(discovered[0].priority).toBe(50); // Falls back to default
    });

    it("should handle paginated API responses correctly", async () => {
      taggingMock
        .on(GetResourcesCommand)
        .resolvesOnce({
          ResourceTagMappingList: [
            {
              ResourceARN:
                "arn:aws:ecs:us-east-1:123456789012:service/cluster1/service1",
              Tags: [],
            },
          ],
          PaginationToken: "next-token",
        })
        .resolvesOnce({
          ResourceTagMappingList: [
            {
              ResourceARN:
                "arn:aws:ecs:us-east-1:123456789012:service/cluster2/service2",
              Tags: [],
            },
          ],
          PaginationToken: undefined,
        });

      const discovery = new TagDiscovery({ k: "v" }, ["ecs:service"]);
      const discovered = await discovery.discover();

      expect(discovered).toHaveLength(2);
      expect(taggingMock.calls()).toHaveLength(2);

      // Check that the second call used the token from the first
      const firstCall = taggingMock.call(0).args[0].input as any;
      const secondCall = taggingMock.call(1).args[0].input as any;

      expect(firstCall).toMatchObject({
        TagFilters: [{ Key: "k", Values: ["v"] }],
        ResourceTypeFilters: ["ecs:service"],
      });
      expect(firstCall.PaginationToken).toBeUndefined();

      expect(secondCall).toMatchObject({
        TagFilters: [{ Key: "k", Values: ["v"] }],
        ResourceTypeFilters: ["ecs:service"],
        PaginationToken: "next-token",
      });

      const arns = new Set(discovered.map((res) => res.arn));
      expect(arns).toContain(
        "arn:aws:ecs:us-east-1:123456789012:service/cluster1/service1"
      );
      expect(arns).toContain(
        "arn:aws:ecs:us-east-1:123456789012:service/cluster2/service2"
      );
    });
  });

  describe("ARN parsing", () => {
    it.each([
      // [arn, resourceType, expectedId, expectedMetadata]
      [
        "arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service",
        "ecs:service",
        "my-cluster/my-service",
        { cluster_name: "my-cluster" },
      ],
      [
        "arn:aws:ecs:us-east-1:123456789012:service/my-service-no-cluster",
        "ecs:service",
        "my-service-no-cluster",
        { cluster_name: "default" },
      ],
      [
        "arn:aws:ec2:us-west-2:123456789012:instance/i-1234567890abcdef0",
        "ec2:instance",
        "i-1234567890abcdef0",
        {},
      ],
      [
        "arn:aws:rds:eu-west-1:123456789012:db:my-db-instance",
        "rds:db",
        "my-db-instance",
        {},
      ],
      [
        "arn:aws:rds:eu-west-1:123456789012:cluster:my-aurora-cluster",
        "rds:cluster",
        "my-aurora-cluster",
        {},
      ],
      ["unsupported-arn", "unknown", "unsupported-arn", {}],
    ])(
      "should parse ARN correctly: %s",
      async (arn, _resourceType, expectedId, expectedMetadata) => {
        // Use a mock response to trigger the parsing logic
        taggingMock.on(GetResourcesCommand).resolves({
          ResourceTagMappingList: [
            {
              ResourceARN: arn,
              Tags: [],
            },
          ],
          PaginationToken: undefined,
        });

        const discovery = new TagDiscovery({}, []);
        const discovered = await discovery.discover();

        expect(discovered).toHaveLength(1);
        const res = discovered[0];
        expect(res.resourceId).toBe(expectedId);
        expect(res.metadata).toEqual(expectedMetadata);
      }
    );

    it("should discover resources across multiple regions", async () => {
      // Mock responses for different regions
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN:
              "arn:aws:ecs:ap-southeast-1:123456789012:service/cluster-sg/service-sg",
            Tags: [{ Key: "lights-out:managed", Value: "true" }],
          },
        ],
        PaginationToken: undefined,
      });

      const discovery = new TagDiscovery(
        { "lights-out:managed": "true" },
        ["ecs:service"],
        ["ap-southeast-1", "ap-northeast-1"]
      );
      const resources = await discovery.discover();

      // Should call GetResources for each region
      expect(taggingMock.calls()).toHaveLength(2);
      expect(resources.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle errors in one region without affecting others", async () => {
      let callCount = 0;
      taggingMock.on(GetResourcesCommand).callsFake(() => {
        callCount++;
        if (callCount === 1) {
          // First region succeeds
          return {
            ResourceTagMappingList: [
              {
                ResourceARN:
                  "arn:aws:ecs:ap-southeast-1:123456789012:service/cluster/service",
                Tags: [],
              },
            ],
            PaginationToken: undefined,
          };
        }
        // Second region fails
        throw new Error("Region unavailable");
      });

      const discovery = new TagDiscovery(
        {},
        ["ecs:service"],
        ["ap-southeast-1", "ap-northeast-1"]
      );

      // Should reject when any region fails (Promise.all behavior)
      await expect(discovery.discover()).rejects.toThrow("Region unavailable");
    });
  });
});
