/**
 * Teams Notification Utility
 *
 * Sends Microsoft Teams notifications for lights-out action results.
 * This utility is called directly from resource handlers after start/stop operations.
 */

import fetch from 'node-fetch';
import type {
  HandlerResult,
  TeamsNotificationConfig,
  TriggerSource,
  AggregatedNotificationPayload,
  AggregatedResourceGroup,
} from '@shared/types';
import { setupLogger } from './logger';

const logger = setupLogger('lights-out:teams-notifier');

/**
 * Send Teams notification for a handler action result.
 *
 * @param config - Teams notification configuration from SSM
 * @param result - Handler action result (start/stop/status)
 * @param environment - Environment name (e.g., "workshop", "dev", "production")
 */
export async function sendTeamsNotification(
  config: TeamsNotificationConfig,
  result: HandlerResult,
  environment: string
): Promise<void> {
  // Check if notifications are enabled
  if (!config.enabled) {
    logger.debug('Teams notifications disabled, skipping');
    return;
  }

  // Create adaptive card
  const card = createActionResultCard(result, environment);

  logger.debug(
    {
      action: result.action,
      resourceType: result.resourceType,
      resourceId: result.resourceId,
      success: result.success,
      webhookUrl: config.webhook_url.substring(0, 50) + '...', // Log partial URL for security
    },
    'Sending Teams notification'
  );

  try {
    const response = await fetch(config.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        },
        'Teams webhook request failed'
      );
      return;
    }

    logger.info(
      {
        action: result.action,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        success: result.success,
      },
      'Teams notification sent successfully'
    );
  } catch (error) {
    logger.error(
      {
        error: String(error),
        action: result.action,
        resourceType: result.resourceType,
      },
      'Failed to send Teams notification'
    );
    // Don't throw - notification failure should not affect the main operation
  }
}

/**
 * Create Microsoft Teams Adaptive Card for action result.
 *
 * @param result - Handler action result
 * @param environment - Environment name
 * @returns Adaptive Card in Teams message format
 */
function createActionResultCard(result: HandlerResult, environment: string): object {
  // Format timestamp in Asia/Taipei timezone (e.g., "2025-01-07 14:30:45 GMT+8")
  const timestamp = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const actionUpper = result.action.toUpperCase();
  const statusColor = result.success ? 'good' : 'attention';
  const statusEmoji = result.success ? '✅' : '❌';
  const statusText = result.success ? 'Success' : 'Failed';

  // Format trigger source display
  const triggerSourceDisplay = formatTriggerSourceDisplay(result.triggerSource);

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: `${statusEmoji} Lights-Out ${actionUpper} - ${statusText}`,
              weight: 'bolder',
              size: 'large',
              color: statusColor,
            },
            {
              type: 'FactSet',
              facts: [
                {
                  title: 'Environment',
                  value: environment,
                },
                {
                  title: 'Action',
                  value: actionUpper,
                },
                {
                  title: 'Triggered By',
                  value: triggerSourceDisplay,
                },
                {
                  title: 'Resource Type',
                  value: result.resourceType.toUpperCase().replace('-', ' '),
                },
                {
                  title: 'Resource ID',
                  value: result.resourceId,
                },
                {
                  title: 'Status',
                  value: statusText,
                },
                {
                  title: 'Message',
                  value: result.message,
                },
                ...(result.error
                  ? [
                      {
                        title: 'Error',
                        value: result.error,
                      },
                    ]
                  : []),
                {
                  title: 'Timestamp',
                  value: timestamp,
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

/**
 * Format trigger source for Teams display.
 *
 * @param triggerSource - Trigger source metadata
 * @returns Formatted display string
 */
function formatTriggerSourceDisplay(triggerSource?: TriggerSource): string {
  if (!triggerSource) {
    return '🔹 Unknown';
  }

  switch (triggerSource.type) {
    case 'eventbridge-scheduled':
      return `⏰ EventBridge: ${triggerSource.displayName}`;
    case 'manual-invoke':
      return `👤 Manual: ${triggerSource.displayName}`;
    case 'teams-bot':
      return `💬 Teams Bot: ${triggerSource.displayName}`;
    case 'unknown':
    default:
      return '🔹 Unknown';
  }
}

/**
 * Extract region from AWS ARN.
 *
 * @param arn - AWS resource ARN (e.g., "arn:aws:ecs:us-east-1:123456:service/...")
 * @returns Region string or 'unknown' if unable to extract
 */
function extractRegionFromArn(arn?: string): string {
  if (!arn?.startsWith('arn:aws:')) {
    return 'unknown';
  }
  const parts = arn.split(':');
  return parts.length >= 4 && parts[3] ? parts[3] : 'unknown';
}

/**
 * Group results by region and success status.
 *
 * @param results - Array of handler results
 * @returns Object with success and failed maps, grouped by region -> resourceType -> results
 */
function groupResultsByRegionAndStatus(results: HandlerResult[]): {
  success: Map<string, Map<string, HandlerResult[]>>;
  failed: Map<string, Map<string, HandlerResult[]>>;
} {
  const success = new Map<string, Map<string, HandlerResult[]>>();
  const failed = new Map<string, Map<string, HandlerResult[]>>();

  for (const result of results) {
    const target = result.success ? success : failed;
    const region = result.region || 'unknown';

    if (!target.has(region)) {
      target.set(region, new Map());
    }

    const regionMap = target.get(region)!;
    const resourceType = result.resourceType;

    if (!regionMap.has(resourceType)) {
      regionMap.set(resourceType, []);
    }

    regionMap.get(resourceType)!.push(result);
  }

  return { success, failed };
}

/**
 * Build aggregated notification payload from grouped results.
 *
 * @param success - Whether this is a success or failure notification
 * @param action - The action performed (start/stop)
 * @param environment - Environment name
 * @param region - AWS region
 * @param resourceTypeMap - Map of resourceType -> results
 * @param triggerSource - Trigger source metadata
 * @returns Aggregated notification payload
 */
function buildAggregatedPayload(
  success: boolean,
  action: string,
  environment: string,
  region: string,
  resourceTypeMap: Map<string, HandlerResult[]>,
  triggerSource?: TriggerSource
): AggregatedNotificationPayload {
  const timestamp = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const resourceGroups: AggregatedResourceGroup[] = [];

  for (const [resourceType, results] of resourceTypeMap) {
    // Use the first non-empty message as representative
    const message = results.find((r) => r.message)?.message || '';
    // For failures, include error info
    const errorInfo = !success ? results.find((r) => r.error)?.error : undefined;

    resourceGroups.push({
      resourceType,
      resourceIds: results.map((r) => r.resourceId),
      message: errorInfo ? `${message} (${errorInfo})` : message,
    });
  }

  return {
    success,
    action,
    environment,
    triggerSource,
    region,
    resourceGroups,
    timestamp,
  };
}

/**
 * Create Microsoft Teams Adaptive Card for aggregated notification.
 *
 * @param payload - Aggregated notification payload
 * @returns Adaptive Card in Teams message format
 */
function createAggregatedCard(payload: AggregatedNotificationPayload): object {
  const statusEmoji = payload.success ? '✅' : '❌';
  const statusText = payload.success ? 'Success' : 'Failed';
  const statusColor = payload.success ? 'good' : 'attention';
  const actionUpper = payload.action.toUpperCase();

  const triggerDisplay = formatTriggerSourceDisplay(payload.triggerSource);

  // Build resource sections
  const resourceSections: object[] = [];

  for (const group of payload.resourceGroups) {
    const resourceTypeName = group.resourceType.toUpperCase().replace('-', ' ');

    // Resource type header
    resourceSections.push({
      type: 'TextBlock',
      text: `**${resourceTypeName}:**`,
      weight: 'bolder',
      size: 'small',
      spacing: 'medium',
    });

    // Resource IDs list (use \n\n for proper line breaks in Teams Adaptive Cards)
    const idList = group.resourceIds.map((id) => `• ${id}`).join('\n\n');
    resourceSections.push({
      type: 'TextBlock',
      text: idList,
      wrap: true,
      size: 'small',
      fontType: 'monospace',
    });

    // Message
    if (group.message) {
      resourceSections.push({
        type: 'TextBlock',
        text: `_${group.message}_`,
        wrap: true,
        size: 'small',
        isSubtle: true,
      });
    }
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: `${statusEmoji} Lights-Out ${actionUpper} - ${statusText}`,
              weight: 'bolder',
              size: 'large',
              color: statusColor,
            },
            {
              type: 'FactSet',
              facts: [
                {
                  title: 'Environment',
                  value: payload.environment,
                },
                {
                  title: 'Triggered By',
                  value: triggerDisplay,
                },
                {
                  title: 'Region',
                  value: payload.region,
                },
                {
                  title: 'Timestamp',
                  value: payload.timestamp,
                },
              ],
            },
            ...resourceSections,
          ],
        },
      },
    ],
  };
}

