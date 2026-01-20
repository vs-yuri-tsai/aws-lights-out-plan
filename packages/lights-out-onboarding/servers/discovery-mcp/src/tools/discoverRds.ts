/**
 * RDS Instances Discovery Tool
 *
 * Discovers all RDS instances across specified AWS regions,
 * including tags and configuration.
 */

import {
  RDSClient,
  DescribeDBInstancesCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-rds';
import type { RdsInstanceInfo, DiscoverRdsInput } from '../types.js';

const LIGHTS_OUT_TAG_KEY = 'lights-out:managed';

/**
 * Discovers RDS instances in a single region.
 */
async function discoverInRegion(region: string): Promise<RdsInstanceInfo[]> {
  const rdsClient = new RDSClient({ region });
  const instances: RdsInstanceInfo[] = [];

  let marker: string | undefined;

  do {
    const describeResponse = await rdsClient.send(
      new DescribeDBInstancesCommand({ Marker: marker })
    );

    for (const instance of describeResponse.DBInstances || []) {
      if (!instance.DBInstanceIdentifier || !instance.DBInstanceArn) continue;

      // Get tags
      const tags = await getInstanceTags(rdsClient, instance.DBInstanceArn);
      const hasLightsOutTags = tags[LIGHTS_OUT_TAG_KEY] === 'true';

      instances.push({
        region,
        instanceId: instance.DBInstanceIdentifier,
        arn: instance.DBInstanceArn,
        engine: instance.Engine || 'unknown',
        engineVersion: instance.EngineVersion || 'unknown',
        status: instance.DBInstanceStatus || 'unknown',
        instanceClass: instance.DBInstanceClass || 'unknown',
        multiAZ: instance.MultiAZ || false,
        tags,
        hasLightsOutTags,
      });
    }

    marker = describeResponse.Marker;
  } while (marker);

  return instances;
}

/**
 * Gets tags for an RDS instance.
 */
async function getInstanceTags(
  client: RDSClient,
  resourceArn: string
): Promise<Record<string, string>> {
  try {
    const response = await client.send(
      new ListTagsForResourceCommand({ ResourceName: resourceArn })
    );
    const tags: Record<string, string> = {};
    for (const tag of response.TagList || []) {
      if (tag.Key && tag.Value !== undefined) {
        tags[tag.Key] = tag.Value;
      }
    }
    return tags;
  } catch {
    // Return empty tags if unable to fetch
    return {};
  }
}

/**
 * Discovers RDS instances across multiple regions.
 *
 * @param input - Input parameters with regions to scan
 * @returns Object containing discovered instances
 */
export async function discoverRdsInstances(
  input: DiscoverRdsInput
): Promise<{ instances: RdsInstanceInfo[] }> {
  const { regions } = input;

  // Discover in all regions in parallel
  const regionPromises = regions.map((region) => discoverInRegion(region));
  const regionResults = await Promise.all(regionPromises);

  // Flatten results
  const instances = regionResults.flat();

  return { instances };
}
