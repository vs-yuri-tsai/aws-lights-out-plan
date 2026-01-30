/**
 * Verify Tags Tool
 *
 * Verifies that Lights Out tags have been successfully applied
 * to AWS resources (ECS services, RDS instances).
 */

import { ECSClient, ListTagsForResourceCommand } from '@aws-sdk/client-ecs';
import { RDSClient, ListTagsForResourceCommand as RDSListTagsCommand } from '@aws-sdk/client-rds';
import { fromSSO } from '@aws-sdk/credential-provider-sso';
import type {
  VerifyTagsInput,
  VerifyTagsResult,
  TagVerificationResult,
  LightsOutTags,
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
 * Compare expected tags with actual tags
 */
function compareTags(
  expectedTags: LightsOutTags,
  actualTags: Record<string, string>
): { matches: boolean; mismatches: string[] } {
  const mismatches: string[] = [];

  for (const [key, expectedValue] of Object.entries(expectedTags)) {
    const actualValue = actualTags[key];
    if (actualValue === undefined) {
      mismatches.push(`Missing tag: ${key}`);
    } else if (actualValue !== expectedValue) {
      mismatches.push(`Tag ${key}: expected "${expectedValue}", got "${actualValue}"`);
    }
  }

  return {
    matches: mismatches.length === 0,
    mismatches,
  };
}

/**
 * Verify tags on an ECS service
 */
async function verifyEcsTags(
  arn: string,
  expectedTags: LightsOutTags,
  profile?: string
): Promise<TagVerificationResult> {
  const region = extractRegionFromArn(arn);

  try {
    const clientConfig = profile ? { region, credentials: fromSSO({ profile }) } : { region };

    const client = new ECSClient(clientConfig);

    const command = new ListTagsForResourceCommand({
      resourceArn: arn,
    });

    const response = await client.send(command);

    // Convert tags array to record
    const actualTags: Record<string, string> = {};
    for (const tag of response.tags || []) {
      if (tag.key && tag.value) {
        actualTags[tag.key] = tag.value;
      }
    }

    const comparison = compareTags(expectedTags, actualTags);

    return {
      arn,
      type: 'ecs-service',
      status: comparison.matches ? 'verified' : 'mismatch',
      expectedTags,
      actualTags,
      mismatches: comparison.matches ? undefined : comparison.mismatches,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for specific error types
    if (errorMessage.includes('does not exist') || errorMessage.includes('not found')) {
      return {
        arn,
        type: 'ecs-service',
        status: 'not-found',
        expectedTags,
        error: 'Resource not found',
      };
    }

    return {
      arn,
      type: 'ecs-service',
      status: 'error',
      expectedTags,
      error: errorMessage,
    };
  }
}

/**
 * Verify tags on an RDS instance
 */
async function verifyRdsTags(
  arn: string,
  expectedTags: LightsOutTags,
  profile?: string
): Promise<TagVerificationResult> {
  const region = extractRegionFromArn(arn);

  try {
    const clientConfig = profile ? { region, credentials: fromSSO({ profile }) } : { region };

    const client = new RDSClient(clientConfig);

    const command = new RDSListTagsCommand({
      ResourceName: arn,
    });

    const response = await client.send(command);

    // Convert tags array to record
    const actualTags: Record<string, string> = {};
    for (const tag of response.TagList || []) {
      if (tag.Key && tag.Value) {
        actualTags[tag.Key] = tag.Value;
      }
    }

    const comparison = compareTags(expectedTags, actualTags);

    return {
      arn,
      type: 'rds-db',
      status: comparison.matches ? 'verified' : 'mismatch',
      expectedTags,
      actualTags,
      mismatches: comparison.matches ? undefined : comparison.mismatches,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for specific error types
    if (errorMessage.includes('DBInstanceNotFound') || errorMessage.includes('not found')) {
      return {
        arn,
        type: 'rds-db',
        status: 'not-found',
        expectedTags,
        error: 'Resource not found',
      };
    }

    return {
      arn,
      type: 'rds-db',
      status: 'error',
      expectedTags,
      error: errorMessage,
    };
  }
}

/**
 * Verifies that Lights Out tags have been applied to resources.
 *
 * @param input - Input parameters
 * @returns Verification results
 */
export async function verifyTags(input: VerifyTagsInput): Promise<VerifyTagsResult> {
  const { resources, profile } = input;

  const results: TagVerificationResult[] = [];
  let verified = 0;
  let mismatch = 0;
  let notFound = 0;
  let errorCount = 0;

  for (const resource of resources) {
    let result: TagVerificationResult;

    if (resource.type === 'ecs-service') {
      result = await verifyEcsTags(resource.arn, resource.expectedTags, profile);
    } else if (resource.type === 'rds-db' || resource.type === 'rds-cluster') {
      result = await verifyRdsTags(resource.arn, resource.expectedTags, profile);
    } else {
      result = {
        arn: resource.arn,
        type: resource.type,
        status: 'error',
        expectedTags: resource.expectedTags,
        error: `Unknown resource type: ${resource.type}`,
      };
    }

    results.push(result);

    switch (result.status) {
      case 'verified':
        verified++;
        break;
      case 'mismatch':
        mismatch++;
        break;
      case 'not-found':
        notFound++;
        break;
      case 'error':
        errorCount++;
        break;
    }
  }

  return {
    success: mismatch === 0 && notFound === 0 && errorCount === 0,
    results,
    summary: {
      total: resources.length,
      verified,
      mismatch,
      notFound,
      error: errorCount,
    },
  };
}
