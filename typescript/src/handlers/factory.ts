/**
 * Simple factory for creating resource-specific handlers.
 *
 * Maps resource types to their handler classes.
 */

import type { DiscoveredResource } from '@/types';
import type { ResourceHandler, Config } from '@handlers/base';
import { ECSServiceHandler } from '@handlers/ecsService';
import { RDSInstanceHandler } from '@handlers/rdsInstance';

/**
 * Get a handler for a specific resource type.
 *
 * @param resourceType - Type of the resource (e.g., "ecs-service", "rds-instance")
 * @param resource - The discovered resource object
 * @param config - Configuration object from SSM
 * @returns ResourceHandler instance or null if handler not found
 */
export function getHandler(
  resourceType: string,
  resource: DiscoveredResource,
  config: Config
): ResourceHandler | null {
  switch (resourceType) {
    case 'ecs-service':
      return new ECSServiceHandler(resource, config);
    case 'rds-instance':
      return new RDSInstanceHandler(resource, config);
    default:
      return null;
  }
}
