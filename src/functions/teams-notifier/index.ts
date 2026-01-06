/**
 * Teams Notifier Lambda Handler.
 *
 * Listens to EventBridge events (ECS/RDS state changes) and sends
 * notifications to Microsoft Teams via Incoming Webhooks.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
} from '@aws-sdk/client-resource-groups-tagging-api';
import fetch from 'node-fetch';
import { getProjectConfig } from './config';
import { createStateChangeCard } from './adaptiveCard';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:teams:notifier');

// AWS SDK clients
const taggingClient = new ResourceGroupsTaggingAPIClient({});

/**
 * ECS Task State Change event structure.
 */
interface ECSTaskStateChangeEvent {
  clusterArn: string;
  taskArn: string;
  lastStatus: string;
  desiredStatus: string;
  containers: Array<{
    name: string;
    lastStatus: string;
  }>;
  overrides?: {
    containerOverrides?: Array<{
      name: string;
    }>;
  };
}

/**
 * RDS DB Instance Event structure.
 */
interface RDSInstanceEvent {
  SourceArn: string;
  SourceIdentifier: string;
  EventCategories: string[];
  Message: string;
}

/**
 * Lambda handler for Teams notifications.
 *
 * @param event - EventBridge event (ECS Task State Change or RDS DB Instance Event)
 * @returns Promise<void>
 */
export async function main(
  event:
    | EventBridgeEvent<'ECS Task State Change', ECSTaskStateChangeEvent>
    | EventBridgeEvent<'RDS DB Instance Event', RDSInstanceEvent>
): Promise<void> {
  logger.info(
    {
      source: event.source,
      detailType: event['detail-type'],
    },
    'EventBridge event received'
  );

  try {
    // Route to appropriate handler based on event source
    if (event.source === 'aws.ecs') {
      await handleECSStateChange(
        event as EventBridgeEvent<'ECS Task State Change', ECSTaskStateChangeEvent>
      );
    } else if (event.source === 'aws.rds') {
      await handleRDSStateChange(
        event as EventBridgeEvent<'RDS DB Instance Event', RDSInstanceEvent>
      );
    } else {
      logger.warn({ source: event.source }, 'Unsupported event source');
    }
  } catch (error) {
    logger.error(
      {
        error: String(error),
        event: JSON.stringify(event),
      },
      'Failed to process event'
    );
    // Don't throw - we don't want to retry on unrecoverable errors
  }
}

/**
 * Handle ECS Task State Change events.
 *
 * @param event - ECS event
 */
async function handleECSStateChange(
  event: EventBridgeEvent<'ECS Task State Change', ECSTaskStateChangeEvent>
): Promise<void> {
  const { detail } = event;

  // Extract resource information
  const taskArn = detail.taskArn;
  const resourceId = extractResourceId(taskArn);

  logger.debug(
    {
      taskArn,
      resourceId,
      lastStatus: detail.lastStatus,
      desiredStatus: detail.desiredStatus,
    },
    'Processing ECS task state change'
  );

  // Get resource tags (to find project)
  const tags = await getResourceTags(taskArn);
  const project = tags['lights-out:group'] || tags['lights-out:env'] || tags['lights-out:project'];

  if (!project) {
    logger.warn(
      { taskArn },
      'Resource missing lights-out:group or lights-out:env tag or lights-out:project tag, skipping notification'
    );
    return;
  }

  // Get Teams config for project
  const config = await getProjectConfig(project);
  if (!config) {
    logger.warn({ project }, 'No Teams config found for project');
    return;
  }

  // Prepare notification data
  const clusterName = extractResourceId(detail.clusterArn);
  const containerNames = detail.containers.map((c) => c.name).join(', ');

  const stateChangeData = {
    project,
    resourceType: 'ecs-task',
    resourceId,
    previousState: detail.desiredStatus,
    newState: detail.lastStatus,
    timestamp: new Date().toISOString(),
    additionalInfo: {
      cluster: clusterName,
      containers: containerNames,
      taskCount: `${detail.containers.length} container(s)`,
    },
  };

  // Send notification
  await sendTeamsNotification(config.webhook_url, stateChangeData);
}

/**
 * Handle RDS DB Instance events.
 *
 * @param event - RDS event
 */
