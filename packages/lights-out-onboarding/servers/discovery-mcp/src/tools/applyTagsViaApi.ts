/**
 * Apply Tags Via API Tool
 *
 * Applies Lights Out tags to AWS resources (ECS services, RDS instances)
 * via AWS SDK APIs.
 */

import { ECSClient, TagResourceCommand } from '@aws-sdk/client-ecs';
import { RDSClient, AddTagsToResourceCommand } from '@aws-sdk/client-rds';
import { fromSSO } from '@aws-sdk/credential-provider-sso';
import type {
  ApplyTagsViaApiInput,
  ApplyTagsResult,
  TagApplicationResult,
  ResourceToTag,
} from '../types.js';

/**
 * Extract region from ARN
 */
function extractRegionFromArn(arn: string): string {
  const parts = arn.split(':');
  if (parts.length >= 4) {
    return parts[3];
  }
  return 'us-east-1'; // Default fallback
}

/**
 * Apply tags to an ECS service
 */
async function applyEcsTags(
  resource: ResourceToTag,
  profile?: string,
  dryRun = false
): Promise<TagApplicationResult> {
  const region = extractRegionFromArn(resource.arn);

  if (dryRun) {
    return {
      arn: resource.arn,
      type: 'ecs-service',
      status: 'skipped',
      appliedTags: resource.tags,
    };
  }

  try {
    const clientConfig = profile ? { region, credentials: fromSSO({ profile }) } : { region };

    const client = new ECSClient(clientConfig);

    const command = new TagResourceCommand({
      resourceArn: resource.arn,
      tags: [
        { key: 'lights-out:managed', value: resource.tags['lights-out:managed'] },
        { key: 'lights-out:project', value: resource.tags['lights-out:project'] },
        { key: 'lights-out:priority', value: resource.tags['lights-out:priority'] },
      ],
    });

    await client.send(command);

    return {
      arn: resource.arn,
      type: 'ecs-service',
      status: 'success',
      appliedTags: resource.tags,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      arn: resource.arn,
      type: 'ecs-service',
      status: 'failed',
      error: errorMessage,
    };
  }
}

/**
 * Apply tags to an RDS instance
 */
async function applyRdsTags(
  resource: ResourceToTag,
  profile?: string,
  dryRun = false
): Promise<TagApplicationResult> {
  const region = extractRegionFromArn(resource.arn);

  if (dryRun) {
    return {
      arn: resource.arn,
      type: 'rds-db',
      status: 'skipped',
      appliedTags: resource.tags,
    };
  }

  try {
    const clientConfig = profile ? { region, credentials: fromSSO({ profile }) } : { region };

    const client = new RDSClient(clientConfig);

    const command = new AddTagsToResourceCommand({
      ResourceName: resource.arn,
      Tags: [
        { Key: 'lights-out:managed', Value: resource.tags['lights-out:managed'] },
        { Key: 'lights-out:project', Value: resource.tags['lights-out:project'] },
        { Key: 'lights-out:priority', Value: resource.tags['lights-out:priority'] },
      ],
    });

    await client.send(command);

    return {
      arn: resource.arn,
      type: 'rds-db',
      status: 'success',
      appliedTags: resource.tags,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      arn: resource.arn,
      type: 'rds-db',
      status: 'failed',
      error: errorMessage,
    };
  }
}

/**
 * Applies Lights Out tags to AWS resources via API.
 *
 * @param input - Input parameters
 * @returns Results of tag application
 */
export async function applyTagsViaApi(input: ApplyTagsViaApiInput): Promise<ApplyTagsResult> {
  const { resources, dryRun = false, profile } = input;

  const results: TagApplicationResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const resource of resources) {
    let result: TagApplicationResult;

    if (resource.type === 'ecs-service') {
      result = await applyEcsTags(resource, profile, dryRun);
    } else if (resource.type === 'rds-db' || resource.type === 'rds-cluster') {
      result = await applyRdsTags(resource, profile, dryRun);
    } else {
      result = {
        arn: resource.arn,
        type: resource.type,
        status: 'failed',
        error: `Unknown resource type: ${resource.type}`,
      };
    }

    results.push(result);

    switch (result.status) {
      case 'success':
        succeeded++;
        break;
      case 'failed':
        failed++;
        break;
      case 'skipped':
        skipped++;
        break;
    }
  }

  return {
    success: failed === 0,
    dryRun,
    results,
    summary: {
      total: resources.length,
      succeeded,
      failed,
      skipped,
    },
  };
}
