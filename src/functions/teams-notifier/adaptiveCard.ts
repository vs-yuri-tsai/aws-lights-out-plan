/**
 * Adaptive Card templates for Microsoft Teams notifications.
 *
 * Creates rich, interactive cards for resource state change notifications.
 */

/**
 * Resource state change notification data.
 */
export interface ResourceStateChange {
  project: string;
  resourceType: string;
  resourceId: string;
  previousState: string;
  newState: string;
  timestamp: string;
  additionalInfo?: Record<string, string>;
}

/**
 * Creates a detailed Adaptive Card for resource state changes.
 *
 * @param data - State change information
 * @returns Adaptive Card JSON payload
 *
 * @example
 * const card = createStateChangeCard({
 *   project: 'airsync-dev',
 *   resourceType: 'ecs-service',
 *   resourceId: 'airsync-api',
 *   previousState: 'STOPPED',
 *   newState: 'RUNNING',
 *   timestamp: '2026-01-05T10:30:00Z',
 *   additionalInfo: {
 *     cluster: 'airsync-cluster',
 *     tasks: '2/2 healthy'
 *   }
 * });
 */
export function createStateChangeCard(data: ResourceStateChange): object {
  // Determine status emoji and color based on state
  const { emoji, color } = getStatusIndicator(data.newState);

  // Build facts array (key-value pairs)
  const facts: Array<{ title: string; value: string }> = [
    { title: 'Resource Type', value: formatResourceType(data.resourceType) },
    { title: 'Resource ID', value: data.resourceId },
    { title: 'Previous State', value: data.previousState },
    { title: 'New State', value: `**${data.newState}**` },
    { title: 'Timestamp', value: formatTimestamp(data.timestamp) },
  ];

  // Add additional info if provided
  if (data.additionalInfo) {
    Object.entries(data.additionalInfo).forEach(([key, value]) => {
      facts.push({
        title: formatFieldName(key),
        value: value,
      });
    });
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: `${emoji} ${data.project} Status Update`,
              weight: 'Bolder',
              size: 'Medium',
              color: color,
            },
            {
              type: 'FactSet',
              facts: facts,
            },
          ],
        },
      },
    ],
  };
}

/**
 * Get status indicator (emoji and color) based on resource state.
 *
 * @param state - Resource state
 * @returns Emoji and color for the state
 */
function getStatusIndicator(state: string): { emoji: string; color: string } {
  const normalizedState = state.toUpperCase();

  // Running/Available states (green)
  if (['RUNNING', 'AVAILABLE', 'ACTIVE'].includes(normalizedState)) {
    return { emoji: '🟢', color: 'Good' };
  }

  // Stopped states (red)
  if (['STOPPED', 'STOPPING', 'UNAVAILABLE'].includes(normalizedState)) {
    return { emoji: '🔴', color: 'Attention' };
  }

  // Transitioning states (yellow)
  if (['PENDING', 'STARTING', 'STOPPING'].includes(normalizedState)) {
    return { emoji: '🟡', color: 'Warning' };
  }

  // Failed states (red)
  if (normalizedState.includes('FAIL') || normalizedState.includes('ERROR')) {
    return { emoji: '❌', color: 'Attention' };
  }

  // Default (gray)
  return { emoji: '⚪', color: 'Default' };
}

/**
 * Format resource type for display.
 *
 * @param resourceType - Raw resource type
 * @returns Human-readable resource type
 *
 * @example
 * formatResourceType('ecs-service') => 'ECS Service'
 * formatResourceType('rds-instance') => 'RDS Instance'
 */
function formatResourceType(resourceType: string): string {
  const parts = resourceType.split('-');
  return parts
    .map((part) => part.toUpperCase())
    .join(' ')
    .replace('ECS', 'ECS')
    .replace('RDS', 'RDS');
}

/**
 * Format field name for display (camelCase to Title Case).
 *
 * @param fieldName - Raw field name
 * @returns Human-readable field name
 *
 * @example
 * formatFieldName('clusterName') => 'Cluster Name'
 * formatFieldName('task_count') => 'Task Count'
 */
function formatFieldName(fieldName: string): string {
  // Handle snake_case
  const normalized = fieldName.replace(/_/g, ' ');

  // Handle camelCase
  const withSpaces = normalized.replace(/([A-Z])/g, ' $1');

  // Capitalize first letter of each word
  return withSpaces
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .trim();
}

/**
 * Format ISO timestamp for display.
 *
 * @param timestamp - ISO 8601 timestamp
 * @returns Human-readable timestamp
 *
 * @example
 * formatTimestamp('2026-01-05T10:30:00Z') => '2026-01-05 10:30:00 UTC'
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);

  // Format: YYYY-MM-DD HH:MM:SS UTC
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}
