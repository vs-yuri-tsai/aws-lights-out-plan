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
import { ECSClient, DescribeServicesCommand } from '@aws-sdk/client-ecs';
import fetch from 'node-fetch';
import { getProjectConfig } from './config';
import { createStateChangeCard } from './adaptiveCard';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:teams:notifier');

// AWS SDK clients
const taggingClient = new ResourceGroupsTaggingAPIClient({});
const ecsClient = new ECSClient({});

/**
 * ECS Task State Change event structure.
 */
interface ECSTaskStateChangeEvent {
  clusterArn: string;
  taskArn: string;
  lastStatus: string;
  desiredStatus: string;
  group?: string; // Format: "service:<service-name>" for tasks launched by a service
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

  // Only notify on stable states to avoid duplicate notifications
  // - RUNNING: Task has fully started (lastStatus = RUNNING, desiredStatus = RUNNING)
  // - STOPPED: Task has fully stopped
  const isStableState =
    (detail.lastStatus === 'RUNNING' && detail.desiredStatus === 'RUNNING') ||
    detail.lastStatus === 'STOPPED';

  if (!isStableState) {
    logger.debug(
      {
        lastStatus: detail.lastStatus,
        desiredStatus: detail.desiredStatus,
      },
      'Skipping notification for intermediate state'
    );
    return;
  }

  // Extract resource information
  const taskArn = detail.taskArn;

  logger.debug(
    {
      taskArn,
      lastStatus: detail.lastStatus,
      desiredStatus: detail.desiredStatus,
      group: detail.group,
    },
    'Processing ECS task state change'
  );

  // Get resource tags (to find project)
  // For tasks launched by a service, get tags from the service ARN instead of task ARN
  const arnToQuery = detail.group?.startsWith('service:')
    ? buildServiceArn(detail.clusterArn, detail.group.substring(8)) // Remove "service:" prefix
    : taskArn;

  const tags = await getResourceTags(arnToQuery);
  const project = tags['lights-out:group'] || tags['lights-out:env'] || tags['lights-out:project'];

  if (!project) {
    logger.warn(
      { taskArn, queriedArn: arnToQuery, group: detail.group },
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

  // Check if all tasks have reached the target state (deduplication logic)
  // Only notify when ALL tasks in the service have completed the state transition
  const serviceName = detail.group?.startsWith('service:')
    ? detail.group.substring(8) // Remove "service:" prefix
    : null;

  if (serviceName) {
    // Query service status to check if all tasks are ready
    const shouldNotify = await checkServiceReadyState(
      detail.clusterArn,
      serviceName,
      detail.lastStatus
    );

    if (!shouldNotify) {
      logger.debug(
        {
          serviceName,
          taskStatus: detail.lastStatus,
        },
        'Waiting for all tasks to reach target state, skipping notification'
      );
      return;
    }
  }

  // Prepare notification data
  const clusterName = extractResourceId(detail.clusterArn);
  const previousState = detail.lastStatus === 'RUNNING' ? 'STOPPED' : 'RUNNING';

  // Determine resource type and ID based on whether this is a service or standalone task
  let resourceType: string;
  let resourceId: string;
  let additionalInfo: Record<string, string>;

  if (serviceName) {
    // Service-level notification
    resourceType = 'ecs-service';
    resourceId = serviceName;

    // Get service details for task count
    const serviceStatus = await getServiceStatus(detail.clusterArn, serviceName);
    additionalInfo = {
      cluster: clusterName,
      tasksRunning: `${serviceStatus.runningCount}`,
      tasksDesired: `${serviceStatus.desiredCount}`,
    };
  } else {
    // Standalone task notification
    resourceType = 'ecs-task';
    resourceId = extractResourceId(detail.taskArn);
    const containerNames = detail.containers.map((c) => c.name).join(', ');
    additionalInfo = {
      cluster: clusterName,
      containers: containerNames,
      taskCount: `${detail.containers.length} container(s)`,
    };
  }

  const stateChangeData = {
    project,
    resourceType,
    resourceId,
    previousState,
    newState: detail.lastStatus,
    timestamp: new Date().toISOString(),
    additionalInfo,
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
 * Check if service has reached the target state for all tasks.
 * This is used to deduplicate notifications - only notify once when ALL tasks are ready.
 *
 * @param clusterArn - ECS cluster ARN
 * @param serviceName - ECS service name
 * @param taskStatus - Current task status (RUNNING or STOPPED)
 * @returns true if should send notification (all tasks ready), false otherwise
 */
async function checkServiceReadyState(
  clusterArn: string,
  serviceName: string,
  taskStatus: string
): Promise<boolean> {
  try {
    const serviceStatus = await getServiceStatus(clusterArn, serviceName);

    if (taskStatus === 'RUNNING') {
      // For START: notify when all tasks are running
      // runningCount === desiredCount means all tasks have started
      return serviceStatus.runningCount === serviceStatus.desiredCount;
    } else if (taskStatus === 'STOPPED') {
      // For STOP: notify when all tasks are stopped
      // runningCount === 0 means all tasks have stopped
      return serviceStatus.runningCount === 0;
    }

    return false;
  } catch (error) {
    logger.error(
      {
        clusterArn,
        serviceName,
        error: String(error),
      },
      'Failed to check service ready state, will send notification anyway'
    );
    // On error, send notification to avoid missing alerts
    return true;
  }
}

/**
 * Get ECS service status.
 *
 * @param clusterArn - ECS cluster ARN
 * @param serviceName - ECS service name
 * @returns Service status (runningCount, desiredCount)
 */
async function getServiceStatus(
  clusterArn: string,
  serviceName: string
): Promise<{ runningCount: number; desiredCount: number }> {
  const clusterName = extractResourceId(clusterArn);

  const command = new DescribeServicesCommand({
    cluster: clusterName,
    services: [serviceName],
  });

  const response = await ecsClient.send(command);

  if (!response.services || response.services.length === 0) {
    throw new Error(`Service ${serviceName} not found in cluster ${clusterName}`);
  }

  const service = response.services[0];

  return {
    runningCount: service.runningCount ?? 0,
    desiredCount: service.desiredCount ?? 0,
  };
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
 * Build ECS Service ARN from cluster ARN and service name.
 *
 * @param clusterArn - ECS cluster ARN
 * @param serviceName - ECS service name
 * @returns Service ARN
 *
 * @example
 * buildServiceArn('arn:aws:ecs:us-east-1:123:cluster/my-cluster', 'my-service')
 * => 'arn:aws:ecs:us-east-1:123:service/my-cluster/my-service'
 */
function buildServiceArn(clusterArn: string, serviceName: string): string {
  // Extract cluster name from cluster ARN
  // Format: arn:aws:ecs:region:account:cluster/cluster-name
  const clusterName = extractResourceId(clusterArn);

  // Build service ARN
  // Format: arn:aws:ecs:region:account:service/cluster-name/service-name
  const arnPrefix = clusterArn.split(':cluster/')[0];
  return `${arnPrefix}:service/${clusterName}/${serviceName}`;
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
