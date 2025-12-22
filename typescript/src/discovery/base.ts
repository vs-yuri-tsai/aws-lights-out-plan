/**
 * Core types for resource discovery.
 *
 * This module defines the data structure for discovered AWS resources
 * that should be managed by the lights-out scheduler.
 */

/**
 * Represents a discovered resource that is managed by the lights-out plan.
 * This is a data structure, not an entity with behavior.
 */
export interface DiscoveredResource {
  /**
   * Resource type identifier (e.g., "ecs-service", "nat-gateway")
   */
  resourceType: string;

  /**
   * Full AWS ARN for unique identification
   */
  arn: string;

  /**
   * Human-readable ID (e.g., cluster/service, ngw-id)
   */
  resourceId: string;

  /**
   * Priority from tag 'lights-out:priority' (default: 50)
   * Lower values = start first, stop last
   */
  priority: number;

  /**
   * Schedule group from tag 'lights-out:group' (default: 'default')
   */
  group: string;

  /**
   * All resource tags
   */
  tags: Record<string, string>;

  /**
   * Handler-specific metadata (e.g., cluster name for ECS services)
   */
  metadata: Record<string, unknown>;
}
