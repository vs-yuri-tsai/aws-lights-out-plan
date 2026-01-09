/**
 * Trigger Source Detector
 *
 * Detects and enriches trigger source information from Lambda events.
 */

import {
  STSClient,
  GetCallerIdentityCommand,
  type GetCallerIdentityCommandOutput,
} from '@aws-sdk/client-sts';
import type { Context } from 'aws-lambda';
import type { LambdaEvent, TriggerSource } from '@shared/types';
import { setupLogger } from './logger';

const logger = setupLogger('lights-out:trigger-detector');

/**
 * Detect trigger source from Lambda event and context.
 *
 * Detection logic:
 * 1. Check if event already contains triggerSource metadata
 * 2. Check if event is from EventBridge (source === "aws.events")
 * 3. Try to get caller identity via STS (for manual invocations)
 * 4. Fallback to "unknown"
 *
 * @param event - Lambda event
 * @param context - Lambda context
 * @returns TriggerSource metadata
 */
export async function detectTriggerSource(
  event: LambdaEvent,
  context: Context
): Promise<TriggerSource> {
  // 1. Check if event already contains trigger source (e.g., from Teams Bot and EventBridge input)
  if (event.triggerSource) {
    logger.debug({ triggerSource: event.triggerSource }, 'Using trigger source from event');
    return event.triggerSource;
  }

  // 2. Check if triggered by native EventBridge event
  const detailType = event['detail-type'];
  if (
    event.source === 'aws.events' &&
    typeof detailType === 'string' &&
    detailType === 'Scheduled Event'
  ) {
    return detectEventBridgeSource(event);
  }

  // 3. Check if manual invocation (try STS GetCallerIdentity)
  try {
    return await detectManualInvokeSource(context);
  } catch (error) {
    logger.warn(
      { error: String(error) },
      'Failed to detect manual invoke source, falling back to unknown'
    );
    return createUnknownSource(context);
  }
}

/**
 * Detect EventBridge scheduled event source.
 */
function detectEventBridgeSource(event: LambdaEvent): TriggerSource {
  const ruleArn = event.resources?.[0];
  const detailType = event['detail-type'];

  if (!ruleArn || typeof ruleArn !== 'string') {
    logger.warn('EventBridge event missing rule ARN in resources');
    return {
      type: 'eventbridge-scheduled',
      identity: 'unknown',
      displayName: 'EventBridge (Unknown Rule)',
      metadata: {
        eventDetailType: typeof detailType === 'string' ? detailType : undefined,
      },
    };
  }

  // Extract rule name from ARN
  // Format: arn:aws:events:region:account:rule/rule-name
  const ruleName = extractRuleNameFromArn(ruleArn);

  logger.info({ ruleArn, ruleName }, 'Detected EventBridge scheduled trigger');

  return {
    type: 'eventbridge-scheduled',
    identity: ruleArn,
    displayName: ruleName,
    metadata: {
      eventDetailType: typeof detailType === 'string' ? detailType : undefined,
    },
  };
}

/**
 * Detect manual CLI invocation using STS GetCallerIdentity.
 */
async function detectManualInvokeSource(context: Context): Promise<TriggerSource> {
  // Extract region from function ARN
  // Format: arn:aws:lambda:region:account:function:name
  const region = extractRegionFromArn(context.invokedFunctionArn);

  const stsClient = new STSClient({ region: region || undefined });

  logger.debug('Calling STS GetCallerIdentity to detect manual invoke source');

  const response: GetCallerIdentityCommandOutput = await stsClient.send(
    new GetCallerIdentityCommand({})
  );

  const callerArn = response.Arn ?? 'unknown';
  const accountId = response.Account ?? 'unknown';
  const userId = response.UserId ?? 'unknown';

  // Extract identity name from ARN
  // IAM User: arn:aws:iam::account:user/username
  // IAM Role: arn:aws:sts::account:assumed-role/role-name/session-name
  const identityName = extractIdentityNameFromArn(callerArn);

  logger.info({ callerArn, identityName, accountId }, 'Detected manual invoke trigger');

  return {
    type: 'manual-invoke',
    identity: callerArn,
    displayName: identityName,
    metadata: {
      accountId,
      userId,
    },
  };
}

/**
 * Create unknown trigger source (fallback).
 */
function createUnknownSource(context: Context): TriggerSource {
  return {
    type: 'unknown',
    identity: context.invokedFunctionArn,
    displayName: 'Unknown Source',
  };
}

/**
 * Extract rule name from EventBridge rule ARN.
 *
 * @param arn - Rule ARN (e.g., "arn:aws:events:ap-southeast-1:123456:rule/lights-out-sss-lab-start")
 * @returns Rule name (e.g., "lights-out-sss-lab-start")
 */
function extractRuleNameFromArn(arn: string): string {
  const parts = arn.split('/');
  return parts[parts.length - 1] || 'unknown';
}

/**
 * Extract region from AWS ARN.
 *
 * @param arn - AWS ARN
 * @returns Region (e.g., "ap-southeast-1")
 */
function extractRegionFromArn(arn: string): string {
  const parts = arn.split(':');
  return parts[3] || 'ap-southeast-1'; // Default to ap-southeast-1
}

/**
 * Extract identity name from IAM/STS ARN.
 *
 * @param arn - IAM user or STS assumed-role ARN
 * @returns Identity name
 */
function extractIdentityNameFromArn(arn: string): string {
  if (arn.includes(':user/')) {
    // IAM User: arn:aws:iam::123456:user/username
    const parts = arn.split(':user/');
    return parts[1] || 'unknown';
  } else if (arn.includes(':assumed-role/')) {
    // IAM Role: arn:aws:sts::123456:assumed-role/role-name/session-name
    const parts = arn.split(':assumed-role/');
    const roleAndSession = parts[1].split('/');
    return roleAndSession[0] || 'unknown'; // Return role name
  } else if (arn.includes(':role/')) {
    // IAM Role (not assumed): arn:aws:iam::123456:role/role-name
    const parts = arn.split(':role/');
    return parts[1] || 'unknown';
  }

  return 'unknown';
}
