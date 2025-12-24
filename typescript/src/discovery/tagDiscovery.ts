/**
 * Tag-based resource discovery for AWS lights-out scheduler.
 *
 * Uses AWS Resource Groups Tagging API to discover resources
 * that should be managed by the scheduler.
 */

import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
  type ResourceTagMapping,
} from "@aws-sdk/client-resource-groups-tagging-api";
import type { DiscoveredResource } from "@/types";
import { setupLogger } from "@utils/logger";

const logger = setupLogger("lights-out:tag-discovery");

/**
 * Discovers AWS resources based on resource tags.
 */
export class TagDiscovery {
  private static readonly DEFAULT_PRIORITY = 50;
  private static readonly DEFAULT_GROUP = "default";

  private readonly tagFilters: Record<string, string>;
  private readonly resourceTypes: string[];
  private readonly regions: string[];

  /**
   * Initializes the TagDiscovery strategy.
   *
   * @param tagFilters - Dictionary of tags to filter resources by (e.g., {'lights-out:managed': 'true'})
   * @param resourceTypes - List of AWS resource types to scan (e.g., ['ecs:service'])
   * @param regions - List of AWS regions to scan (defaults to Lambda's deployment region)
   */
  constructor(
    tagFilters: Record<string, string>,
    resourceTypes: string[],
    regions: string[] = []
  ) {
    this.tagFilters = tagFilters;
    this.resourceTypes = resourceTypes;
    // If no regions specified, use the Lambda's deployment region
    this.regions = regions.length > 0 ? regions : [process.env.AWS_REGION || "ap-southeast-1"];
  }

  /**
   * Discovers all resources matching the configured tags and resource types.
   * Scans across all configured regions in parallel for optimal performance.
   *
   * @returns List of discovered resources with parsed metadata
   */
  async discover(): Promise<DiscoveredResource[]> {
    logger.info(`Scanning ${this.regions.length} region(s): ${this.regions.join(", ")}`);

    // Discover resources in all regions in parallel
    const regionPromises = this.regions.map((region) =>
      this.discoverInRegion(region)
    );

    const regionResults = await Promise.all(regionPromises);

    // Flatten results from all regions
    const allResources = regionResults.flat();

    logger.info(`Discovered ${allResources.length} total resources across all regions`);
    return allResources;
  }