async function handleRDSStateChange(
  event: EventBridgeEvent<'RDS DB Instance Event', RDSInstanceEvent>
): Promise<void> {
  const { detail } = event;

  logger.debug(
    {
      sourceArn: detail.SourceArn,
      sourceIdentifier: detail.SourceIdentifier,
      eventCategories: detail.EventCategories,
    },
    'Processing RDS instance event'
  );

  // Get resource tags
  const tags = await getResourceTags(detail.SourceArn);
  const project = tags['lights-out:group'] || tags['lights-out:env'] || tags['lights-out:project'];

  if (!project) {
    logger.warn(
      { arn: detail.SourceArn },
      'Resource missing lights-out:group or lights-out:env tag or lights-out:project tag, skipping notification'
    );
    return;
  }

  // Get Teams config for project
  const config = await getProjectConfig(project);
  if (!config) {
    logger.warn({ project }, 'No Teams config found for project');
    return;
  }

  // Parse state from event message
  const { previousState, newState } = parseRDSStateFromMessage(detail.Message);

  const stateChangeData = {
    project,
    resourceType: 'rds-instance',
    resourceId: detail.SourceIdentifier,
    previousState,
    newState,
    timestamp: new Date().toISOString(),
    additionalInfo: {
      eventCategory: detail.EventCategories.join(', '),
      message: detail.Message,
    },
  };

  // Send notification
  await sendTeamsNotification(config.webhook_url, stateChangeData);
}

/**
 * Get resource tags using Resource Groups Tagging API.
 *
 * @param arn - Resource ARN
 * @returns Record of tags
 */
async function getResourceTags(arn: string): Promise<Record<string, string>> {
  try {
    const command = new GetResourcesCommand({
      ResourceARNList: [arn],
    });

    const result = await taggingClient.send(command);

    if (!result.ResourceTagMappingList || result.ResourceTagMappingList.length === 0) {
      logger.debug({ arn }, 'No tags found for resource');
      return {};
    }

    const tags: Record<string, string> = {};
    const tagMapping = result.ResourceTagMappingList[0];

    if (tagMapping.Tags) {
      tagMapping.Tags.forEach((tag) => {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      });
    }

    return tags;
  } catch (error) {
    logger.error(
      {
        arn,
        error: String(error),
      },
      'Failed to fetch resource tags'
    );
    return {};
  }
}

/**
 * Extract resource ID from ARN.
 *
 * @param arn - AWS ARN
 * @returns Resource ID (last segment)
 *
 * @example
 * extractResourceId('arn:aws:ecs:us-east-1:123:task/cluster/abc123')
 * => 'abc123'
 */
function extractResourceId(arn: string): string {
  const parts = arn.split('/');
  return parts[parts.length - 1];
}

/**
 * Parse RDS state transition from event message.
 *
 * @param message - RDS event message
 * @returns Previous and new states
 *
 * @example
 * parseRDSStateFromMessage('DB instance stopped')
 * => { previousState: 'available', newState: 'stopped' }
 */
function parseRDSStateFromMessage(message: string): {
  previousState: string;
  newState: string;
} {
  const lowerMessage = message.toLowerCase();

  // Common patterns
  if (lowerMessage.includes('stopped')) {
    return { previousState: 'available', newState: 'stopped' };
  }
  if (lowerMessage.includes('started') || lowerMessage.includes('available')) {
    return { previousState: 'stopped', newState: 'available' };
  }
  if (lowerMessage.includes('stopping')) {
    return { previousState: 'available', newState: 'stopping' };
  }
  if (lowerMessage.includes('starting')) {
    return { previousState: 'stopped', newState: 'starting' };
  }

  // Fallback
  return { previousState: 'unknown', newState: 'unknown' };
}

/**
 * Send notification to Microsoft Teams via Incoming Webhook.
 *
 * @param webhookUrl - Teams Incoming Webhook URL
 * @param stateChangeData - State change information
 */
async function sendTeamsNotification(
  webhookUrl: string,
  stateChangeData: {
    project: string;
    resourceType: string;
    resourceId: string;
    previousState: string;
    newState: string;
    timestamp: string;
    additionalInfo?: Record<string, string>;
  }
): Promise<void> {
  const card = createStateChangeCard(stateChangeData);

  logger.debug(
    {
      project: stateChangeData.project,
      resourceId: stateChangeData.resourceId,
      webhookUrl: webhookUrl.substring(0, 50) + '...', // Log partial URL for security
    },
    'Sending Teams notification'
  );

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
        },
        'Teams webhook request failed'
      );
      return;
    }

    logger.info(
      {
        project: stateChangeData.project,
        resourceId: stateChangeData.resourceId,
        newState: stateChangeData.newState,
      },
      'Teams notification sent successfully'
    );
  } catch (error) {
    logger.error(
      {
        error: String(error),
        project: stateChangeData.project,
      },
      'Failed to send Teams notification'
    );
  }
}
