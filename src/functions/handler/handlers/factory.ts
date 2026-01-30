/**
 * Simple factory for creating resource-specific handlers.
 *
 * Maps resource types to their handler classes.
 */

import type { DiscoveredResource, ResourceHandler, Config } from '@shared/types';
import { ECSServiceHandler } from './ecsService';
import { RDSInstanceHandler } from './rdsInstance';
import { AuroraClusterHandler } from './auroraCluster';

/**
 * Get a handler for a specific resource type.
 *
 * @param resourceType - Type of the resource (e.g., "ecs-service", "rds-db")
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
    case 'rds-db':
      return new RDSInstanceHandler(resource, config);
    case 'rds-cluster':
      return new AuroraClusterHandler(resource, config);
    default:
      return null;
  }
}