/**
 * Send aggregated Teams notifications for orchestration results.
 *
 * Groups results by region and status (success/failed), then sends
 * one notification per region per status.
 *
 * @param config - Teams notification configuration
 * @param results - Array of handler results
 * @param environment - Environment name
 * @param action - The action performed (start/stop)
 * @param triggerSource - Trigger source metadata
 */
export async function sendAggregatedTeamsNotification(
  config: TeamsNotificationConfig,
  results: HandlerResult[],
  environment: string,
  action: string,
  triggerSource?: TriggerSource
): Promise<void> {
  if (!config.enabled) {
    logger.debug('Teams notifications disabled, skipping aggregated notification');
    return;
  }

  if (results.length === 0) {
    logger.debug('No results to notify');
    return;
  }

  const { success, failed } = groupResultsByRegionAndStatus(results);

  logger.debug(
    {
      successRegions: Array.from(success.keys()),
      failedRegions: Array.from(failed.keys()),
      totalResults: results.length,
    },
    'Sending aggregated Teams notifications'
  );

  // Send success notifications (one per region)
  for (const [region, resourceTypeMap] of success) {
    const payload = buildAggregatedPayload(
      true,
      action,
      environment,
      region,
      resourceTypeMap,
      triggerSource
    );
    await sendCard(config.webhook_url, createAggregatedCard(payload), 'success', region);
  }

  // Send failure notifications (one per region)
  for (const [region, resourceTypeMap] of failed) {
    const payload = buildAggregatedPayload(
      false,
      action,
      environment,
      region,
      resourceTypeMap,
      triggerSource
    );
    await sendCard(config.webhook_url, createAggregatedCard(payload), 'failed', region);
  }
}

/**
 * Send an Adaptive Card to Teams webhook.
 *
 * @param webhookUrl - Teams webhook URL
 * @param card - Adaptive Card object
 * @param status - Status label for logging
 * @param region - Region label for logging
 */
async function sendCard(
  webhookUrl: string,
  card: object,
  status: string,
  region: string
): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          notificationType: status,
          region,
        },
        'Teams webhook request failed for aggregated notification'
      );
      return;
    }

    logger.info(
      {
        notificationType: status,
        region,
      },
      'Aggregated Teams notification sent successfully'
    );
  } catch (error) {
    logger.error(
      {
        error: String(error),
        notificationType: status,
        region,
      },
      'Failed to send aggregated Teams notification'
    );
  }
}

// Export for testing
export { extractRegionFromArn, groupResultsByRegionAndStatus };