  /**
   * Discovers resources in a single region.
   * Handles pagination from the GetResources API.
   *
   * @param region - AWS region to scan
   * @returns List of discovered resources in this region
   */
  private async discoverInRegion(region: string): Promise<DiscoveredResource[]> {
    logger.debug(`Scanning region: ${region}`);
    const discoveredResources: DiscoveredResource[] = [];

    // Create region-specific client
    const client = new ResourceGroupsTaggingAPIClient({ region });

    // Convert tag filters to AWS API format
    const tagFiltersList = Object.entries(this.tagFilters).map(([key, value]) => ({
      Key: key,
      Values: [value],
    }));

    let paginationToken: string | undefined;

    do {
      const command = new GetResourcesCommand({
        TagFilters: tagFiltersList,
        ResourceTypeFilters: this.resourceTypes,
        PaginationToken: paginationToken,
      });

      const response = await client.send(command);

      // Process each resource in the response
      for (const resourceMap of response.ResourceTagMappingList ?? []) {
        const discoveredResource = this.processResourceMapping(resourceMap);
        discoveredResources.push(discoveredResource);
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    logger.debug(`Found ${discoveredResources.length} resources in ${region}`);
    return discoveredResources;
  }

  /**
   * Processes a single resource mapping from AWS API response.
   *
   * @param resourceMap - Resource mapping object from GetResources API
   * @returns DiscoveredResource object with parsed information
   */
  private processResourceMapping(
    resourceMap: ResourceTagMapping
  ): DiscoveredResource {
    // Extract and transform tags
    const tags: Record<string, string> = {};
    for (const tag of resourceMap.Tags ?? []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    const arn = resourceMap.ResourceARN!;

    // Extract and validate priority from tags
    const priorityStr =
      tags["lights-out:priority"] ?? String(TagDiscovery.DEFAULT_PRIORITY);
    const parsedPriority = parseInt(priorityStr, 10);
    const priority = isNaN(parsedPriority)
      ? (logger.warn(
          `Invalid priority '${priorityStr}' on resource ${arn}. ` +
            `Falling back to default ${TagDiscovery.DEFAULT_PRIORITY}.`
        ),
        TagDiscovery.DEFAULT_PRIORITY)
      : parsedPriority;

    const group = tags["lights-out:group"] ?? TagDiscovery.DEFAULT_GROUP;

    // Parse ARN to get resource type and ID
    const awsResourceType = TagDiscovery.extractResourceTypeFromArn(arn);
    const [resourceId, metadata] = TagDiscovery.parseResourceIdAndMetadata(
      arn,
      awsResourceType
    );
    const internalResourceType = awsResourceType.replace(":", "-");

    return {
      resourceType: internalResourceType,
      arn,
      resourceId,
      priority,
      group,
      tags,
      metadata,
    };
  }

  /**
   * Extracts the resource type from an ARN.
   *
   * ARN format: arn:aws:service:region:account:resource-type/resource-id
   *
   * Examples:
   * - arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service → ecs:service
   * - arn:aws:ec2:us-west-2:123456789012:instance/i-1234567890abcdef0 → ec2:instance
   * - arn:aws:rds:eu-west-1:123456789012:db:my-db-instance → rds:db
   * - arn:aws:rds:eu-west-1:123456789012:cluster:my-aurora-cluster → rds:cluster
   *
   * @param arn - AWS ARN to parse
   * @returns Resource type in format "service:type"
   */
  private static extractResourceTypeFromArn(arn: string): string {
    const parts = arn.split(":");
    if (parts.length < 6) {
      return "unknown";
    }

    const service = parts[2]; // e.g., 'ecs', 'ec2', 'rds'
    const resourcePart = parts[5]; // e.g., 'service/...', 'instance/...', 'db:...', 'cluster:...'

    // Extract the resource type (first part before '/' or ':')
    let resourceType: string;
    if (resourcePart.includes("/")) {
      resourceType = resourcePart.split("/")[0];
    } else if (resourcePart.includes(":")) {
      resourceType = resourcePart.split(":")[0];
    } else {
      resourceType = resourcePart;
    }

    return `${service}:${resourceType}`;
  }

  /**
   * Parses an ARN to extract a human-readable resource ID and any relevant metadata.
   *
   * Examples:
   * - ECS: arn:aws:ecs:region:account:service/cluster/service-name
   *        → resource_id="cluster/service-name", metadata={'cluster_name': 'cluster'}
   * - ECS: arn:aws:ecs:region:account:service/service-name
   *        → resource_id="service-name", metadata={'cluster_name': 'default'}
   * - EC2: arn:aws:ec2:region:account:instance/i-xxxxx
   *        → resource_id="i-xxxxx", metadata={}
   * - RDS: arn:aws:rds:region:account:db:db-name
   *        → resource_id="db-name", metadata={}
   *
   * @param arn - AWS ARN to parse
   * @param resourceType - Resource type (e.g., "ecs:service")
   * @returns Tuple of [resourceId, metadata]
   */
  private static parseResourceIdAndMetadata(
    arn: string,
    resourceType: string
  ): [string, Record<string, unknown>] {
    const parts = arn.split(":");
    if (parts.length < 6) {
      // Malformed ARN, return as-is
      return [arn, {}];
    }

    const resourceIdPart = parts[parts.length - 1];
    const metadata: Record<string, unknown> = {};

    if (resourceType === "ecs:service") {
      // arn:aws:ecs:region:account-id:service/cluster-name/service-name
      // or arn:aws:ecs:region:account-id:service/service-name
      const resourceParts = resourceIdPart.split("/");

      if (resourceParts.length >= 3) {
        // Format: service/cluster-name/service-name
        const clusterName = resourceParts[resourceParts.length - 2];
        const serviceName = resourceParts[resourceParts.length - 1];
        metadata.cluster_name = clusterName;
        return [`${clusterName}/${serviceName}`, metadata];
      } else if (resourceParts.length === 2) {
        // Format: service/service-name (no cluster)
        const serviceName = resourceParts[resourceParts.length - 1];
        metadata.cluster_name = "default";
        return [serviceName, metadata];
      } else {
        // Unexpected format
        metadata.cluster_name = "default";
        return [resourceIdPart, metadata];
      }
    }

    if (resourceType === "ec2:instance") {
      // arn:aws:ec2:region:account-id:instance/i-12345
      if (resourceIdPart.includes("/")) {
        return [resourceIdPart.split("/").pop()!, {}];
      }
      return [resourceIdPart, {}];
    }

    if (resourceType === "rds:db" || resourceType === "rds:cluster") {
      // arn:aws:rds:region:account-id:db:my-db-instance
      // arn:aws:rds:region:account-id:cluster:my-aurora-cluster
      if (resourceIdPart.includes(":")) {
        return [resourceIdPart.split(":").pop()!, {}];
      }
      return [resourceIdPart, {}];
    }

    // Unsupported resource type or malformed ARN
    return [arn, {}];
  }
}
